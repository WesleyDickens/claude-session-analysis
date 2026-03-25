import type {
  FiltersPayload,
  OverviewPayload,
  SessionDetailPayload,
  SessionQuery,
  SessionRequestsPayload,
  SessionSummary,
  SessionsResponse,
  TimeGranularity,
  TokenBreakdown,
  TokenMode,
  TokenTypeKey,
} from '../../shared/contracts.js';
import { AnalyticsDatabase } from './db.js';

type SessionRow = {
  sessionId: string;
  project: string;
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  modelsJson: string;
  versionsJson: string;
  branchesJson: string;
  topLevelJson: string;
  rolledUpJson: string;
  userMessageCount: number;
  assistantRequestCount: number;
  toolCount: number;
  uniqueToolCount: number;
  toolNamesJson: string;
  topToolsJson: string;
  subagentCount: number;
  subagentShare: number;
  topBadgesJson: string;
  rolledBadgesJson: string;
};

type TimeBreakdownBucket = {
  key: string;
  label: string;
};

const DEFAULT_TOKEN_TYPES: TokenTypeKey[] = ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens'];
const DEFAULT_TIME_GRANULARITY: TimeGranularity = 'daily';
const TIME_SERIES_TIME_ZONE = 'America/New_York';

export class AnalyticsService {
  constructor(private readonly database: AnalyticsDatabase) {}

  getFilters(): FiltersPayload {
    const sessions = this.getSessionSummaries();
    const projects = new Set<string>();
    const models = new Set<string>();
    const versions = new Set<string>();
    const branches = new Set<string>();
    const tools = new Set<string>();
    let min: string | null = null;
    let max: string | null = null;

    for (const session of sessions) {
      projects.add(session.project);
      for (const model of session.models) {
        models.add(model);
      }
      for (const version of session.versionSet) {
        versions.add(version);
      }
      for (const branch of session.gitBranches) {
        branches.add(branch);
      }
      for (const tool of (session as SessionSummary & { allToolNames?: string[] }).allToolNames ?? []) {
        tools.add(tool);
      }
      min = minTimestamp(min, session.startedAt);
      max = maxTimestamp(max, session.startedAt);
    }

    return {
      projects: [...projects].sort(),
      models: [...models].sort(),
      versions: [...versions].sort(),
      branches: [...branches].sort(),
      tools: [...tools].sort(),
      dateBounds: {
        min,
        max,
      },
    };
  }

  getSessions(query: SessionQuery): SessionsResponse {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.max(1, Math.min(100, Number(query.pageSize ?? 20)));
    const filtered = this.filterSessions(query);
    const sorted = sortSessions(filtered, query.tokenMode ?? 'rolled_up', query.sortBy ?? 'startedAt', query.sortDir ?? 'desc');
    const startIndex = (page - 1) * pageSize;
    const items = sorted.slice(startIndex, startIndex + pageSize).map(stripInternalToolNames);

    return {
      total: sorted.length,
      page,
      pageSize,
      items,
    };
  }

