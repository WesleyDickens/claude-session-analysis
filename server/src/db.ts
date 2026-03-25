import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { SessionAnomalyBadge } from '../../shared/contracts.js';
import type { ParsedLog, SessionRollupRecord } from './types.js';

const EMPTY_BREAKDOWN = JSON.stringify({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
});

export class AnalyticsDatabase {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = OFF;');
    this.initialize();
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        project_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        cwd TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        sanitized_project TEXT NOT NULL,
        cwd TEXT,
        path TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        duration_sec REAL NOT NULL DEFAULT 0,
        entrypoint TEXT,
        versions_json TEXT NOT NULL,
        git_branches_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subagents (
        agent_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        agent_type TEXT,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS requests (
        request_uid TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        request_id TEXT,
        message_id TEXT,
        timestamp TEXT,
        model TEXT,
        stop_reason TEXT,
        stop_sequence TEXT,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_creation_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        fragment_types_json TEXT NOT NULL,
        fragments_json TEXT NOT NULL,
        tool_names_json TEXT NOT NULL,
        has_subagent_context INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        line_number INTEGER NOT NULL,
        event_uuid TEXT,
        parent_uuid TEXT,
        event_type TEXT NOT NULL,
        event_subtype TEXT,
        data_type TEXT,
        timestamp TEXT,
        role TEXT,
        request_id TEXT,
        message_id TEXT,
        prompt_id TEXT,
        tool_use_id TEXT,
        raw_json TEXT NOT NULL,
        content_kind TEXT
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        tool_call_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        request_uid TEXT,
        request_id TEXT,
        tool_use_id TEXT,
        tool_name TEXT NOT NULL,
        tool_input_json TEXT NOT NULL,
        result_content TEXT,
        result_is_error INTEGER NOT NULL DEFAULT 0,
        sequence_index INTEGER NOT NULL,
        timestamp TEXT
      );

      CREATE TABLE IF NOT EXISTS session_rollups (
        session_id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        token_breakdown_top_level_json TEXT NOT NULL DEFAULT '${EMPTY_BREAKDOWN}',
        token_breakdown_rolled_up_json TEXT NOT NULL DEFAULT '${EMPTY_BREAKDOWN}',
        user_message_count INTEGER NOT NULL DEFAULT 0,
        assistant_request_count INTEGER NOT NULL DEFAULT 0,
        unique_tool_count INTEGER NOT NULL DEFAULT 0,
        tool_count INTEGER NOT NULL DEFAULT 0,
        tool_names_json TEXT NOT NULL DEFAULT '[]',
        top_tools_json TEXT NOT NULL DEFAULT '[]',
        subagent_count INTEGER NOT NULL DEFAULT 0,
        subagent_share REAL NOT NULL DEFAULT 0,
        models_json TEXT NOT NULL DEFAULT '[]',
        versions_json TEXT NOT NULL DEFAULT '[]',
        git_branches_json TEXT NOT NULL DEFAULT '[]',
        anomaly_badges_top_level_json TEXT NOT NULL DEFAULT '[]',
        anomaly_badges_rolled_up_json TEXT NOT NULL DEFAULT '[]',
        max_request_tokens_top_level INTEGER NOT NULL DEFAULT 0,
        max_request_tokens_rolled_up INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS ingestion_state (
        file_path TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        size_bytes INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_requests_session_id ON requests(session_id);
      CREATE INDEX IF NOT EXISTS idx_requests_agent_id ON requests(agent_id);
      CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_session_id ON tool_calls(session_id);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
    `);
  }

  getIngestionState(filePath: string): { sizeBytes: number; mtimeMs: number } | null {
    const row = this.db
      .prepare(
        `
          SELECT size_bytes AS sizeBytes, mtime_ms AS mtimeMs
          FROM ingestion_state
          WHERE file_path = ?
        `,
      )
      .get(filePath) as { sizeBytes: number; mtimeMs: number } | undefined;
    return row ?? null;
  }

  upsertParsedLog(parsed: ParsedLog, fileStats: { sizeBytes: number; mtimeMs: number }): void {
    runInTransaction(this.db, () => {
      this.db
        .prepare(
          `
            INSERT INTO projects (project_key, label, cwd)
            VALUES (?, ?, ?)
            ON CONFLICT(project_key) DO UPDATE SET
              label = excluded.label,
              cwd = COALESCE(excluded.cwd, projects.cwd)
          `,
        )
        .run(parsed.projectKey, parsed.projectLabel, parsed.cwd);

      this.db
        .prepare(
          `
            INSERT INTO sessions (
              session_id,
              project_key,
              sanitized_project,
              cwd,
              path,
              started_at,
              ended_at,
              duration_sec,
              entrypoint,
              versions_json,
              git_branches_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              project_key = excluded.project_key,
              sanitized_project = excluded.sanitized_project,
              cwd = COALESCE(excluded.cwd, sessions.cwd),
              path = excluded.path,
              started_at = excluded.started_at,
              ended_at = excluded.ended_at,
              duration_sec = excluded.duration_sec,
              entrypoint = excluded.entrypoint,
              versions_json = excluded.versions_json,
              git_branches_json = excluded.git_branches_json
          `,
        )
        .run(
          parsed.sessionId,
          parsed.projectKey,
          parsed.sanitizedProject,
          parsed.cwd,
          parsed.filePath,
          parsed.startedAt,
          parsed.endedAt,
          parsed.durationSec,
          parsed.entrypoint,
          JSON.stringify(parsed.versions),
          JSON.stringify(parsed.gitBranches),
        );

      if (parsed.kind === 'subagent' && parsed.agentId) {
        this.db.prepare('DELETE FROM subagents WHERE agent_id = ?').run(parsed.agentId);
        this.db.prepare('DELETE FROM requests WHERE session_id = ? AND agent_id = ?').run(parsed.sessionId, parsed.agentId);
        this.db.prepare('DELETE FROM events WHERE session_id = ? AND agent_id = ?').run(parsed.sessionId, parsed.agentId);
        this.db.prepare('DELETE FROM tool_calls WHERE session_id = ? AND agent_id = ?').run(parsed.sessionId, parsed.agentId);
        this.db
          .prepare(
            `
              INSERT INTO subagents (agent_id, session_id, path, agent_type, description)
              VALUES (?, ?, ?, ?, ?)
            `,
          )
          .run(
            parsed.agentId,
            parsed.sessionId,
            parsed.filePath,
            parsed.subagentMeta?.agentType ?? null,
            parsed.subagentMeta?.description ?? null,
          );
      } else {
        this.db.prepare('DELETE FROM requests WHERE session_id = ? AND agent_id IS NULL').run(parsed.sessionId);
        this.db.prepare('DELETE FROM events WHERE session_id = ? AND agent_id IS NULL').run(parsed.sessionId);
        this.db.prepare('DELETE FROM tool_calls WHERE session_id = ? AND agent_id IS NULL').run(parsed.sessionId);
      }

      const requestStmt = this.db.prepare(`
        INSERT INTO requests (
          request_uid,
          session_id,
          agent_id,
          request_id,
          message_id,
          timestamp,
          model,
          stop_reason,
          stop_sequence,
          input_tokens,
          output_tokens,
          cache_creation_tokens,
          cache_read_tokens,
          total_tokens,
          fragment_types_json,
          fragments_json,
          tool_names_json,
          has_subagent_context
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const request of parsed.requests) {
        requestStmt.run(
          request.requestUid,
          request.sessionId,
          request.agentId,
          request.requestId,
          request.messageId,
          request.timestamp,
          request.model,
          request.stopReason,
          request.stopSequence,
          request.tokenBreakdown.inputTokens,
          request.tokenBreakdown.outputTokens,
          request.tokenBreakdown.cacheCreationTokens,
          request.tokenBreakdown.cacheReadTokens,
          request.tokenBreakdown.totalTokens,
          JSON.stringify(request.fragmentTypes),
          JSON.stringify(request.fragments),
          JSON.stringify(request.toolNames),
          request.hasSubagentContext ? 1 : 0,
        );
      }

      const eventStmt = this.db.prepare(`
        INSERT INTO events (
          session_id,
          agent_id,
          line_number,
          event_uuid,
          parent_uuid,
          event_type,
          event_subtype,
          data_type,
          timestamp,
          role,
          request_id,
          message_id,
          prompt_id,
          tool_use_id,
          raw_json,
          content_kind
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const event of parsed.events) {
        eventStmt.run(
          event.sessionId,
          event.agentId,
          event.lineNumber,
          event.eventUuid,
          event.parentUuid,
          event.eventType,
          event.eventSubtype,
          event.dataType,
          event.timestamp,
          event.role,
          event.requestId,
          event.messageId,
          event.promptId,
          event.toolUseId,
          event.rawJson,
          event.contentKind,
        );
      }

      const toolStmt = this.db.prepare(`
        INSERT INTO tool_calls (
          tool_call_id,
          session_id,
          agent_id,
          request_uid,
          request_id,
          tool_use_id,
          tool_name,
          tool_input_json,
          result_content,
          result_is_error,
          sequence_index,
          timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const toolCall of parsed.toolCalls) {
        toolStmt.run(
          toolCall.toolCallId,
          toolCall.sessionId,
          toolCall.agentId,
          toolCall.requestUid,
          toolCall.requestId,
          toolCall.toolUseId,
          toolCall.toolName,
          toolCall.toolInputJson,
          toolCall.resultContent,
          toolCall.resultIsError ? 1 : 0,
          toolCall.sequenceIndex,
          toolCall.timestamp,
        );
      }

      this.db
        .prepare(
          `
            INSERT INTO ingestion_state (
              file_path,
              kind,
              session_id,
              agent_id,
              size_bytes,
              mtime_ms,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
              kind = excluded.kind,
              session_id = excluded.session_id,
              agent_id = excluded.agent_id,
              size_bytes = excluded.size_bytes,
              mtime_ms = excluded.mtime_ms,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          parsed.filePath,
          parsed.kind,
          parsed.sessionId,
          parsed.agentId,
          fileStats.sizeBytes,
          fileStats.mtimeMs,
          new Date().toISOString(),
        );
    });
  }

  rebuildSessionRollups(): void {
    const sessions = this.db
      .prepare(
        `
          SELECT
            s.session_id AS sessionId,
            s.project_key AS projectKey,
            s.versions_json AS versionsJson,
            s.git_branches_json AS branchesJson
          FROM sessions s
        `,
      )
      .all() as Array<{
      sessionId: string;
      projectKey: string;
      versionsJson: string;
      branchesJson: string;
    }>;

    const toolCallsBySession = new Map<
      string,
      Array<{ toolName: string; agentId: string | null; sequenceIndex: number; timestamp: string | null }>
    >();
    const toolRows = this.db
      .prepare(
        `
          SELECT session_id AS sessionId, tool_name AS toolName, agent_id AS agentId, sequence_index AS sequenceIndex, timestamp
          FROM tool_calls
          ORDER BY COALESCE(timestamp, ''), sequence_index
        `,
      )
      .all() as Array<{ sessionId: string; toolName: string; agentId: string | null; sequenceIndex: number; timestamp: string | null }>;
    for (const row of toolRows) {
      const bucket = toolCallsBySession.get(row.sessionId) ?? [];
      bucket.push(row);
      toolCallsBySession.set(row.sessionId, bucket);
    }

    const requestRows = this.db
      .prepare(
        `
          SELECT
            session_id AS sessionId,
            agent_id AS agentId,
            total_tokens AS totalTokens,
            input_tokens AS inputTokens,
            output_tokens AS outputTokens,
            cache_creation_tokens AS cacheCreationTokens,
            cache_read_tokens AS cacheReadTokens,
            model,
            request_uid AS requestUid
          FROM requests
        `,
      )
      .all() as Array<{
      sessionId: string;
      agentId: string | null;
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      model: string | null;
      requestUid: string;
    }>;

    const requestMap = new Map<string, typeof requestRows>();
    for (const row of requestRows) {
      const bucket = requestMap.get(row.sessionId) ?? [];
      bucket.push(row);
      requestMap.set(row.sessionId, bucket);
    }

    const subagentCountRows = this.db
      .prepare(
        `
          SELECT session_id AS sessionId, COUNT(*) AS total
          FROM subagents
          GROUP BY session_id
        `,
      )
      .all() as Array<{ sessionId: string; total: number }>;
    const subagentCountMap = new Map(subagentCountRows.map((row) => [row.sessionId, row.total]));

    const userMessageCountRows = this.db
      .prepare(
        `
          SELECT session_id AS sessionId, COUNT(*) AS total
          FROM events
          WHERE agent_id IS NULL AND event_type = 'user' AND content_kind NOT IN ('tool_result', 'tool_result_only')
          GROUP BY session_id
        `,
      )
      .all() as Array<{ sessionId: string; total: number }>;
    const userMessageCountMap = new Map(userMessageCountRows.map((row) => [row.sessionId, row.total]));

    const rollups: SessionRollupRecord[] = sessions.map((session) => {
      const requests = requestMap.get(session.sessionId) ?? [];
      const topLevelRequests = requests.filter((request) => !request.agentId);
      const subagentRequests = requests.filter((request) => !!request.agentId);
      const topLevel = sumBreakdowns(topLevelRequests);
      const rolledUp = sumBreakdowns(requests);
      const toolCalls = toolCallsBySession.get(session.sessionId) ?? [];
      const topLevelToolCalls = toolCalls.filter((toolCall) => !toolCall.agentId);
      const toolNames = unique(toolCalls.map((toolCall) => toolCall.toolName));
      const models = unique(requests.map((request) => request.model).filter(Boolean) as string[]);
      const topTools = getTopTools(toolCalls.map((toolCall) => toolCall.toolName));
      const maxRequestTokensTopLevel = Math.max(0, ...topLevelRequests.map((request) => request.totalTokens));
      const maxRequestTokensRolledUp = Math.max(0, ...requests.map((request) => request.totalTokens));
      const subagentShare = rolledUp.totalTokens > 0 ? (rolledUp.totalTokens - topLevel.totalTokens) / rolledUp.totalTokens : 0;
      const versions = safeJsonArray(session.versionsJson);
      const gitBranches = safeJsonArray(session.branchesJson);
      const topLevelBadges = collectBadges({
        tokenBreakdown: topLevel,
        subagentShare: 0,
        maxRequestTokens: maxRequestTokensTopLevel,
        toolCalls: topLevelToolCalls,
        p90Total: 0,
      });
      const rolledUpBadges = collectBadges({
        tokenBreakdown: rolledUp,
        subagentShare,
        maxRequestTokens: maxRequestTokensRolledUp,
        toolCalls,
        p90Total: 0,
      });

      return {
        sessionId: session.sessionId,
        projectKey: session.projectKey,
        topLevel,
        rolledUp,
        userMessageCount: userMessageCountMap.get(session.sessionId) ?? 0,
        assistantRequestCount: requests.length,
        uniqueToolCount: toolNames.length,
        toolCount: toolCalls.length,
        toolNames,
        topTools,
        subagentCount: subagentCountMap.get(session.sessionId) ?? 0,
        subagentShare,
        models,
        versions,
        gitBranches,
        topLevelBadges,
        rolledUpBadges,
        maxRequestTokensTopLevel,
        maxRequestTokensRolledUp,
      };
    });

    const topP90ByProject = percentileMap(rollups, 'topLevel');
    const rolledP90ByProject = percentileMap(rollups, 'rolledUp');

    runInTransaction(this.db, () => {
      this.db.exec('DELETE FROM session_rollups;');
      const stmt = this.db.prepare(`
        INSERT INTO session_rollups (
          session_id,
          project_key,
          token_breakdown_top_level_json,
          token_breakdown_rolled_up_json,
          user_message_count,
          assistant_request_count,
          unique_tool_count,
          tool_count,
          tool_names_json,
          top_tools_json,
          subagent_count,
          subagent_share,
          models_json,
          versions_json,
          git_branches_json,
          anomaly_badges_top_level_json,
          anomaly_badges_rolled_up_json,
          max_request_tokens_top_level,
          max_request_tokens_rolled_up
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const rollup of rollups) {
        const topBadges = collectBadges({
          tokenBreakdown: rollup.topLevel,
          subagentShare: 0,
          maxRequestTokens: rollup.maxRequestTokensTopLevel,
          toolCalls: (toolCallsBySession.get(rollup.sessionId) ?? []).filter((toolCall) => !toolCall.agentId),
          p90Total: topP90ByProject.get(rollup.projectKey) ?? 0,
        });
        const rolledBadges = collectBadges({
          tokenBreakdown: rollup.rolledUp,
          subagentShare: rollup.subagentShare,
          maxRequestTokens: rollup.maxRequestTokensRolledUp,
          toolCalls: toolCallsBySession.get(rollup.sessionId) ?? [],
          p90Total: rolledP90ByProject.get(rollup.projectKey) ?? 0,
        });

        stmt.run(
          rollup.sessionId,
          rollup.projectKey,
          JSON.stringify(rollup.topLevel),
          JSON.stringify(rollup.rolledUp),
          rollup.userMessageCount,
          rollup.assistantRequestCount,
          rollup.uniqueToolCount,
          rollup.toolCount,
          JSON.stringify(rollup.toolNames),
          JSON.stringify(rollup.topTools),
          rollup.subagentCount,
          rollup.subagentShare,
          JSON.stringify(rollup.models),
          JSON.stringify(rollup.versions),
          JSON.stringify(rollup.gitBranches),
          JSON.stringify(topBadges),
          JSON.stringify(rolledBadges),
          rollup.maxRequestTokensTopLevel,
          rollup.maxRequestTokensRolledUp,
        );
      }
    });
  }

  close(): void {
    this.db.close();
  }
}

function sumBreakdowns(
  requests: Array<{
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
  }>,
) {
  return requests.reduce(
    (accumulator, request) => {
      accumulator.inputTokens += request.inputTokens;
      accumulator.outputTokens += request.outputTokens;
      accumulator.cacheCreationTokens += request.cacheCreationTokens;
      accumulator.cacheReadTokens += request.cacheReadTokens;
      accumulator.totalTokens += request.totalTokens;
      return accumulator;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
    },
  );
}

function getTopTools(toolNames: string[]): string[] {
  const counts = new Map<string, number>();
  for (const toolName of toolNames) {
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([toolName]) => toolName);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function safeJsonArray(value: string): string[] {
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

function percentileMap(rollups: SessionRollupRecord[], key: 'topLevel' | 'rolledUp'): Map<string, number> {
  const buckets = new Map<string, number[]>();
  for (const rollup of rollups) {
    const bucket = buckets.get(rollup.projectKey) ?? [];
    bucket.push(rollup[key].totalTokens);
    buckets.set(rollup.projectKey, bucket);
  }

  const output = new Map<string, number>();
  for (const [projectKey, totals] of buckets.entries()) {
    output.set(projectKey, percentile(totals, 0.9));
  }
  return output;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function collectBadges(input: {
  tokenBreakdown: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
  };
  subagentShare: number;
  maxRequestTokens: number;
  toolCalls: Array<{ toolName: string }>;
  p90Total: number;
}): SessionAnomalyBadge[] {
  const badges: SessionAnomalyBadge[] = [];
  const inputSideTotal =
    input.tokenBreakdown.inputTokens + input.tokenBreakdown.cacheCreationTokens + input.tokenBreakdown.cacheReadTokens;

  if (input.p90Total > 0 && input.tokenBreakdown.totalTokens > input.p90Total) {
    badges.push('Above project P90');
  }

  if (input.subagentShare > 0.25) {
    badges.push('Subagent-heavy');
  }

  if (inputSideTotal > 0 && input.tokenBreakdown.cacheCreationTokens / inputSideTotal > 0.4) {
    badges.push('Cache-build-heavy');
  }

  if (input.tokenBreakdown.totalTokens > 0 && input.maxRequestTokens / input.tokenBreakdown.totalTokens > 0.2) {
    badges.push('Single-request spike');
  }

  if (isToolLoopHeavy(input.toolCalls)) {
    badges.push('Tool-loop heavy');
  }

  return badges;
}

function isToolLoopHeavy(toolCalls: Array<{ toolName: string }>): boolean {
  if (toolCalls.length === 0) {
    return false;
  }

  const counts = new Map<string, number>();
  let currentTool: string | null = null;
  let streak = 0;

  for (const toolCall of toolCalls) {
    counts.set(toolCall.toolName, (counts.get(toolCall.toolName) ?? 0) + 1);
    if (toolCall.toolName === currentTool) {
      streak += 1;
    } else {
      currentTool = toolCall.toolName;
      streak = 1;
    }
    if (streak >= 3) {
      return true;
    }
  }

  return [...counts.values()].some((count) => count >= 5);
}

function runInTransaction(database: DatabaseSync, operation: () => void): void {
  database.exec('BEGIN');
  try {
    operation();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
