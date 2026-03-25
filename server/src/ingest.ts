import fs from 'node:fs';
import path from 'node:path';

import type { ScanSummary } from '../../shared/contracts.js';
import { AnalyticsDatabase } from './db.js';
import type { ParsedEvent, ParsedLog, ParsedRequest, ParsedToolCall, ScanTarget } from './types.js';

type AssistantRequestAccumulator = ParsedRequest & {
  fragmentTypeSet: Set<string>;
  toolNameSet: Set<string>;
};

type MessageContent = Array<Record<string, unknown>> | string | null | undefined;

export class IngestionService {
  constructor(
    private readonly database: AnalyticsDatabase,
    private readonly dataRoot: string,
  ) {}

  scan(): ScanSummary {
    const startedAt = new Date().toISOString();
    const targets = discoverTargets(this.dataRoot);
    const summary: ScanSummary = {
      startedAt,
      finishedAt: startedAt,
      filesDiscovered: targets.length,
      filesScanned: 0,
      filesSkipped: 0,
      sessionsUpdated: 0,
      subagentsUpdated: 0,
      errors: [],
    };

    let changed = false;

    for (const target of targets) {
      try {
        const stats = fs.statSync(target.filePath);
        const prior = this.database.getIngestionState(target.filePath);
        if (prior && prior.sizeBytes === stats.size && prior.mtimeMs === stats.mtimeMs) {
          summary.filesSkipped += 1;
          continue;
        }

        const parsed = parseLogFile(target);
        this.database.upsertParsedLog(parsed, { sizeBytes: stats.size, mtimeMs: stats.mtimeMs });
        summary.filesScanned += 1;
        if (target.kind === 'session') {
          summary.sessionsUpdated += 1;
        } else {
          summary.subagentsUpdated += 1;
        }
        changed = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push(`${path.basename(target.filePath)}: ${message}`);
      }
    }

    if (changed) {
      this.database.rebuildSessionRollups();
    }

    summary.finishedAt = new Date().toISOString();
    return summary;
  }
}