  getOverview(query: SessionQuery): OverviewPayload {
    const tokenMode = query.tokenMode ?? 'rolled_up';
    const selectedTokenTypes = normalizeTokenTypes(query.tokenTypes);
    const timeGranularity = normalizeTimeGranularity(query.timeGranularity);
    const sessions = this.filterSessions(query);
    const sessionIds = sessions.map((session) => session.sessionId);
    const requests = this.getRequestsForSessions(sessionIds, tokenMode);
    const toolUsage = this.getToolUsageForSessions(sessionIds, tokenMode);
    const breakdownForSession = (session: SessionSummary) =>
      tokenMode === 'rolled_up' ? session.tokenBreakdownRolledUp : session.tokenBreakdownTopLevel;

    const kpis = {
      totalInputTokens: sum(sessions.map((session) => breakdownForSession(session).inputTokens)),
      totalOutputTokens: sum(sessions.map((session) => breakdownForSession(session).outputTokens)),
      totalCacheCreationTokens: sum(sessions.map((session) => breakdownForSession(session).cacheCreationTokens)),
      totalCacheReadTokens: sum(sessions.map((session) => breakdownForSession(session).cacheReadTokens)),
      totalRequests: requests.length,
      totalUserMessages: sum(sessions.map((session) => session.userMessageCount)),
      totalAssistantTurns: sum(sessions.map((session) => session.assistantRequestCount)),
      uniqueTools: new Set(toolUsage.map((row) => row.toolName)).size,
      totalSessions: sessions.length,
      medianSessionCost: median(sessions.map((session) => totalForTokenTypes(breakdownForSession(session), selectedTokenTypes))),
      medianSessionDuration: median(sessions.map((session) => session.durationSec)),
    };

    const tokenTrendMap = new Map<string, { label: string; breakdown: TokenBreakdown }>();
    const projectMixMap = new Map<string, TokenBreakdown>();
    const modelMixMap = new Map<string, TokenBreakdown>();
    const toolMap = new Map<string, { sessionIds: Set<string>; toolCallCount: number }>();

    for (const request of requests) {
      const bucket = buildTimeBucket(request.timestamp, timeGranularity);
      mergeTimeBreakdown(tokenTrendMap, bucket, request.tokenBreakdown);
    }

    for (const session of sessions) {
      mergeBreakdown(projectMixMap, session.project, breakdownForSession(session));
    }

    for (const request of requests) {
      if (!request.model) {
        continue;
      }
      mergeBreakdown(modelMixMap, request.model, request.tokenBreakdown);
    }

    for (const tool of toolUsage) {
      const bucket = toolMap.get(tool.toolName) ?? { sessionIds: new Set<string>(), toolCallCount: 0 };
      bucket.sessionIds.add(tool.sessionId);
      bucket.toolCallCount += 1;
      toolMap.set(tool.toolName, bucket);
    }

    return {
      kpis,
      tokenTrend: timeBreakdownMapToChronologicalArray(tokenTrendMap).map(({ label, totalTokens: _totalTokens, key: _key, ...rest }) => ({
        bucket: label,
        ...rest,
      })),
      tokenMixByProject: breakdownMapToArray(projectMixMap),
      tokenMixByModel: breakdownMapToArray(modelMixMap),
      topTools: [...toolMap.entries()]
        .map(([toolName, bucket]) => ({
          toolName,
          sessionCount: bucket.sessionIds.size,
          toolCallCount: bucket.toolCallCount,
        }))
        .sort((left, right) => right.toolCallCount - left.toolCallCount || left.toolName.localeCompare(right.toolName))
        .slice(0, 12),
      sessionScatter: sessions.map((session) => ({
        sessionId: session.sessionId,
        project: session.project,
        durationSec: session.durationSec,
        totalTokens: totalForTokenTypes(breakdownForSession(session), selectedTokenTypes),
      })),
    };
  }

