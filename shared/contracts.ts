export type TokenBreakdown = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
};

export type TokenMode = 'rolled_up' | 'top_level_only';
export type TimeGranularity = 'hourly' | 'daily' | 'weekly' | 'monthly';

export type TokenTypeKey = 'inputTokens' | 'outputTokens' | 'cacheCreationTokens' | 'cacheReadTokens';

export type SessionAnomalyBadge =
  | 'Above project P90'
  | 'Subagent-heavy'
  | 'Cache-build-heavy'
  | 'Single-request spike'
  | 'Tool-loop heavy';

export type ScanSummary = {
  startedAt: string;
  finishedAt: string;
  filesDiscovered: number;
  filesScanned: number;
  filesSkipped: number;
  sessionsUpdated: number;
  subagentsUpdated: number;
  errors: string[];
};

export type FiltersPayload = {
  projects: string[];
  models: string[];
  versions: string[];
  branches: string[];
  tools: string[];
  dateBounds: {
    min: string | null;
    max: string | null;
  };
};

export type SessionSummary = {
  sessionId: string;
  project: string;
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  models: string[];
  versionSet: string[];
  gitBranches: string[];
  tokenBreakdownTopLevel: TokenBreakdown;
  tokenBreakdownRolledUp: TokenBreakdown;
  userMessageCount: number;
  assistantRequestCount: number;
  toolCount: number;
  uniqueToolCount: number;
  topTools: string[];
  subagentCount: number;
  subagentShare: number;
  anomalyBadges: {
    topLevelOnly: SessionAnomalyBadge[];
    rolledUp: SessionAnomalyBadge[];
  };
};

export type OverviewKpis = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalRequests: number;
  totalUserMessages: number;
  totalAssistantTurns: number;
  uniqueTools: number;
  totalSessions: number;
  medianSessionCost: number;
  medianSessionDuration: number;
};

export type OverviewPayload = {
  kpis: OverviewKpis;
  tokenTrend: Array<{
    bucket: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  }>;
  tokenMixByProject: Array<{
    label: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  }>;
  tokenMixByModel: Array<{
    label: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  }>;
  topTools: Array<{
    toolName: string;
    sessionCount: number;
    toolCallCount: number;
  }>;
  sessionScatter: Array<{
    sessionId: string;
    project: string;
    durationSec: number;
    totalTokens: number;
  }>;
};

export type SessionsResponse = {
  total: number;
  page: number;
  pageSize: number;
  items: SessionSummary[];
};

export type RequestFragment = {
  kind: string;
  content: string;
};

export type RequestSummary = {
  requestId: string;
  sessionId: string;
  agentId: string | null;
  timestamp: string | null;
  model: string | null;
  stopReason: string | null;
  tokenBreakdown: TokenBreakdown;
  toolCount: number;
  toolNames: string[];
  fragmentTypes: string[];
  fragments: RequestFragment[];
  hasSubagentContext: boolean;
};

export type SessionDetailPayload = {
  summary: SessionSummary;
  subagents: Array<{
    agentId: string;
    agentType: string | null;
    description: string | null;
    tokenBreakdown: TokenBreakdown;
    requestCount: number;
  }>;
  expensiveReasons: {
    topLevelOnly: SessionAnomalyBadge[];
    rolledUp: SessionAnomalyBadge[];
  };
};

export type SessionRequestsPayload = {
  items: RequestSummary[];
};

export type SessionQuery = {
  projects?: string[];
  models?: string[];
  versions?: string[];
  branches?: string[];
  tools?: string[];
  tokenTypes?: TokenTypeKey[];
  timeGranularity?: TimeGranularity;
  dateFrom?: string;
  dateTo?: string;
  sessionSearch?: string;
  tokenMode?: TokenMode;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};
