import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import type {
  FiltersPayload,
  OverviewPayload,
  RequestSummary,
  ScanSummary,
  SessionDetailPayload,
  SessionQuery,
  SessionSummary,
  SessionsResponse,
  TimeGranularity,
  TokenBreakdown,
  TokenMode,
  TokenTypeKey,
} from '../../shared/contracts';
import { api } from './api';

const PAGE_SIZE = 20;
const CHART_COLORS = ['#0f766e', '#d97706', '#0284c7', '#7c3aed', '#dc2626', '#65a30d'];
const TOKEN_TYPE_OPTIONS: Array<{
  key: TokenTypeKey;
  label: string;
  metricLabel: string;
  tone: 'input' | 'output' | 'cache-create' | 'cache-read';
  color: string;
  fillOpacity: number;
}> = [
  { key: 'inputTokens', label: 'Input', metricLabel: 'Input tokens', tone: 'input', color: '#0f766e', fillOpacity: 0.55 },
  { key: 'outputTokens', label: 'Output', metricLabel: 'Output tokens', tone: 'output', color: '#d97706', fillOpacity: 0.45 },
  {
    key: 'cacheCreationTokens',
    label: 'Cache build',
    metricLabel: 'Cache creation',
    tone: 'cache-create',
    color: '#0284c7',
    fillOpacity: 0.45,
  },
  { key: 'cacheReadTokens', label: 'Cache read', metricLabel: 'Cache read', tone: 'cache-read', color: '#7c3aed', fillOpacity: 0.35 },
];
const TOKEN_TYPE_KPI_KEYS: Record<TokenTypeKey, keyof OverviewPayload['kpis']> = {
  inputTokens: 'totalInputTokens',
  outputTokens: 'totalOutputTokens',
  cacheCreationTokens: 'totalCacheCreationTokens',
  cacheReadTokens: 'totalCacheReadTokens',
};
const TIME_GRANULARITY_OPTIONS: Array<{ value: TimeGranularity; label: string }> = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
const DETAIL_TIME_GRANULARITY_OPTIONS = [
  { value: 'minute', label: 'Minute' },
  { value: 'hour', label: 'Hour' },
] as const;
const DETAIL_TIME_ZONE = 'America/New_York';
const TABLE_SORT_DEFAULT_DIRECTIONS: Record<string, 'asc' | 'desc'> = {
  project: 'asc',
  sessionId: 'asc',
  startedAt: 'desc',
  durationSec: 'desc',
  totalTokens: 'desc',
  models: 'asc',
  toolCount: 'desc',
  subagentShare: 'desc',
  badgeCount: 'desc',
  assistantRequestCount: 'desc',
};

type DetailTimeGranularity = (typeof DETAIL_TIME_GRANULARITY_OPTIONS)[number]['value'];

export function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
    </Routes>
  );
}