  getSessionDetail(sessionId: string): SessionDetailPayload {
    const session = this.getSessionSummaries().find((row) => row.sessionId === sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const subagents = this.database.db
      .prepare(
        `
          SELECT
            s.agent_id AS agentId,
            s.agent_type AS agentType,
            s.description AS description,
            COUNT(r.request_uid) AS requestCount,
            COALESCE(SUM(r.input_tokens), 0) AS inputTokens,
            COALESCE(SUM(r.output_tokens), 0) AS outputTokens,
            COALESCE(SUM(r.cache_creation_tokens), 0) AS cacheCreationTokens,
            COALESCE(SUM(r.cache_read_tokens), 0) AS cacheReadTokens,
            COALESCE(SUM(r.total_tokens), 0) AS totalTokens
          FROM subagents s
          LEFT JOIN requests r ON r.agent_id = s.agent_id
          WHERE s.session_id = ?
          GROUP BY s.agent_id, s.agent_type, s.description
          ORDER BY totalTokens DESC, s.agent_id ASC
        `,
      )
      .all(sessionId) as Array<{
      agentId: string;
      agentType: string | null;
      description: string | null;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      totalTokens: number;
    }>;

    return {
      summary: stripInternalToolNames(session),
      subagents: subagents.map((subagent) => ({
        agentId: subagent.agentId,
        agentType: subagent.agentType,
        description: subagent.description,
        requestCount: subagent.requestCount,
        tokenBreakdown: {
          inputTokens: subagent.inputTokens,
          outputTokens: subagent.outputTokens,
          cacheCreationTokens: subagent.cacheCreationTokens,
          cacheReadTokens: subagent.cacheReadTokens,
          totalTokens: subagent.totalTokens,
        },
      })),
      expensiveReasons: {
        topLevelOnly: session.anomalyBadges.topLevelOnly,
        rolledUp: session.anomalyBadges.rolledUp,
      },
    };
  }

  getSessionRequests(sessionId: string, tokenMode: TokenMode): SessionRequestsPayload {
    const rows = this.database.db
      .prepare(
        `
          SELECT
            request_uid AS requestUid,
            session_id AS sessionId,
            agent_id AS agentId,
            request_id AS requestId,
            timestamp,
            model,
            stop_reason AS stopReason,
            input_tokens AS inputTokens,
            output_tokens AS outputTokens,
            cache_creation_tokens AS cacheCreationTokens,
            cache_read_tokens AS cacheReadTokens,
            total_tokens AS totalTokens,
            tool_names_json AS toolNamesJson,
            fragment_types_json AS fragmentTypesJson,
            fragments_json AS fragmentsJson,
            has_subagent_context AS hasSubagentContext
          FROM requests
          WHERE session_id = ?
          ORDER BY COALESCE(timestamp, ''), request_uid
        `,
      )
      .all(sessionId) as Array<{
      requestUid: string;
      sessionId: string;
      agentId: string | null;
      requestId: string | null;
      timestamp: string | null;
      model: string | null;
      stopReason: string | null;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      totalTokens: number;
      toolNamesJson: string;
      fragmentTypesJson: string;
      fragmentsJson: string;
      hasSubagentContext: number;
    }>;

    return {
      items: rows
        .filter((row) => tokenMode === 'rolled_up' || !row.agentId)
        .map((row) => ({
          requestId: row.requestId ?? row.requestUid,
          sessionId: row.sessionId,
          agentId: row.agentId,
          timestamp: row.timestamp,
          model: row.model,
          stopReason: row.stopReason,
          tokenBreakdown: {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheCreationTokens: row.cacheCreationTokens,
            cacheReadTokens: row.cacheReadTokens,
            totalTokens: row.totalTokens,
          },
          toolCount: safeJsonArray(row.toolNamesJson).length,
          toolNames: safeJsonArray(row.toolNamesJson),
          fragmentTypes: safeJsonArray(row.fragmentTypesJson),
          fragments: safeJsonObjectArray(row.fragmentsJson) as Array<{ kind: string; content: string }>,
          hasSubagentContext: Boolean(row.hasSubagentContext),
        })),
    };
  }

  private filterSessions(query: SessionQuery): SessionSummary[] {
    const sessions = this.getSessionSummaries();
    return sessions.filter((session) => {
      const projectMatch = !query.projects?.length || query.projects.includes(session.project);
      const modelMatch = !query.models?.length || intersects(query.models, session.models);
      const versionMatch = !query.versions?.length || intersects(query.versions, session.versionSet);
      const branchMatch = !query.branches?.length || intersects(query.branches, session.gitBranches);
      const toolMatch =
        !query.tools?.length || intersects(query.tools, (session as SessionSummary & { allToolNames?: string[] }).allToolNames ?? []);
      const sessionMatch =
        !query.sessionSearch ||
        session.sessionId.toLowerCase().includes(query.sessionSearch.toLowerCase()) ||
        session.project.toLowerCase().includes(query.sessionSearch.toLowerCase()) ||
        (session.cwd ?? '').toLowerCase().includes(query.sessionSearch.toLowerCase());
      const dateMatch = inDateRange(session.startedAt, query.dateFrom, query.dateTo);
      return projectMatch && modelMatch && versionMatch && branchMatch && toolMatch && sessionMatch && dateMatch;
    });
  }

  private getSessionSummaries(): Array<SessionSummary & { allToolNames: string[] }> {
    const rows = this.database.db
      .prepare(
        `
          SELECT
            s.session_id AS sessionId,
            p.label AS project,
            s.cwd AS cwd,
            s.started_at AS startedAt,
            s.ended_at AS endedAt,
            s.duration_sec AS durationSec,
            r.models_json AS modelsJson,
            r.versions_json AS versionsJson,
            r.git_branches_json AS branchesJson,
            r.token_breakdown_top_level_json AS topLevelJson,
            r.token_breakdown_rolled_up_json AS rolledUpJson,
            r.user_message_count AS userMessageCount,
            r.assistant_request_count AS assistantRequestCount,
            r.tool_count AS toolCount,
            r.unique_tool_count AS uniqueToolCount,
            r.tool_names_json AS toolNamesJson,
            r.top_tools_json AS topToolsJson,
            r.subagent_count AS subagentCount,
            r.subagent_share AS subagentShare,
            r.anomaly_badges_top_level_json AS topBadgesJson,
            r.anomaly_badges_rolled_up_json AS rolledBadgesJson
          FROM sessions s
          JOIN projects p ON p.project_key = s.project_key
          LEFT JOIN session_rollups r ON r.session_id = s.session_id
        `,
      )
      .all() as SessionRow[];

    return rows.map((row) => ({
      sessionId: row.sessionId,
      project: row.project,
      cwd: row.cwd,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationSec: row.durationSec,
      models: safeJsonArray(row.modelsJson),
      versionSet: safeJsonArray(row.versionsJson),
      gitBranches: safeJsonArray(row.branchesJson),
      tokenBreakdownTopLevel: safeBreakdown(row.topLevelJson),
      tokenBreakdownRolledUp: safeBreakdown(row.rolledUpJson),
      userMessageCount: row.userMessageCount ?? 0,
      assistantRequestCount: row.assistantRequestCount ?? 0,
      toolCount: row.toolCount ?? 0,
      uniqueToolCount: row.uniqueToolCount ?? 0,
      topTools: safeJsonArray(row.topToolsJson),
      allToolNames: safeJsonArray(row.toolNamesJson),
      subagentCount: row.subagentCount ?? 0,
      subagentShare: row.subagentShare ?? 0,
      anomalyBadges: {
        topLevelOnly: safeJsonArray(row.topBadgesJson) as SessionSummary['anomalyBadges']['topLevelOnly'],
        rolledUp: safeJsonArray(row.rolledBadgesJson) as SessionSummary['anomalyBadges']['rolledUp'],
      },
    }));
  }

  private getRequestsForSessions(sessionIds: string[], tokenMode: TokenMode) {
    if (sessionIds.length === 0) {
      return [] as Array<{
        sessionId: string;
        timestamp: string | null;
        model: string | null;
        tokenBreakdown: TokenBreakdown;
      }>;
    }
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = this.database.db
      .prepare(
        `
          SELECT
            session_id AS sessionId,
            agent_id AS agentId,
            timestamp,
            model,
            input_tokens AS inputTokens,
            output_tokens AS outputTokens,
            cache_creation_tokens AS cacheCreationTokens,
            cache_read_tokens AS cacheReadTokens,
            total_tokens AS totalTokens
          FROM requests
          WHERE session_id IN (${placeholders})
        `,
      )
      .all(...sessionIds) as Array<{
      sessionId: string;
      agentId: string | null;
      timestamp: string | null;
      model: string | null;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      totalTokens: number;
    }>;
    return rows
      .filter((row) => tokenMode === 'rolled_up' || !row.agentId)
      .map((row) => ({
        sessionId: row.sessionId,
        timestamp: row.timestamp,
        model: row.model,
        tokenBreakdown: {
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheCreationTokens: row.cacheCreationTokens,
          cacheReadTokens: row.cacheReadTokens,
          totalTokens: row.totalTokens,
        },
      }));
  }

  private getToolUsageForSessions(sessionIds: string[], tokenMode: TokenMode) {
    if (sessionIds.length === 0) {
      return [] as Array<{ sessionId: string; toolName: string }>;
    }
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = this.database.db
      .prepare(
        `
          SELECT session_id AS sessionId, agent_id AS agentId, tool_name AS toolName
          FROM tool_calls
          WHERE session_id IN (${placeholders})
        `,
      )
      .all(...sessionIds) as Array<{ sessionId: string; agentId: string | null; toolName: string }>;
    return rows.filter((row) => tokenMode === 'rolled_up' || !row.agentId);
  }
}

function stripInternalToolNames(session: SessionSummary & { allToolNames?: string[] }): SessionSummary {
  const { allToolNames: _allToolNames, ...rest } = session;
  return rest;
}

function inDateRange(value: string | null, dateFrom?: string, dateTo?: string): boolean {
  if (!value) {
    return !dateFrom && !dateTo;
  }
  const day = value.slice(0, 10);
  if (dateFrom && day < dateFrom) {
    return false;
  }
  if (dateTo && day > dateTo) {
    return false;
  }
  return true;
}

function intersects(left: string[], right: string[]): boolean {
  const set = new Set(right);
  return left.some((value) => set.has(value));
}

function sortSessions(sessions: SessionSummary[], tokenMode: TokenMode, sortBy: string, sortDir: 'asc' | 'desc'): SessionSummary[] {
  const direction = sortDir === 'asc' ? 1 : -1;
  const getTokens = (session: SessionSummary) =>
    tokenMode === 'rolled_up' ? session.tokenBreakdownRolledUp.totalTokens : session.tokenBreakdownTopLevel.totalTokens;
  const getBadges = (session: SessionSummary) =>
    tokenMode === 'rolled_up' ? session.anomalyBadges.rolledUp : session.anomalyBadges.topLevelOnly;

  return [...sessions].sort((left, right) => {
    let comparison = 0;
    switch (sortBy) {
      case 'project':
        comparison = left.project.localeCompare(right.project);
        break;
      case 'sessionId':
        comparison = left.sessionId.localeCompare(right.sessionId);
        break;
      case 'durationSec':
        comparison = left.durationSec - right.durationSec;
        break;
      case 'toolCount':
        comparison = left.toolCount - right.toolCount;
        break;
      case 'models':
        comparison = left.models.join(', ').localeCompare(right.models.join(', '));
        break;
      case 'subagentShare':
        comparison = left.subagentShare - right.subagentShare;
        break;
      case 'badgeCount':
        comparison = getBadges(left).length - getBadges(right).length;
        break;
      case 'assistantRequestCount':
        comparison = left.assistantRequestCount - right.assistantRequestCount;
        break;
      case 'totalTokens':
        comparison = getTokens(left) - getTokens(right);
        break;
      case 'startedAt':
      default:
        comparison = (left.startedAt ?? '').localeCompare(right.startedAt ?? '');
        break;
    }
    if (comparison === 0) {
      comparison = left.sessionId.localeCompare(right.sessionId);
    }
    return comparison * direction;
  });
}

function mergeBreakdown(map: Map<string, TokenBreakdown>, key: string, value: TokenBreakdown): void {
  const current = map.get(key) ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };
  current.inputTokens += value.inputTokens;
  current.outputTokens += value.outputTokens;
  current.cacheCreationTokens += value.cacheCreationTokens;
  current.cacheReadTokens += value.cacheReadTokens;
  current.totalTokens += value.totalTokens;
  map.set(key, current);
}

