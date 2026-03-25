import type { ScanSummary, SessionAnomalyBadge, TokenBreakdown } from '../../shared/contracts.js';

export type LogKind = 'session' | 'subagent';

export type ScanTarget = {
  filePath: string;
  kind: LogKind;
  sessionId: string;
  agentId: string | null;
  sanitizedProject: string;
  metaPath: string | null;
};

export type ParsedEvent = {
  lineNumber: number;
  sessionId: string;
  agentId: string | null;
  eventUuid: string | null;
  parentUuid: string | null;
  eventType: string;
  eventSubtype: string | null;
  dataType: string | null;
  timestamp: string | null;
  role: string | null;
  requestId: string | null;
  messageId: string | null;
  promptId: string | null;
  toolUseId: string | null;
  rawJson: string;
  contentKind: string | null;
};

export type ParsedRequest = {
  requestUid: string;
  sessionId: string;
  agentId: string | null;
  requestId: string | null;
  messageId: string | null;
  timestamp: string | null;
  model: string | null;
  stopReason: string | null;
  stopSequence: string | null;
  tokenBreakdown: TokenBreakdown;
  fragmentTypes: string[];
  fragments: Array<{ kind: string; content: string }>;
  toolNames: string[];
  hasSubagentContext: boolean;
};

export type ParsedToolCall = {
  toolCallId: string;
  sessionId: string;
  agentId: string | null;
  requestUid: string | null;
  requestId: string | null;
  toolUseId: string | null;
  toolName: string;
  toolInputJson: string;
  resultContent: string | null;
  resultIsError: boolean;
  sequenceIndex: number;
  timestamp: string | null;
};

export type ParsedLog = {
  kind: LogKind;
  sessionId: string;
  agentId: string | null;
  sanitizedProject: string;
  projectKey: string;
  projectLabel: string;
  cwd: string | null;
  filePath: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  entrypoint: string | null;
  versions: string[];
  gitBranches: string[];
  userMessageCount: number;
  requests: ParsedRequest[];
  events: ParsedEvent[];
  toolCalls: ParsedToolCall[];
  subagentMeta: {
    agentType: string | null;
    description: string | null;
  } | null;
};

export type SessionRollupRecord = {
  sessionId: string;
  projectKey: string;
  topLevel: TokenBreakdown;
  rolledUp: TokenBreakdown;
  userMessageCount: number;
  assistantRequestCount: number;
  uniqueToolCount: number;
  toolCount: number;
  toolNames: string[];
  topTools: string[];
  subagentCount: number;
  subagentShare: number;
  models: string[];
  versions: string[];
  gitBranches: string[];
  topLevelBadges: SessionAnomalyBadge[];
  rolledUpBadges: SessionAnomalyBadge[];
  maxRequestTokensTopLevel: number;
  maxRequestTokensRolledUp: number;
};

export type ScanResult = ScanSummary;