function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const query = readQuery(searchParams);
  const [filters, setFilters] = useState<FiltersPayload | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [sessions, setSessions] = useState<SessionsResponse | null>(null);
  const [selectedCompareIds, setSelectedCompareIds] = useState<string[]>([]);
  const [compareDetails, setCompareDetails] = useState<SessionDetailPayload[]>([]);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadingFilters(true);
    api
      .getFilters()
      .then((response) => {
        if (active) {
          setFilters(response);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (active) {
          setLoadingFilters(false);
        }
      });
    return () => {
      active = false;
    };
  }, [scanSummary]);

  useEffect(() => {
    let active = true;
    setLoadingOverview(true);
    api
      .getOverview(query)
      .then((response) => {
        if (active) {
          setOverview(response);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (active) {
          setLoadingOverview(false);
        }
      });
    return () => {
      active = false;
    };
  }, [searchParams, scanSummary]);

  useEffect(() => {
    let active = true;
    setLoadingSessions(true);
    api
      .getSessions({ ...query, pageSize: PAGE_SIZE })
      .then((response) => {
        if (active) {
          setSessions(response);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (active) {
          setLoadingSessions(false);
        }
      });
    return () => {
      active = false;
    };
  }, [searchParams, scanSummary]);

  useEffect(() => {
    let active = true;
    if (selectedCompareIds.length === 0) {
      setCompareDetails([]);
      return () => {
        active = false;
      };
    }
    setLoadingCompare(true);
    Promise.all(selectedCompareIds.map((sessionId) => api.getSessionDetail(sessionId)))
      .then((response) => {
        if (active) {
          setCompareDetails(response);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (active) {
          setLoadingCompare(false);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedCompareIds]);

  function updateQuery(next: Partial<SessionQuery>) {
    const merged: SessionQuery = {
      ...query,
      ...next,
      page:
        next.page ??
        (next.sortBy ||
        next.sortDir ||
        next.projects ||
        next.models ||
        next.tools ||
        next.sessionSearch ||
        next.dateFrom ||
        next.dateTo ||
        next.versions ||
        next.branches ||
        next.tokenMode
          ? 1
          : query.page),
    };
    const params = new URLSearchParams();
    writeArray(params, 'projects', merged.projects);
    writeArray(params, 'models', merged.models);
    writeArray(params, 'versions', merged.versions);
    writeArray(params, 'branches', merged.branches);
    writeArray(params, 'tools', merged.tools);
    writeArray(params, 'tokenTypes', shouldPersistTokenTypes(merged.tokenTypes) ? merged.tokenTypes : undefined);
    writeValue(params, 'dateFrom', merged.dateFrom);
    writeValue(params, 'dateTo', merged.dateTo);
    writeValue(params, 'sessionSearch', merged.sessionSearch);
    writeValue(params, 'tokenMode', merged.tokenMode);
    writeValue(params, 'timeGranularity', merged.timeGranularity);
    writeValue(params, 'sortBy', merged.sortBy);
    writeValue(params, 'sortDir', merged.sortBy ? merged.sortDir : undefined);
    if (merged.page && merged.page > 1) {
      params.set('page', String(merged.page));
    }
    setSearchParams(params, { replace: true });
  }

  function toggleArrayValue(key: keyof SessionQuery, value: string) {
    const current = new Set((query[key] as string[] | undefined) ?? []);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    updateQuery({ [key]: [...current].sort() } as Partial<SessionQuery>);
  }

  function toggleTokenType(tokenType: TokenTypeKey) {
    const current = new Set(selectedTokenTypes);
    if (current.has(tokenType)) {
      if (current.size === 1) {
        return;
      }
      current.delete(tokenType);
    } else {
      current.add(tokenType);
    }

    updateQuery({
      tokenTypes: TOKEN_TYPE_OPTIONS.map((option) => option.key).filter((key) => current.has(key)),
    });
  }

  function setTableSort(sortBy?: string, sortDir?: 'asc' | 'desc') {
    updateQuery({
      sortBy,
      sortDir: sortBy ? sortDir : undefined,
      page: 1,
    });
  }

  function cycleTableSort(sortBy: string) {
    const initialDirection = getInitialTableSortDirection(sortBy);
    const currentDirection = query.sortBy === sortBy ? activeSortDirection : undefined;
    if (query.sortBy !== sortBy) {
      setTableSort(sortBy, initialDirection);
      return;
    }
    if (currentDirection === initialDirection) {
      setTableSort(sortBy, initialDirection === 'asc' ? 'desc' : 'asc');
      return;
    }
    setTableSort(undefined, undefined);
  }

  function toggleCompare(sessionId: string) {
    setSelectedCompareIds((current) => {
      if (current.includes(sessionId)) {
        return current.filter((value) => value !== sessionId);
      }
      if (current.length >= 2) {
        return [current[1], sessionId];
      }
      return [...current, sessionId];
    });
  }

  async function runScan() {
    setScanning(true);
    try {
      const response = await api.scan();
      setScanSummary(response);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setScanning(false);
    }
  }

  const tokenMode = query.tokenMode ?? 'rolled_up';
  const timeGranularity = query.timeGranularity ?? 'daily';
  const selectedTokenTypes = normalizeTokenTypes(query.tokenTypes);
  const selectedTokenOptions = TOKEN_TYPE_OPTIONS.filter((option) => selectedTokenTypes.includes(option.key));
  const activeSortDirection = query.sortBy ? query.sortDir ?? getInitialTableSortDirection(query.sortBy) : undefined;
  const totalSelectedTokens = overview
    ? totalOverviewTokens(overview.kpis, selectedTokenTypes)
    : 0;
  const activeFilterCount = countActiveFilters(query);
  const scopeText = describeScope(query);
  const dateWindow = describeDateWindow(filters?.dateBounds.min ?? null, filters?.dateBounds.max ?? null, query.dateFrom, query.dateTo);
  const selectedTokenBreakdown = overview
    ? selectedTokenOptions.map((option) => ({
        label: option.label,
        value: overview.kpis[TOKEN_TYPE_KPI_KEYS[option.key]],
        tone: option.tone,
      }))
    : [];
  const tokenScopeText = describeTokenScope(selectedTokenOptions.map((option) => option.label));
  const timeGranularityLabel = describeTimeGranularity(timeGranularity);

  return (
    <div className="page-shell">
      <div className="background-orb background-orb-left" />
      <div className="background-orb background-orb-right" />
      <header className="app-topbar motion-rise delay-0">
        <div className="brand-column">
          <div className="eyebrow">Claude Session Analytics</div>
          <h1>Session analytics</h1>
          <p>Read-only analytics over <code>~/.claude/projects</code> with filters for project, model, tool, and date.</p>
        </div>
        <div className="topbar-side">
          <div className="topbar-meta">
            <span className="topbar-kicker">Current slice</span>
            <strong>{scopeText}</strong>
            <span>
              {activeFilterCount} active filters · {dateWindow}
            </span>
          </div>
          <div className="hero-actions">
            <div className="segmented-control">
              <button
                className={tokenMode === 'rolled_up' ? 'active' : ''}
                onClick={() => updateQuery({ tokenMode: 'rolled_up' })}
              >
                Rolled Up
              </button>
              <button
                className={tokenMode === 'top_level_only' ? 'active' : ''}
                onClick={() => updateQuery({ tokenMode: 'top_level_only' })}
              >
                Top Level Only
              </button>
            </div>
            <button className="button button-primary" onClick={runScan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Refresh Index'}
            </button>
            {scanSummary ? (
              <div className="scan-badge">
                <strong>{scanSummary.filesScanned}</strong> files rescanned
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="control-rail motion-rise delay-1">
          <details className="filter-drawer" open>
            <summary className="filter-drawer-toggle">
              <span className="panel-title">Filters</span>
              <span className="filter-drawer-badge">{activeFilterCount} active</span>
            </summary>
          <section className="rail-section">
            <div className="panel-header filter-drawer-header-desktop">
              <div>
                <div className="panel-title">Filters</div>
                <div className="panel-subtitle">Control the slice before comparing sessions or drilling into a ledger.</div>
              </div>
            </div>

            <div className="filter-grid">
              <label className="field">
                <span>Session or project search</span>
                <input
                  value={query.sessionSearch ?? ''}
                  onChange={(event) => updateQuery({ sessionSearch: event.target.value || undefined })}
                  placeholder="Session id, project, cwd"
                />
              </label>
              <label className="field">
                <span>Date from</span>
                <input
                  type="date"
                  value={query.dateFrom ?? ''}
                  onChange={(event) => updateQuery({ dateFrom: event.target.value || undefined })}
                />
              </label>
              <label className="field">
                <span>Date to</span>
                <input type="date" value={query.dateTo ?? ''} onChange={(event) => updateQuery({ dateTo: event.target.value || undefined })} />
              </label>
              <label className="field">
                <span>Sort sessions by</span>
                <select
                  value={query.sortBy ?? ''}
                  onChange={(event) => {
                    const nextSortBy = event.target.value || undefined;
                    if (!nextSortBy) {
                      setTableSort(undefined, undefined);
                      return;
                    }
                    setTableSort(nextSortBy, getInitialTableSortDirection(nextSortBy));
                  }}
                >
                  <option value="">Default order</option>
                  <option value="startedAt">Started At</option>
                  <option value="totalTokens">Total Tokens</option>
                  <option value="sessionId">Session ID</option>
                  <option value="durationSec">Duration</option>
                  <option value="toolCount">Tool Count</option>
                  <option value="assistantRequestCount">Assistant Requests</option>
                  <option value="models">Models</option>
                  <option value="subagentShare">Subagent Share</option>
                  <option value="badgeCount">Badge Count</option>
                  <option value="project">Project</option>
                </select>
              </label>
              <label className="field">
                <span>Sort direction</span>
                <select
                  value={query.sortBy ? activeSortDirection ?? getInitialTableSortDirection(query.sortBy) : ''}
                  onChange={(event) => {
                    if (!query.sortBy) {
                      return;
                    }
                    setTableSort(query.sortBy, event.target.value as 'asc' | 'desc');
                  }}
                  disabled={!query.sortBy}
                >
                  <option value="" disabled>
                    Select direction
                  </option>
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </label>
            </div>
          </section>

          <section className="rail-section">
            <div className="rail-meta">
              <div>
                <span className="topbar-kicker">Token scope</span>
                <strong>{selectedTokenOptions.length} types included</strong>
              </div>
              <div className="muted">Affects token KPIs, stacked charts, and scatter totals.</div>
            </div>
            <div className="chip-wrap">
              {TOKEN_TYPE_OPTIONS.map((option) => {
                const active = selectedTokenTypes.includes(option.key);
                return (
                  <button
                    key={option.key}
                    className={active ? 'chip chip-active' : 'chip'}
                    onClick={() => toggleTokenType(option.key)}
                    disabled={active && selectedTokenTypes.length === 1}
                    aria-pressed={active}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <label className="field compact-field">
              <span>Time granularity</span>
              <select value={timeGranularity} onChange={(event) => updateQuery({ timeGranularity: event.target.value as TimeGranularity })}>
                {TIME_GRANULARITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="rail-section">
            <div className="rail-meta">
              <div>
                <span className="topbar-kicker">Filter groups</span>
                <strong>{loadingFilters ? 'Loading…' : `${activeFilterCount} selected`}</strong>
              </div>
              <div className="muted">Tap tags to constrain the workspace.</div>
            </div>
            {loadingFilters ? <div className="muted">Loading filters…</div> : null}
            {filters ? (
              <div className="filter-collections">
                <FilterChecklist label="Projects" values={filters.projects} selected={query.projects ?? []} onToggle={(value) => toggleArrayValue('projects', value)} />
                <FilterChecklist label="Models" values={filters.models} selected={query.models ?? []} onToggle={(value) => toggleArrayValue('models', value)} />
                <FilterChecklist label="Versions" values={filters.versions} selected={query.versions ?? []} onToggle={(value) => toggleArrayValue('versions', value)} />
                <FilterChecklist label="Branches" values={filters.branches} selected={query.branches ?? []} onToggle={(value) => toggleArrayValue('branches', value)} />
                <FilterChecklist label="Tools" values={filters.tools} selected={query.tools ?? []} onToggle={(value) => toggleArrayValue('tools', value)} />
              </div>
            ) : null}
          </section>
          </details>
        </aside>

        <main className="workspace-main">
          {error ? <div className="error-banner">{error}</div> : null}

          <section className="summary-stage motion-rise delay-2">
            <div className="summary-primary">
              <div className="eyebrow">Selected KPIs</div>
              {loadingOverview ? (
                <div className="skeleton skeleton-value-lg" />
              ) : (
                <div className="summary-value">{formatNumber(totalSelectedTokens)}</div>
              )}
              <p className="summary-copy">
                Total tokens in the active slice across {tokenScopeText.toLowerCase()}. Toggle rollup mode to include or exclude subagent spend instantly.
              </p>
              <div className="summary-breakdown-list">
                {selectedTokenBreakdown.map((item) => (
                  <div key={item.label} className={`summary-breakdown-item tone-${item.tone}`}>
                    <span>{item.label}</span>
                    <strong>{formatNumber(item.value)}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="summary-secondary">
              <SummaryDatum label="Sessions" value={loadingOverview || !overview ? '…' : formatNumber(overview.kpis.totalSessions)} />
              <SummaryDatum label="Total requests" value={loadingOverview || !overview ? '…' : formatNumber(overview.kpis.totalRequests)} />
              <SummaryDatum label="Unique tools" value={loadingOverview || !overview ? '…' : formatNumber(overview.kpis.uniqueTools)} />
              <SummaryDatum
                label="Median session spend"
                value={loadingOverview || !overview ? '…' : formatNumber(overview.kpis.medianSessionCost)}
              />
              <SummaryDatum
                label="Median duration"
                value={loadingOverview || !overview ? '…' : formatDuration(overview.kpis.medianSessionDuration)}
              />
              <SummaryDatum label="Granularity" value={timeGranularityLabel} />
              <SummaryDatum label="Token scope" value={tokenScopeText} />
            </div>
          </section>

          <section className="metrics-grid motion-rise delay-3">
            {loadingOverview || !overview ? (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="metric-card">
                    <div className="skeleton skeleton-text" style={{ width: '50%' }} />
                    <div className="skeleton skeleton-value" />
                  </div>
                ))}
              </>
            ) : (
              <>
                {selectedTokenOptions.map((option) => (
                  <MetricCard
                    key={option.key}
                    label={option.metricLabel}
                    value={formatNumber(overview.kpis[TOKEN_TYPE_KPI_KEYS[option.key]])}
                  />
                ))}
                <MetricCard label="User messages" value={formatNumber(overview.kpis.totalUserMessages)} />
                <MetricCard label="Assistant turns" value={formatNumber(overview.kpis.totalAssistantTurns)} />
              </>
            )}
          </section>

          {overview ? (
            <div className="chart-grid motion-rise delay-4">
              <ChartPanel
                title="Token trend"
                subtitle={`Grouped ${timeGranularityLabel.toLowerCase()} by request timestamp in Eastern time.`}
                className="chart-panel-wide"
              >
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={overview.tokenTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d4d1c7" />
                    <XAxis dataKey="bucket" stroke="#67736f" />
                    <YAxis stroke="#67736f" />
                    <Tooltip />
                    <Legend />
                    {[...selectedTokenOptions].reverse().map((option) => (
                      <Area
                        key={option.key}
                        type="monotone"
                        dataKey={option.key}
                        stackId="tokens"
                        name={option.label}
                        stroke={option.color}
                        fill={option.color}
                        fillOpacity={option.fillOpacity}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </ChartPanel>

              <ChartPanel title="Token mix by project">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={overview.tokenMixByProject}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d4d1c7" />
                    <XAxis dataKey="label" stroke="#67736f" />
                    <YAxis stroke="#67736f" />
                    <Tooltip />
                    <Legend />
                    {selectedTokenOptions.map((option) => (
                      <Bar key={option.key} dataKey={option.key} name={option.label} stackId="mix" fill={option.color} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>

              <ChartPanel title="Token mix by model">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={overview.tokenMixByModel}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d4d1c7" />
                    <XAxis dataKey="label" stroke="#67736f" />
                    <YAxis stroke="#67736f" />
                    <Tooltip />
                    <Legend />
                    {selectedTokenOptions.map((option) => (
                      <Bar key={option.key} dataKey={option.key} name={option.label} stackId="mix" fill={option.color} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>

              <ChartPanel title="Top tools by session count">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={overview.topTools}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d4d1c7" />
                    <XAxis dataKey="toolName" stroke="#67736f" />
                    <YAxis stroke="#67736f" />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="sessionCount" fill="#0f766e" />
                    <Bar dataKey="toolCallCount" fill="#d97706" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartPanel>

              <ChartPanel title="Duration vs total tokens">
                <ResponsiveContainer width="100%" height={260}>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d4d1c7" />
                    <XAxis type="number" dataKey="durationSec" name="Duration (sec)" stroke="#67736f" />
                    <YAxis type="number" dataKey="totalTokens" name="Selected tokens" stroke="#67736f" />
                    <Tooltip cursor={{ strokeDasharray: '4 4' }} />
                    <Scatter data={overview.sessionScatter} fill="#0f766e">
                      {overview.sessionScatter.map((entry, index) => (
                        <Cell key={entry.sessionId} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartPanel>
            </div>
          ) : null}

          <section className="panel workbench-panel motion-rise delay-5">
            <div className="panel-header">
              <div>
                <div className="panel-title">Sessions</div>
                <div className="panel-subtitle">Compare up to two sessions, inspect token mix, and drill into request-level activity.</div>
              </div>
              <button className="button" onClick={() => navigate({ pathname: '/', search: location.search })}>
                Reset table focus
              </button>
            </div>

            <div className="session-workbench">
              <div className="session-pane">
                {loadingSessions || !sessions ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="skeleton skeleton-card" />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Compare</th>
                            <SortableHeader
                              label="Project"
                              sortKey="project"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                            <SortableHeader
                              label="Session"
                              sortKey="sessionId"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                            <SortableHeader
                              label="Started"
                              sortKey="startedAt"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                            <SortableHeader
                              label="Duration"
                              sortKey="durationSec"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                            <SortableHeader
                              label="Total tokens"
                              sortKey="totalTokens"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                            <SortableHeader
                              label="Token mix"
                              sortKey="totalTokens"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                            <SortableHeader
                              label="Models"
                              sortKey="models"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                            <SortableHeader
                              label="Tools"
                              sortKey="toolCount"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                            <SortableHeader
                              label="Subagent share"
                              sortKey="subagentShare"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                            <SortableHeader
                              label="Badges"
                              sortKey="badgeCount"
                              currentSortBy={query.sortBy}
                              currentSortDir={activeSortDirection}
                              onToggle={cycleTableSort}
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {sessions.items.map((session) => {
                            const breakdown =
                              tokenMode === 'rolled_up' ? session.tokenBreakdownRolledUp : session.tokenBreakdownTopLevel;
                            const badges =
                              tokenMode === 'rolled_up' ? session.anomalyBadges.rolledUp : session.anomalyBadges.topLevelOnly;
                            return (
                              <tr key={session.sessionId}>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={selectedCompareIds.includes(session.sessionId)}
                                    onChange={() => toggleCompare(session.sessionId)}
                                  />
                                </td>
                                <td>{session.project}</td>
                                <td>
                                  <Link to={{ pathname: `/sessions/${session.sessionId}`, search: location.search }} className="session-link">
                                    {session.sessionId.slice(0, 8)}…
                                  </Link>
                                </td>
                                <td>{formatTimestamp(session.startedAt)}</td>
                                <td>{formatDuration(session.durationSec)}</td>
                                <td>{formatNumber(breakdown.totalTokens)}</td>
                                <td>
                                  <TokenMixBar breakdown={breakdown} tokenTypes={selectedTokenTypes} />
                                </td>
                                <td>{session.models.join(', ') || 'Unknown'}</td>
                                <td>
                                  <div className="tool-stack">
                                    <strong>{session.toolCount}</strong>
                                    <span>{session.topTools.join(', ') || 'No tools'}</span>
                                  </div>
                                </td>
                                <td>{formatPercent(session.subagentShare)}</td>
                                <td>
                                  <BadgeRow badges={badges} emptyLabel="No flags" />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mobile-session-cards">
                      {sessions.items.map((session) => {
                        const breakdown =
                          tokenMode === 'rolled_up' ? session.tokenBreakdownRolledUp : session.tokenBreakdownTopLevel;
                        const badges =
                          tokenMode === 'rolled_up' ? session.anomalyBadges.rolledUp : session.anomalyBadges.topLevelOnly;
                        return (
                          <Link
                            key={session.sessionId}
                            to={{ pathname: `/sessions/${session.sessionId}`, search: location.search }}
                            className="mobile-session-card"
                          >
                            <div className="mobile-session-card-head">
                              <div className="eyebrow">{session.project}</div>
                              <span className="muted">{formatTimestamp(session.startedAt)}</span>
                            </div>
                            <div className="mobile-session-card-stats">
                              <strong>{formatNumber(breakdown.totalTokens)} tokens</strong>
                              <span>{formatDuration(session.durationSec)}</span>
                              <span>{session.models.join(', ') || 'Unknown'}</span>
                            </div>
                            <TokenMixBar breakdown={breakdown} tokenTypes={selectedTokenTypes} />
                            {badges.length > 0 ? <BadgeRow badges={badges} emptyLabel="" /> : null}
                          </Link>
                        );
                      })}
                    </div>
                    <div className="pagination">
                      <button className="button" disabled={(sessions.page ?? 1) <= 1} onClick={() => updateQuery({ page: (sessions.page ?? 1) - 1 })}>
                        Previous
                      </button>
                      <span>
                        Page {sessions.page} of {Math.max(1, Math.ceil(sessions.total / sessions.pageSize))}
                      </span>
                      <button
                        className="button"
                        disabled={sessions.page * sessions.pageSize >= sessions.total}
                        onClick={() => updateQuery({ page: sessions.page + 1 })}
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}
              </div>

              <aside className="compare-rail">
                <div className="compare-rail-head">
                  <div className="panel-title">Compare sessions</div>
                  <div className="panel-subtitle">Pin one or two sessions to keep their spend profile visible while you browse the table.</div>
                </div>
                {selectedCompareIds.length === 0 ? (
                  <div className="compare-placeholder">
                    <div className="muted">No sessions pinned yet.</div>
                    <p>Select checkboxes in the table to open a side-by-side comparison rail.</p>
                  </div>
                ) : loadingCompare ? (
                  <div className="muted">Loading comparison…</div>
                ) : (
                  <div className="compare-grid">
                    {compareDetails.map((detail) => {
                      const breakdown =
                        tokenMode === 'rolled_up' ? detail.summary.tokenBreakdownRolledUp : detail.summary.tokenBreakdownTopLevel;
                      const badges = tokenMode === 'rolled_up' ? detail.expensiveReasons.rolledUp : detail.expensiveReasons.topLevelOnly;
                      return (
                        <article key={detail.summary.sessionId} className="compare-card">
                          <div className="compare-header">
                            <div className="eyebrow">{detail.summary.project}</div>
                            <h3>{detail.summary.sessionId}</h3>
                          </div>
                          <div className="compare-stats">
                            <CompareStat label="Total tokens" value={formatNumber(breakdown.totalTokens)} />
                            <CompareStat label="Assistant requests" value={formatNumber(detail.summary.assistantRequestCount)} />
                            <CompareStat label="Tool calls" value={formatNumber(detail.summary.toolCount)} />
                            <CompareStat label="Subagent share" value={formatPercent(detail.summary.subagentShare)} />
                          </div>
                          <TokenMixBar breakdown={breakdown} tokenTypes={selectedTokenTypes} />
                          <div className="compare-list">
                            <div>
                              <strong>Top tools:</strong> {detail.summary.topTools.join(', ') || 'No tools'}
                            </div>
                            <div>
                              <strong>Subagents:</strong> {formatNumber(detail.summary.subagentCount)}
                            </div>
                            <div>
                              <strong>Badges:</strong> <BadgeRow badges={badges} emptyLabel="No flags" />
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </aside>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function SessionDetailPage() {
  const { sessionId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tokenMode = (searchParams.get('tokenMode') as TokenMode | null) ?? 'rolled_up';
  const selectedTokenTypes = normalizeTokenTypes(readArray(searchParams, 'tokenTypes') as TokenTypeKey[] | undefined);
  const selectedTokenOptions = TOKEN_TYPE_OPTIONS.filter((option) => selectedTokenTypes.includes(option.key));
  const detailTimeGranularity = normalizeDetailTimeGranularity(searchParams.get('detailTimeGranularity'));
  const detailTimeGranularityLabel = describeDetailTimeGranularity(detailTimeGranularity);
  const dateFrom = searchParams.get('dateFrom') ?? undefined;
  const dateTo = searchParams.get('dateTo') ?? undefined;
  const [detail, setDetail] = useState<SessionDetailPayload | null>(null);
  const [requests, setRequests] = useState<RequestSummary[] | null>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getSessionDetail(sessionId)
      .then((response) => {
        if (active) {
          setDetail(response);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    api
      .getSessionRequests(sessionId, tokenMode, dateFrom, dateTo)
      .then((response) => {
        if (active) {
          setRequests(response.items);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      });
    return () => {
      active = false;
    };
  }, [sessionId, tokenMode, dateFrom, dateTo]);

  function toggleExpanded(requestId: string) {
    setExpandedIds((current) => (current.includes(requestId) ? current.filter((value) => value !== requestId) : [...current, requestId]));
  }

  function updateDetailParams(next: Partial<{ tokenMode: TokenMode; tokenTypes: TokenTypeKey[]; detailTimeGranularity: DetailTimeGranularity; dateFrom: string; dateTo: string }>) {
    const mergedTokenMode = next.tokenMode ?? tokenMode;
    const mergedTokenTypes = normalizeTokenTypes(next.tokenTypes ?? selectedTokenTypes);
    const mergedDetailTimeGranularity = next.detailTimeGranularity ?? detailTimeGranularity;
    const params = new URLSearchParams(searchParams);

    params.set('tokenMode', mergedTokenMode);
    if (shouldPersistTokenTypes(mergedTokenTypes)) {
      params.set('tokenTypes', mergedTokenTypes.join(','));
    } else {
      params.delete('tokenTypes');
    }
    if (shouldPersistDetailTimeGranularity(mergedDetailTimeGranularity)) {
      params.set('detailTimeGranularity', mergedDetailTimeGranularity);
    } else {
      params.delete('detailTimeGranularity');
    }
    if ('dateFrom' in next) {
      if (next.dateFrom) {
        params.set('dateFrom', next.dateFrom);
      } else {
        params.delete('dateFrom');
      }
    }
    if ('dateTo' in next) {
      if (next.dateTo) {
        params.set('dateTo', next.dateTo);
      } else {
        params.delete('dateTo');
      }
    }

    setSearchParams(params, { replace: true });
  }

  function toggleTokenType(tokenType: TokenTypeKey) {
    const current = new Set(selectedTokenTypes);
    if (current.has(tokenType)) {
      if (current.size === 1) {
        return;
      }
      current.delete(tokenType);
    } else {
      current.add(tokenType);
    }

    updateDetailParams({
      tokenTypes: TOKEN_TYPE_OPTIONS.map((option) => option.key).filter((key) => current.has(key)),
    });
  }

  const summary = detail?.summary;
  const breakdown = summary ? (tokenMode === 'rolled_up' ? summary.tokenBreakdownRolledUp : summary.tokenBreakdownTopLevel) : null;
  const selectedBreakdown = breakdown ? selectTokenBreakdown(breakdown, selectedTokenTypes) : null;
  const badges = detail ? (tokenMode === 'rolled_up' ? detail.expensiveReasons.rolledUp : detail.expensiveReasons.topLevelOnly) : [];
  const tokenScopeText = describeTokenScope(selectedTokenOptions.map((option) => option.label));
  const requestAnalytics =
    summary && requests
      ? buildDetailRequestAnalytics(summary, requests, detail?.subagents ?? [], tokenMode, selectedTokenTypes, detailTimeGranularity)
      : null;

  return (
    <div className="page-shell detail-page">
      <div className="background-orb background-orb-left" />
      <div className="background-orb background-orb-right" />
      <header className="app-topbar motion-rise delay-0">
        <div className="brand-column">
          <Link to={{ pathname: '/', search: searchParams.toString() ? `?${searchParams.toString()}` : '' }} className="back-link">
            Back to overview
          </Link>
          <div className="eyebrow">Session detail</div>
          <h1>Request ledger</h1>
          <p>{sessionId}</p>
        </div>
        <div className="topbar-side">
          <div className="topbar-meta">
            <span className="topbar-kicker">Inspection mode</span>
            <strong>{tokenMode === 'rolled_up' ? 'Rolled up with subagents' : 'Top-level only'}</strong>
            <span>
              {summary
                ? `${summary.assistantRequestCount} assistant turns · ${summary.toolCount} tool calls · ${detailTimeGranularityLabel.toLowerCase()} buckets`
                : 'Loading session…'}
            </span>
          </div>
          <div className="segmented-control">
            <button
              className={tokenMode === 'rolled_up' ? 'active' : ''}
              onClick={() => updateDetailParams({ tokenMode: 'rolled_up' })}
            >
              Rolled Up
            </button>
            <button
              className={tokenMode === 'top_level_only' ? 'active' : ''}
              onClick={() => updateDetailParams({ tokenMode: 'top_level_only' })}
            >
              Top Level Only
            </button>
          </div>
        </div>
      </header>

      <div className="detail-date-filters motion-rise delay-1">
        <label className="field">
          <span>Date from</span>
          <input
            type="date"
            value={dateFrom ?? ''}
            onChange={(event) => updateDetailParams({ dateFrom: event.target.value || undefined })}
          />
        </label>
        <label className="field">
          <span>Date to</span>
          <input
            type="date"
            value={dateTo ?? ''}
            onChange={(event) => updateDetailParams({ dateTo: event.target.value || undefined })}
          />
        </label>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {summary && breakdown && selectedBreakdown ? (
        <div className="detail-layout">
          <aside className="detail-sidebar motion-rise delay-1">
            <section className="detail-callout">
              <div className="eyebrow">Selected KPIs</div>
              <div className="summary-value detail-total-value">{formatNumber(selectedBreakdown.totalTokens)}</div>
              <p className="summary-copy">
                Total token load for this session across {tokenScopeText.toLowerCase()} in the selected inspection mode.
              </p>
              <TokenMixBar breakdown={breakdown} tokenTypes={selectedTokenTypes} />
              <div className="detail-meta">
                <div>
                  <strong>Project:</strong> {summary.project}
                </div>
                <div>
                  <strong>Started:</strong> {formatTimestamp(summary.startedAt)}
                </div>
                <div>
                  <strong>Models:</strong> {summary.models.join(', ') || 'Unknown'}
                </div>
                <div>
                  <strong>Branches:</strong> {summary.gitBranches.join(', ') || 'Unknown'}
                </div>
                <div>
                  <strong>Token scope:</strong> {tokenScopeText}
                </div>
              </div>
            </section>

            <section className="panel detail-panel subagents-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Chart controls</div>
                  <div className="panel-subtitle">Match the dashboard token scope and choose how request timestamps are bucketed.</div>
                </div>
              </div>
              <div className="rail-meta">
                <div>
                  <span className="topbar-kicker">Token scope</span>
                  <strong>{selectedTokenOptions.length} types included</strong>
                </div>
                <div className="muted">Affects session totals, figures, charts, and ledger token badges.</div>
              </div>
              <div className="chip-wrap">
                {TOKEN_TYPE_OPTIONS.map((option) => {
                  const active = selectedTokenTypes.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      className={active ? 'chip chip-active' : 'chip'}
                      onClick={() => toggleTokenType(option.key)}
                      disabled={active && selectedTokenTypes.length === 1}
                      aria-pressed={active}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <label className="field compact-field">
                <span>Turn timestamp granularity</span>
                <select
                  value={detailTimeGranularity}
                  onChange={(event) =>
                    updateDetailParams({ detailTimeGranularity: event.target.value as DetailTimeGranularity })
                  }
                >
                  {DETAIL_TIME_GRANULARITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="panel detail-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Why this session is expensive</div>
                  <div className="panel-subtitle">Deterministic badges generated from the indexed session data.</div>
                </div>
              </div>
              <BadgeRow badges={badges} emptyLabel="No anomalies flagged" />
            </section>

            <section className="panel detail-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Subagents</div>
                  <div className="panel-subtitle">Nested agent runs associated with this parent session.</div>
                </div>
              </div>
              {detail.subagents.length === 0 ? (
                <div className="muted">No subagents recorded for this session.</div>
              ) : (
                <div className="subagent-list">
                  {detail.subagents.map((subagent) => (
                    <article key={subagent.agentId} className="subagent-card">
                      <div className="subagent-title">
                        <strong>{subagent.agentType ?? 'Subagent'}</strong>
                        <span>{subagent.agentId}</span>
                      </div>
                      <p>{subagent.description ?? 'No description recorded.'}</p>
                      <div className="subagent-metrics">
                        <span>{formatNumber(subagent.requestCount)} requests</span>
                        <span>{formatNumber(totalTokenBreakdown(subagent.tokenBreakdown, selectedTokenTypes))} selected tokens</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </aside>

          <main className="detail-main">
            <section className="metrics-grid motion-rise delay-2">
              {selectedTokenOptions.map((option) => (
                <MetricCard key={option.key} label={option.metricLabel} value={formatNumber(selectedBreakdown[option.key])} />
              ))}
              <MetricCard label="Duration" value={formatDuration(summary.durationSec)} />
              <MetricCard label="Assistant requests" value={formatNumber(summary.assistantRequestCount)} />
              <MetricCard label="Tool calls" value={formatNumber(summary.toolCount)} />
              <MetricCard label="Subagents" value={formatNumber(summary.subagentCount)} />
            </section>

            <section className="detail-figure-grid motion-rise delay-3">
              {!requestAnalytics ? (
                <>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <article key={i} className="figure-card">
                      <div className="skeleton skeleton-text" style={{ width: '40%' }} />
                      <div className="skeleton skeleton-value" />
                      <div className="skeleton skeleton-text" style={{ width: '70%', marginTop: 8 }} />
                    </article>
                  ))}
                </>
              ) : (
                requestAnalytics.figures.map((figure) => (
                  <article key={figure.label} className="figure-card">
                    <div className="metric-label">{figure.label}</div>
                    <div className="figure-value">{figure.value}</div>
                    <div className="figure-detail">{figure.detail}</div>
                  </article>
                ))
              )}
            </section>

            <section className="chart-grid detail-chart-grid motion-rise delay-4">
              {requestAnalytics ? (
                <>
                  <ChartPanel
                    title="Request token flow"
                    subtitle={`Grouped by ${detailTimeGranularityLabel.toLowerCase()} of the request timestamp in Eastern time.`}
                    className="chart-panel-wide"
                  >
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={requestAnalytics.requestFlow}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d4d1c7" />
                        <XAxis dataKey="label" stroke="#67736f" />
                        <YAxis stroke="#67736f" />
                        <Tooltip />
                        <Legend />
                        {selectedTokenOptions.map((option) => (
                          <Bar
                            key={option.key}
                            dataKey={option.key}
                            stackId="requestTokens"
                            name={option.label}
                            fill={option.color}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartPanel>

                  <ChartPanel title="Spend by model" subtitle="Selected token load aggregated by model for the current inspection mode.">
                    {requestAnalytics.modelSpend.length === 0 ? (
                      <div className="muted">No model data available.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={requestAnalytics.modelSpend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#d4d1c7" />
                          <XAxis dataKey="label" stroke="#67736f" />
                          <YAxis stroke="#67736f" />
                          <Tooltip />
                          <Legend />
                          {selectedTokenOptions.map((option) => (
                            <Bar
                              key={option.key}
                              dataKey={option.key}
                              stackId="modelTokens"
                              name={option.label}
                              fill={option.color}
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </ChartPanel>

                  <ChartPanel title="Tool activity" subtitle="How often each tool appeared and how many requests it touched.">
                    {requestAnalytics.toolActivity.length === 0 ? (
                      <div className="muted">No tools were used in the displayed requests.</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={requestAnalytics.toolActivity}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#d4d1c7" />
                          <XAxis dataKey="label" stroke="#67736f" />
                          <YAxis stroke="#67736f" />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="callCount" name="Tool calls" fill="#0f766e" />
                          <Bar dataKey="requestCount" name="Requests touched" fill="#d97706" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </ChartPanel>

                  <ChartPanel
                    title="Spend by source"
                    subtitle={
                      tokenMode === 'rolled_up'
                        ? 'Top-level spend alongside nested subagent contribution.'
                        : 'Subagent spend is excluded in top-level inspection mode.'
                    }
                  >
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={requestAnalytics.sourceSpend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d4d1c7" />
                        <XAxis dataKey="label" stroke="#67736f" />
                        <YAxis stroke="#67736f" />
                        <Tooltip />
                        <Bar dataKey="totalTokens" name="Selected tokens" fill="#0f766e">
                          {requestAnalytics.sourceSpend.map((entry, index) => (
                            <Cell key={`${entry.label}:${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                </>
              ) : (
                <div className="panel"><div className="skeleton skeleton-chart" /></div>
              )}
            </section>

            <section className="panel ledger-panel motion-rise delay-5">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Request ledger</div>
                  <div className="panel-subtitle">Canonical request turns with raw fragments collapsed by default.</div>
                </div>
              </div>
              {!requests ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton skeleton-card" />
                  ))}
                </div>
              ) : (
                <div className="request-list">
                  {requests.map((request) => {
                    const expanded = expandedIds.includes(request.requestId);
                    return (
                      <article key={request.requestId} className="request-card">
                        <button className="request-summary" onClick={() => toggleExpanded(request.requestId)}>
                          <div>
                            <div className="request-meta">
                              <span>{formatTimestamp(request.timestamp)}</span>
                              <span>{request.model ?? 'Unknown model'}</span>
                              {request.hasSubagentContext ? <span className="micro-badge">Subagent</span> : null}
                            </div>
                            <strong>{request.requestId}</strong>
                          </div>
                          <div className="request-stats">
                            <span>{formatNumber(totalTokenBreakdown(request.tokenBreakdown, selectedTokenTypes))} selected tokens</span>
                            <span>{formatNumber(request.toolCount)} tools</span>
                            <span>{request.stopReason ?? 'No stop reason'}</span>
                          </div>
                        </button>
                        <div className="request-inline">
                          <BadgeRow badges={request.fragmentTypes} emptyLabel="No fragments" />
                          <div className="tool-inline">{request.toolNames.join(', ') || 'No tools'}</div>
                        </div>
                        {expanded ? (
                          <div className="request-expanded">
                            <TokenMixBar breakdown={request.tokenBreakdown} tokenTypes={selectedTokenTypes} />
                            <div className="fragment-list">
                              {request.fragments.map((fragment, index) => (
                                <div key={`${request.requestId}:${index}`} className="fragment-row">
                                  <div className="fragment-kind">{fragment.kind}</div>
                                  <pre>{fragment.content || '(empty)'}</pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </main>
        </div>
      ) : (
        <div className="detail-layout">
          <aside className="detail-sidebar">
            <div className="detail-callout">
              <div className="skeleton skeleton-text" style={{ width: '40%' }} />
              <div className="skeleton skeleton-value-lg" />
              <div className="skeleton skeleton-text" style={{ width: '80%', marginTop: 12 }} />
            </div>
          </aside>
          <main className="detail-main">
            <div className="metrics-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="metric-card">
                  <div className="skeleton skeleton-text" style={{ width: '50%' }} />
                  <div className="skeleton skeleton-value" />
                </div>
              ))}
            </div>
            <div className="skeleton skeleton-chart" style={{ marginTop: 16 }} />
          </main>
        </div>
      )}
    </div>
  );
}

function FilterChecklist(props: {
  label: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <details className="filter-collection" open>
      <summary>
        <span>{props.label}</span>
        <span>{props.selected.length} selected</span>
      </summary>
      <div className="chip-wrap">
        {props.values.map((value) => {
          const active = props.selected.includes(value);
          return (
            <button key={value} className={active ? 'chip chip-active' : 'chip'} onClick={() => props.onToggle(value)}>
              {value}
            </button>
          );
        })}
      </div>
    </details>
  );
}

function SortableHeader(props: {
  label: string;
  sortKey: string;
  currentSortBy?: string;
  currentSortDir?: 'asc' | 'desc';
  onToggle: (sortKey: string) => void;
}) {
  const active = props.currentSortBy === props.sortKey;
  const indicator = active ? (props.currentSortDir === 'asc' ? '↑' : '↓') : '↕';
  const ariaSort = active ? (props.currentSortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th aria-sort={ariaSort}>
      <button
        type="button"
        className={active ? 'table-sort-button active' : 'table-sort-button'}
        onClick={() => props.onToggle(props.sortKey)}
        aria-label={`Sort by ${props.label}`}
        title="Click to sort, click again to reverse, and click a third time to clear."
      >
        <span>{props.label}</span>
        <span className="sort-indicator" aria-hidden="true">
          {indicator}
        </span>
      </button>
    </th>
  );
}

function ChartPanel(props: { title: string; subtitle?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={props.className ? `panel ${props.className}` : 'panel'}>
      <div className="panel-header">
        <div>
          <div className="panel-title">{props.title}</div>
          {props.subtitle ? <div className="panel-subtitle">{props.subtitle}</div> : null}
        </div>
      </div>
      {props.children}
    </section>
  );
}

function MetricCard(props: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{props.label}</div>
      <div className="metric-value">{props.value}</div>
    </div>
  );
}

function CompareStat(props: { label: string; value: string }) {
  return (
    <div className="compare-stat">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function SummaryDatum(props: { label: string; value: string }) {
  return (
    <div className="summary-datum">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function TokenMixBar({ breakdown, tokenTypes }: { breakdown: TokenBreakdown; tokenTypes?: TokenTypeKey[] }) {
  const selectedBreakdown = selectTokenBreakdown(breakdown, tokenTypes ?? TOKEN_TYPE_OPTIONS.map((option) => option.key));
  const total = Math.max(1, selectedBreakdown.totalTokens);
  return (
    <div className="token-mix-bar" aria-label="token mix">
      {TOKEN_TYPE_OPTIONS.filter((option) => selectedBreakdown[option.key] > 0).map((option) => (
        <span
          key={option.key}
          style={{ width: `${(selectedBreakdown[option.key] / total) * 100}%`, background: option.color }}
        />
      ))}
    </div>
  );
}

function BadgeRow(props: { badges: string[]; emptyLabel: string }) {
  if (props.badges.length === 0) {
    return <span className="muted">{props.emptyLabel}</span>;
  }
  return (
    <div className="badge-row">
      {props.badges.map((badge) => (
        <span key={badge} className="pill">
          {badge}
        </span>
      ))}
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(value: number): string {
  if (!value) {
    return '0s';
  }
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DETAIL_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function readQuery(searchParams: URLSearchParams): SessionQuery {
  const sortDir = searchParams.get('sortDir');
  return {
    projects: readArray(searchParams, 'projects'),
    models: readArray(searchParams, 'models'),
    versions: readArray(searchParams, 'versions'),
    branches: readArray(searchParams, 'branches'),
    tools: readArray(searchParams, 'tools'),
    tokenTypes: normalizeTokenTypes(readArray(searchParams, 'tokenTypes') as TokenTypeKey[] | undefined),
    timeGranularity: normalizeTimeGranularity(searchParams.get('timeGranularity') as TimeGranularity | null),
    dateFrom: searchParams.get('dateFrom') ?? undefined,
    dateTo: searchParams.get('dateTo') ?? undefined,
    sessionSearch: searchParams.get('sessionSearch') ?? undefined,
    tokenMode: (searchParams.get('tokenMode') as TokenMode | null) ?? 'rolled_up',
    page: Number(searchParams.get('page') ?? '1'),
    pageSize: PAGE_SIZE,
    sortBy: searchParams.get('sortBy') ?? undefined,
    sortDir: sortDir === 'asc' || sortDir === 'desc' ? sortDir : undefined,
  };
}

function readArray(searchParams: URLSearchParams, key: string): string[] | undefined {
  const value = searchParams.get(key);
  if (!value) {
    return undefined;
  }
  return value.split(',').filter(Boolean);
}

function writeArray(params: URLSearchParams, key: string, values?: string[]) {
  if (values?.length) {
    params.set(key, values.join(','));
  }
}

function writeValue(params: URLSearchParams, key: string, value?: string) {
  if (value) {
    params.set(key, value);
  }
}

function shouldPersistTokenTypes(tokenTypes?: TokenTypeKey[]): boolean {
  const normalized = normalizeTokenTypes(tokenTypes);
  return normalized.length !== TOKEN_TYPE_OPTIONS.length;
}

function normalizeTimeGranularity(value?: TimeGranularity | null): TimeGranularity {
  return TIME_GRANULARITY_OPTIONS.some((option) => option.value === value) ? (value as TimeGranularity) : 'daily';
}

function countActiveFilters(query: SessionQuery): number {
  return [
    query.projects?.length ?? 0,
    query.models?.length ?? 0,
    query.versions?.length ?? 0,
    query.branches?.length ?? 0,
    query.tools?.length ?? 0,
    query.sessionSearch ? 1 : 0,
    query.dateFrom ? 1 : 0,
    query.dateTo ? 1 : 0,
  ].reduce((total, value) => total + value, 0);
}

function describeScope(query: SessionQuery): string {
  if (query.projects?.length) {
    return query.projects.join(', ');
  }
  if (query.sessionSearch) {
    return `Search: ${query.sessionSearch}`;
  }
  if (query.models?.length) {
    return query.models.join(', ');
  }
  return 'All indexed sessions';
}

function describeDateWindow(min: string | null, max: string | null, dateFrom?: string, dateTo?: string): string {
  if (dateFrom || dateTo) {
    return [dateFrom ?? 'start', dateTo ?? 'now'].join(' → ');
  }
  if (min && max) {
    return `${min} → ${max}`;
  }
  return 'All dates';
}

function normalizeTokenTypes(tokenTypes?: TokenTypeKey[]): TokenTypeKey[] {
  if (!tokenTypes?.length) {
    return TOKEN_TYPE_OPTIONS.map((option) => option.key);
  }

  const normalized = TOKEN_TYPE_OPTIONS.map((option) => option.key).filter((key) => tokenTypes.includes(key));
  return normalized.length ? normalized : TOKEN_TYPE_OPTIONS.map((option) => option.key);
}

function totalOverviewTokens(kpis: OverviewPayload['kpis'], tokenTypes: TokenTypeKey[]): number {
  return normalizeTokenTypes(tokenTypes).reduce((total, tokenType) => total + kpis[TOKEN_TYPE_KPI_KEYS[tokenType]], 0);
}

function describeTokenScope(labels: string[]): string {
  if (labels.length === TOKEN_TYPE_OPTIONS.length) {
    return 'All token types';
  }
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

function describeTimeGranularity(value: TimeGranularity): string {
  return TIME_GRANULARITY_OPTIONS.find((option) => option.value === value)?.label ?? 'Daily';
}

function getInitialTableSortDirection(sortBy: string): 'asc' | 'desc' {
  return TABLE_SORT_DEFAULT_DIRECTIONS[sortBy] ?? 'desc';
}

function normalizeDetailTimeGranularity(value?: string | null): DetailTimeGranularity {
  return DETAIL_TIME_GRANULARITY_OPTIONS.some((option) => option.value === value) ? (value as DetailTimeGranularity) : 'minute';
}

function shouldPersistDetailTimeGranularity(value: DetailTimeGranularity): boolean {
  return value !== 'minute';
}

function describeDetailTimeGranularity(value: DetailTimeGranularity): string {
  return DETAIL_TIME_GRANULARITY_OPTIONS.find((option) => option.value === value)?.label ?? 'Minute';
}

function buildDetailRequestAnalytics(
  summary: SessionSummary,
  requests: RequestSummary[],
  subagents: SessionDetailPayload['subagents'],
  tokenMode: TokenMode,
  tokenTypes: TokenTypeKey[],
  detailTimeGranularity: DetailTimeGranularity,
) {
  const sessionBreakdown = tokenMode === 'rolled_up' ? summary.tokenBreakdownRolledUp : summary.tokenBreakdownTopLevel;
  const selectedSessionTotal = totalTokenBreakdown(sessionBreakdown, tokenTypes);
  const selectedTopLevelTotal = totalTokenBreakdown(summary.tokenBreakdownTopLevel, tokenTypes);
  const requestFlow = buildDetailRequestFlow(requests, tokenTypes, detailTimeGranularity);

  const modelMap = new Map<
    string,
    {
      label: string;
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      totalTokens: number;
      requestCount: number;
    }
  >();
  const toolMap = new Map<string, { label: string; callCount: number; requestIds: Set<string> }>();

  for (const request of requests) {
    const modelKey = request.model ?? 'Unknown';
    const modelBucket = modelMap.get(modelKey) ?? {
      label: modelKey,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      requestCount: 0,
    };
    const selectedRequestBreakdown = selectTokenBreakdown(request.tokenBreakdown, tokenTypes);
    modelBucket.inputTokens += selectedRequestBreakdown.inputTokens;
    modelBucket.outputTokens += selectedRequestBreakdown.outputTokens;
    modelBucket.cacheCreationTokens += selectedRequestBreakdown.cacheCreationTokens;
    modelBucket.cacheReadTokens += selectedRequestBreakdown.cacheReadTokens;
    modelBucket.totalTokens += selectedRequestBreakdown.totalTokens;
    modelBucket.requestCount += 1;
    modelMap.set(modelKey, modelBucket);

    for (const toolName of request.toolNames) {
      const toolBucket = toolMap.get(toolName) ?? { label: toolName, callCount: 0, requestIds: new Set<string>() };
      toolBucket.callCount += 1;
      toolBucket.requestIds.add(request.requestId);
      toolMap.set(toolName, toolBucket);
    }
  }

  const sourceSpend = [
    {
      label: 'Top level',
      totalTokens: selectedTopLevelTotal,
    },
    ...(tokenMode === 'rolled_up'
      ? subagents.map((subagent, index) => ({
          label: subagent.agentType ? `${subagent.agentType} ${index + 1}` : `Subagent ${index + 1}`,
          totalTokens: totalTokenBreakdown(subagent.tokenBreakdown, tokenTypes),
        }))
      : []),
  ];

  const uniqueModels = new Set(requests.map((request) => request.model).filter(Boolean));
  const toolActiveRequests = requests.filter((request) => request.toolCount > 0).length;
  const peakRequestTokens = Math.max(...requests.map((request) => totalTokenBreakdown(request.tokenBreakdown, tokenTypes)), 0);
  const averageRequestTokens = requests.length
    ? Math.round(requests.reduce((total, request) => total + totalTokenBreakdown(request.tokenBreakdown, tokenTypes), 0) / requests.length)
    : 0;
  const firstResponseSec = summary.startedAt && requests[0]?.timestamp ? diffSeconds(summary.startedAt, requests[0].timestamp) : null;
  const longestGapSec = longestRequestGapSeconds(requests);
  const selectedSubagentDelta = Math.max(0, selectedSessionTotal - selectedTopLevelTotal);
  const selectedSubagentShare = selectedSessionTotal ? selectedSubagentDelta / selectedSessionTotal : 0;

  return {
    requestFlow,
    modelSpend: [...modelMap.values()].sort((left, right) => right.totalTokens - left.totalTokens || left.label.localeCompare(right.label)),
    toolActivity: [...toolMap.values()]
      .map((tool) => ({
        label: tool.label,
        callCount: tool.callCount,
        requestCount: tool.requestIds.size,
      }))
      .sort((left, right) => right.callCount - left.callCount || left.label.localeCompare(right.label))
      .slice(0, 8),
    sourceSpend,
    figures: [
      {
        label: 'Peak request',
        value: formatNumber(peakRequestTokens),
        detail: `${Math.round((peakRequestTokens / Math.max(1, selectedSessionTotal)) * 100)}% of selected session spend`,
      },
      {
        label: 'Average request',
        value: formatNumber(averageRequestTokens),
        detail: `${formatNumber(requests.length)} assistant turns in the current inspection mode`,
      },
      {
        label: 'Tool-active requests',
        value: `${toolActiveRequests}/${requests.length}`,
        detail: `${Math.round((toolActiveRequests / Math.max(1, requests.length)) * 100)}% of displayed requests invoked tools`,
      },
      {
        label: 'First response',
        value: firstResponseSec === null ? 'Unknown' : formatDuration(firstResponseSec),
        detail: 'From session start to the first assistant request',
      },
      {
        label: 'Longest pause',
        value: longestGapSec === null ? 'Unknown' : formatDuration(longestGapSec),
        detail: 'Largest gap between consecutive assistant requests',
      },
      {
        label: tokenMode === 'rolled_up' ? 'Subagent spend' : 'Models touched',
        value: tokenMode === 'rolled_up' ? formatPercent(selectedSubagentShare) : formatNumber(uniqueModels.size),
        detail:
          tokenMode === 'rolled_up'
            ? `${formatNumber(selectedSubagentDelta)} selected tokens came from ${formatNumber(summary.subagentCount)} subagents`
            : `${[...uniqueModels].join(', ') || 'Unknown model'}`,
      },
    ],
  };
}

function buildDetailRequestFlow(
  requests: RequestSummary[],
  tokenTypes: TokenTypeKey[],
  detailTimeGranularity: DetailTimeGranularity,
) {
  const includeDate = new Set(requests.map((request) => getLocalDateKey(request.timestamp)).filter(Boolean)).size > 1;
  const buckets = new Map<
    string,
    {
      label: string;
      breakdown: TokenBreakdown;
      requestCount: number;
      toolCount: number;
    }
  >();

  for (const request of requests) {
    const bucket = buildDetailTimeBucket(request.timestamp, detailTimeGranularity, includeDate);
    const selectedRequestBreakdown = selectTokenBreakdown(request.tokenBreakdown, tokenTypes);
    const current = buckets.get(bucket.key) ?? {
      label: bucket.label,
      breakdown: emptyTokenBreakdown(),
      requestCount: 0,
      toolCount: 0,
    };
    current.breakdown.inputTokens += selectedRequestBreakdown.inputTokens;
    current.breakdown.outputTokens += selectedRequestBreakdown.outputTokens;
    current.breakdown.cacheCreationTokens += selectedRequestBreakdown.cacheCreationTokens;
    current.breakdown.cacheReadTokens += selectedRequestBreakdown.cacheReadTokens;
    current.breakdown.totalTokens += selectedRequestBreakdown.totalTokens;
    current.requestCount += 1;
    current.toolCount += request.toolCount;
    buckets.set(bucket.key, current);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      ...bucket.breakdown,
      requestCount: bucket.requestCount,
      toolCount: bucket.toolCount,
    }))
    .sort((left, right) => compareDetailTimeBucketKey(left.key, right.key));
}

function longestRequestGapSeconds(requests: RequestSummary[]): number | null {
  let longestGap: number | null = null;
  for (let index = 1; index < requests.length; index += 1) {
    const previous = requests[index - 1]?.timestamp;
    const current = requests[index]?.timestamp;
    if (!previous || !current) {
      continue;
    }
    const gap = diffSeconds(previous, current);
    longestGap = longestGap === null ? gap : Math.max(longestGap, gap);
  }
  return longestGap;
}

function diffSeconds(start: string, end: string): number {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return 0;
  }
  return Math.max(0, Math.round((endTime - startTime) / 1000));
}

function totalTokenBreakdown(breakdown: TokenBreakdown, tokenTypes: TokenTypeKey[]): number {
  return normalizeTokenTypes(tokenTypes).reduce((total, tokenType) => total + breakdown[tokenType], 0);
}

function selectTokenBreakdown(breakdown: TokenBreakdown, tokenTypes: TokenTypeKey[]): TokenBreakdown {
  const normalized = normalizeTokenTypes(tokenTypes);
  return {
    inputTokens: normalized.includes('inputTokens') ? breakdown.inputTokens : 0,
    outputTokens: normalized.includes('outputTokens') ? breakdown.outputTokens : 0,
    cacheCreationTokens: normalized.includes('cacheCreationTokens') ? breakdown.cacheCreationTokens : 0,
    cacheReadTokens: normalized.includes('cacheReadTokens') ? breakdown.cacheReadTokens : 0,
    totalTokens: totalTokenBreakdown(breakdown, normalized),
  };
}

function emptyTokenBreakdown(): TokenBreakdown {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };
}

function getLocalDateKey(timestamp: string | null): string | null {
  const parts = getZonedDateParts(timestamp);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

function buildDetailTimeBucket(
  timestamp: string | null,
  detailTimeGranularity: DetailTimeGranularity,
  includeDate: boolean,
): { key: string; label: string } {
  const parts = getZonedDateParts(timestamp);
  if (!parts) {
    return {
      key: 'Unknown',
      label: 'Unknown',
    };
  }

  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const dateLabel = formatDetailDate(parts.year, parts.month, parts.day);
  if (detailTimeGranularity === 'hour') {
    return {
      key: `${dateKey}T${parts.hour}`,
      label: includeDate ? `${dateLabel} · ${formatHourLabel(parts.hour)}` : formatHourLabel(parts.hour),
    };
  }

  return {
    key: `${dateKey}T${parts.hour}:${parts.minute}`,
    label: includeDate ? `${dateLabel} · ${formatMinuteLabel(parts.hour, parts.minute)}` : formatMinuteLabel(parts.hour, parts.minute),
  };
}

function getZonedDateParts(timestamp: string | null) {
  if (!timestamp) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: DETAIL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);

  return {
    year: parts.find((part) => part.type === 'year')?.value ?? '0000',
    month: parts.find((part) => part.type === 'month')?.value ?? '01',
    day: parts.find((part) => part.type === 'day')?.value ?? '01',
    hour: parts.find((part) => part.type === 'hour')?.value ?? '00',
    minute: parts.find((part) => part.type === 'minute')?.value ?? '00',
  };
}

function formatDetailDate(year: string, month: string, day: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DETAIL_TIME_ZONE,
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${year}-${month}-${day}T12:00:00Z`));
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

function formatMinuteLabel(hour: string, minute: string): string {
  const numericHour = Number(hour);
  if (Number.isNaN(numericHour)) {
    return `${hour}:${minute}`;
  }

  const normalizedHour = numericHour % 24;
  const period = normalizedHour >= 12 ? 'PM' : 'AM';
  const twelveHour = normalizedHour % 12 || 12;
  return `${twelveHour}:${minute} ${period}`;
}

function compareDetailTimeBucketKey(left: string, right: string): number {
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