function breakdownMapToArray(map: Map<string, TokenBreakdown>) {
  return [...map.entries()]
    .map(([label, breakdown]) => ({
      label,
      ...breakdown,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens || left.label.localeCompare(right.label));
}

function breakdownMapToChronologicalArray(map: Map<string, TokenBreakdown>) {
  return [...map.entries()]
    .map(([label, breakdown]) => ({
      label,
      ...breakdown,
    }))
    .sort((left, right) => compareTimeBucketKey(left.label, right.label));
}

function timeBreakdownMapToChronologicalArray(map: Map<string, { label: string; breakdown: TokenBreakdown }>) {
  return [...map.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      ...bucket.breakdown,
    }))
    .sort((left, right) => compareTimeBucketKey(left.key, right.key));
}

function compareTimeBucketKey(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left === 'Unknown') {
    return 1;
  }
  if (right === 'Unknown') {
    return -1;
  }
  return left.localeCompare(right);
}

function mergeTimeBreakdown(
  map: Map<string, { label: string; breakdown: TokenBreakdown }>,
  bucket: TimeBreakdownBucket,
  value: TokenBreakdown,
): void {
  const current = map.get(bucket.key) ?? {
    label: bucket.label,
    breakdown: emptyBreakdown(),
  };
  current.breakdown.inputTokens += value.inputTokens;
  current.breakdown.outputTokens += value.outputTokens;
  current.breakdown.cacheCreationTokens += value.cacheCreationTokens;
  current.breakdown.cacheReadTokens += value.cacheReadTokens;
  current.breakdown.totalTokens += value.totalTokens;
  map.set(bucket.key, current);
}