function discoverTargets(root: string): ScanTarget[] {
  const targets: ScanTarget[] = [];

  function walk(currentPath: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(nextPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      const relative = path.relative(root, nextPath);
      const parts = relative.split(path.sep);
      const sanitizedProject = parts[0] ?? 'unknown-project';

      if (parts.includes('subagents')) {
        const sessionId = parts[1] ?? path.basename(path.dirname(path.dirname(nextPath)));
        const agentId = entry.name.replace(/\.jsonl$/u, '').replace(/^agent-/u, '');
        targets.push({
          filePath: nextPath,
          kind: 'subagent',
          sessionId,
          agentId,
          sanitizedProject,
          metaPath: nextPath.replace(/\.jsonl$/u, '.meta.json'),
        });
      } else {
        const sessionId = path.basename(entry.name, '.jsonl');
        targets.push({
          filePath: nextPath,
          kind: 'session',
          sessionId,
          agentId: null,
          sanitizedProject,
          metaPath: null,
        });
      }
    }
  }

  if (fs.existsSync(root)) {
    walk(root);
  }

  return targets.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function parseLogFile(target: ScanTarget): ParsedLog {
  const raw = fs.readFileSync(target.filePath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const events: ParsedEvent[] = [];
  const requestMap = new Map<string, AssistantRequestAccumulator>();
  const toolCallMap = new Map<string, ParsedToolCall>();
  const toolCallOrder: ParsedToolCall[] = [];

  let cwd: string | null = null;
  let entrypoint: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  const versions = new Set<string>();
  const gitBranches = new Set<string>();
  let userMessageCount = 0;
  let toolSequenceIndex = 0;

  for (const [index, line] of lines.entries()) {
    let parsedLine: Record<string, unknown>;
    try {
      parsedLine = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const timestamp = stringOrNull(parsedLine.timestamp);
    startedAt = minTimestamp(startedAt, timestamp);
    endedAt = maxTimestamp(endedAt, timestamp);
    cwd = cwd ?? stringOrNull(parsedLine.cwd);
    entrypoint = entrypoint ?? stringOrNull(parsedLine.entrypoint);

    const version = stringOrNull(parsedLine.version);
    if (version) {
      versions.add(version);
    }

    const gitBranch = stringOrNull(parsedLine.gitBranch);
    if (gitBranch) {
      gitBranches.add(gitBranch);
    }

    const contentKind = getContentKind(parsedLine.message);
    const eventType = stringOrNull(parsedLine.type) ?? 'unknown';
    const event: ParsedEvent = {
      lineNumber: index + 1,
      sessionId: target.sessionId,
      agentId: target.agentId,
      eventUuid: stringOrNull(parsedLine.uuid),
      parentUuid: stringOrNull(parsedLine.parentUuid),
      eventType,
      eventSubtype: stringOrNull(parsedLine.subtype),
      dataType: stringOrNull((parsedLine.data as Record<string, unknown> | undefined)?.type),
      timestamp,
      role: stringOrNull((parsedLine.message as Record<string, unknown> | undefined)?.role),
      requestId: stringOrNull(parsedLine.requestId),
      messageId: stringOrNull((parsedLine.message as Record<string, unknown> | undefined)?.id),
      promptId: stringOrNull(parsedLine.promptId),
      toolUseId: getToolUseId(parsedLine),
      rawJson: line,
      contentKind,
    };
    events.push(event);

    if (eventType === 'user' && contentKind !== 'tool_result' && contentKind !== 'tool_result_only') {
      userMessageCount += 1;
    }

    if (eventType !== 'assistant') {
      if (eventType === 'user') {
        attachToolResults(parsedLine, toolCallMap);
      }
      continue;
    }

    const message = parsedLine.message as Record<string, unknown> | undefined;
    const messageId = stringOrNull(message?.id);
    const requestId = stringOrNull(parsedLine.requestId);
    const canonicalKey = requestId ?? messageId ?? stringOrNull(parsedLine.uuid) ?? `${target.sessionId}:${index}`;
    const requestUid = `${target.sessionId}:${target.agentId ?? 'root'}:${canonicalKey}`;
    const accumulator =
      requestMap.get(requestUid) ??
      {
        requestUid,
        sessionId: target.sessionId,
        agentId: target.agentId,
        requestId,
        messageId,
        timestamp,
        model: stringOrNull(message?.model),
        stopReason: stringOrNull(message?.stop_reason),
        stopSequence: stringOrNull(message?.stop_sequence),
        tokenBreakdown: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
        },
        fragmentTypes: [],
        fragments: [],
        toolNames: [],
        hasSubagentContext: target.kind === 'subagent',
        fragmentTypeSet: new Set<string>(),
        toolNameSet: new Set<string>(),
      };

    const usage = (message?.usage ?? {}) as Record<string, unknown>;
    accumulator.requestId = requestId ?? accumulator.requestId;
    accumulator.messageId = messageId ?? accumulator.messageId;
    accumulator.timestamp = accumulator.timestamp ?? timestamp;
    accumulator.model = stringOrNull(message?.model) ?? accumulator.model;
    accumulator.stopReason = stringOrNull(message?.stop_reason) ?? accumulator.stopReason;
    accumulator.stopSequence = stringOrNull(message?.stop_sequence) ?? accumulator.stopSequence;
    accumulator.tokenBreakdown = {
      inputTokens: numericOrZero(usage.input_tokens),
      outputTokens: numericOrZero(usage.output_tokens),
      cacheCreationTokens: numericOrZero(usage.cache_creation_input_tokens),
      cacheReadTokens: numericOrZero(usage.cache_read_input_tokens),
      totalTokens:
        numericOrZero(usage.input_tokens) +
        numericOrZero(usage.output_tokens) +
        numericOrZero(usage.cache_creation_input_tokens) +
        numericOrZero(usage.cache_read_input_tokens),
    };

    const content = message?.content as MessageContent;
    const fragments = Array.isArray(content) ? content : [];
    for (const fragment of fragments) {
      const kind = stringOrNull(fragment.type) ?? 'unknown';
      if (!accumulator.fragmentTypeSet.has(kind)) {
        accumulator.fragmentTypeSet.add(kind);
        accumulator.fragmentTypes.push(kind);
      }
      accumulator.fragments.push({
        kind,
        content: fragmentToText(fragment),
      });

      if (kind === 'tool_use') {
        const toolName = stringOrNull(fragment.name) ?? 'unknown';
        if (!accumulator.toolNameSet.has(toolName)) {
          accumulator.toolNameSet.add(toolName);
          accumulator.toolNames.push(toolName);
        }
        const toolUseId = stringOrNull(fragment.id);
        toolSequenceIndex += 1;
        const toolCallId = `${target.sessionId}:${target.agentId ?? 'root'}:${toolUseId ?? `${toolName}:${toolSequenceIndex}`}`;
        const toolCall: ParsedToolCall = {
          toolCallId,
          sessionId: target.sessionId,
          agentId: target.agentId,
          requestUid,
          requestId,
          toolUseId,
          toolName,
          toolInputJson: JSON.stringify(fragment.input ?? {}, null, 2),
          resultContent: null,
          resultIsError: false,
          sequenceIndex: toolSequenceIndex,
          timestamp,
        };
        toolCallMap.set(toolUseId ?? toolCallId, toolCall);
        toolCallOrder.push(toolCall);
      }
    }

    requestMap.set(requestUid, accumulator);
  }

  const projectKey = cwd ?? target.sanitizedProject;
  const projectLabel = cwd ? path.basename(cwd) || cwd : target.sanitizedProject;
  const durationSec = getDurationSec(startedAt, endedAt);

  return {
    kind: target.kind,
    sessionId: target.sessionId,
    agentId: target.agentId,
    sanitizedProject: target.sanitizedProject,
    projectKey,
    projectLabel,
    cwd,
    filePath: target.filePath,
    startedAt,
    endedAt,
    durationSec,
    entrypoint,
    versions: [...versions].sort(),
    gitBranches: [...gitBranches].sort(),
    userMessageCount,
    requests: [...requestMap.values()].map(stripAccumulatorFields),
    events,
    toolCalls: toolCallOrder,
    subagentMeta: readSubagentMeta(target.metaPath),
  };
}

function attachToolResults(parsedLine: Record<string, unknown>, toolCallMap: Map<string, ParsedToolCall>): void {
  const message = parsedLine.message as Record<string, unknown> | undefined;
  const content = message?.content;
  const items = Array.isArray(content) ? content : [];

  for (const item of items) {
    if (stringOrNull(item.type) !== 'tool_result') {
      continue;
    }
    const toolUseId = stringOrNull(item.tool_use_id);
    if (!toolUseId) {
      continue;
    }
    const toolCall = toolCallMap.get(toolUseId);
    if (!toolCall) {
      continue;
    }
    toolCall.resultContent = toolResultToText(item.content);
    toolCall.resultIsError = Boolean(item.is_error);
  }
}

function readSubagentMeta(metaPath: string | null) {
  if (!metaPath || !fs.existsSync(metaPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    return {
      agentType: stringOrNull(parsed.agentType),
      description: stringOrNull(parsed.description),
    };
  } catch {
    return null;
  }
}

function stripAccumulatorFields(request: AssistantRequestAccumulator): ParsedRequest {
  return {
    requestUid: request.requestUid,
    sessionId: request.sessionId,
    agentId: request.agentId,
    requestId: request.requestId,
    messageId: request.messageId,
    timestamp: request.timestamp,
    model: request.model,
    stopReason: request.stopReason,
    stopSequence: request.stopSequence,
    tokenBreakdown: request.tokenBreakdown,
    fragmentTypes: request.fragmentTypes,
    fragments: request.fragments,
    toolNames: request.toolNames,
    hasSubagentContext: request.hasSubagentContext,
  };
}

function getToolUseId(parsedLine: Record<string, unknown>): string | null {
  const message = parsedLine.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) {
    return stringOrNull(parsedLine.toolUseID);
  }
  for (const item of content) {
    const toolUseId = stringOrNull(item.tool_use_id) ?? stringOrNull(item.id);
    if (toolUseId) {
      return toolUseId;
    }
  }
  return stringOrNull(parsedLine.toolUseID);
}

function getContentKind(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string') {
    return 'string';
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const kinds = content
    .map((item) => stringOrNull((item as Record<string, unknown>).type))
    .filter(Boolean) as string[];
  if (kinds.length === 0) {
    return 'array';
  }
  if (kinds.every((kind) => kind === 'tool_result')) {
    return kinds.length === 1 ? 'tool_result' : 'tool_result_only';
  }
  return uniqueKinds(kinds).join(',');
}

function fragmentToText(fragment: Record<string, unknown>): string {
  const kind = stringOrNull(fragment.type) ?? 'unknown';
  if (kind === 'text') {
    return stringOrNull(fragment.text) ?? '';
  }
  if (kind === 'thinking') {
    return stringOrNull(fragment.thinking) ?? '';
  }
  if (kind === 'tool_use') {
    const payload = {
      id: stringOrNull(fragment.id),
      name: stringOrNull(fragment.name),
      input: fragment.input ?? null,
    };
    return JSON.stringify(payload, null, 2);
  }
  return JSON.stringify(fragment, null, 2);
}

function toolResultToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object') {
          const objectItem = item as Record<string, unknown>;
          return stringOrNull(objectItem.text) ?? JSON.stringify(objectItem, null, 2);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content, null, 2);
  }
  return '';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numericOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function minTimestamp(current: string | null, next: string | null): string | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return current <= next ? current : next;
}

function maxTimestamp(current: string | null, next: string | null): string | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return current >= next ? current : next;
}

function getDurationSec(startedAt: string | null, endedAt: string | null): number {
  if (!startedAt || !endedAt) {
    return 0;
  }
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }
  return Math.max(0, Math.round((end - start) / 1000));
}

function uniqueKinds(values: string[]): string[] {
  return [...new Set(values)];
}