function normalizeTimeGranularity(value?: TimeGranularity): TimeGranularity {
  return value ?? DEFAULT_TIME_GRANULARITY;
}

function normalizeTokenTypes(value?: TokenTypeKey[]): TokenTypeKey[] {
  if (!value?.length) {
    return DEFAULT_TOKEN_TYPES;
  }

  const filtered = DEFAULT_TOKEN_TYPES.filter((tokenType) => value.includes(tokenType));
  return filtered.length ? filtered : DEFAULT_TOKEN_TYPES;
}

function totalForTokenTypes(breakdown: TokenBreakdown, tokenTypes: TokenTypeKey[]): number {
  return tokenTypes.reduce((total, tokenType) => total + breakdown[tokenType], 0);
}

function buildTimeBucket(timestamp: string | null, granularity: TimeGranularity): TimeBreakdownBucket {
  if (!timestamp) {
    return {
      key: 'Unknown',
      label: 'Unknown',
    };
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return {
      key: 'Unknown',
      label: 'Unknown',
    };
  }

  const zoned = getTimeZoneParts(date, TIME_SERIES_TIME_ZONE);
  const dateKey = formatDateParts(zoned);

  switch (granularity) {
    case 'hourly':
      return {
        key: `${dateKey}T${zoned.hour}`,
        label: `${dateKey} ${formatHourLabel(zoned.hour)}`,
      };
    case 'weekly':
      return {
        key: formatIsoWeek(zoned),
        label: formatIsoWeek(zoned),
      };
    case 'monthly':
      return {
        key: `${zoned.year}-${zoned.month}`,
        label: `${zoned.year}-${zoned.month}`,
      };
    case 'daily':
    default:
      return {
        key: dateKey,
        label: dateKey,
      };
  }
}

function formatDateParts(parts: { year: string; month: string; day: string }): string {
  return [parts.year, parts.month, parts.day].join('-');
}

function formatIsoWeek(parts: { year: string; month: string; day: string }): string {
  const utcDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  return {
    year: parts.find((part) => part.type === 'year')?.value ?? '0000',
    month: parts.find((part) => part.type === 'month')?.value ?? '01',
    day: parts.find((part) => part.type === 'day')?.value ?? '01',
    hour: parts.find((part) => part.type === 'hour')?.value ?? '00',
  };
}

function formatHourLabel(hour: string): string {
  const numericHour = Number(hour);
  if (Number.isNaN(numericHour)) {
    return hour;
  }

  const normalizedHour = numericHour % 24;
  const period = normalizedHour >= 12 ? 'PM' : 'AM';
  const twelveHour = normalizedHour % 12 || 12;
  return `${twelveHour} ${period}`;
}

function sum(values: number[]): number {
  return values.reduce((accumulator, value) => accumulator + value, 0);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[midpoint - 1] + sorted[midpoint]) / 2);
  }
  return sorted[midpoint] ?? 0;
}

function safeJsonArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    return JSON.parse(value) as string[];
  } catch {
    return [];
  }
}

function safeJsonObjectArray(value: string | null | undefined): unknown[] {
  if (!value) {
    return [];
  }
  try {
    return JSON.parse(value) as unknown[];
  } catch {
    return [];
  }
}

function safeBreakdown(value: string | null | undefined): TokenBreakdown {
  if (!value) {
    return emptyBreakdown();
  }
  try {
    return JSON.parse(value) as TokenBreakdown;
  } catch {
    return emptyBreakdown();
  }
}

function emptyBreakdown(): TokenBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };
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
