import type {
  FiltersPayload,
  OverviewPayload,
  ScanSummary,
  SessionDetailPayload,
  SessionQuery,
  SessionRequestsPayload,
  SessionsResponse,
} from '../../shared/contracts';

function buildQuery(query: SessionQuery = {}): string {
  const params = new URLSearchParams();
  const appendArray = (key: keyof SessionQuery, values?: string[]) => {
    if (!values?.length) {
      return;
    }
    params.set(key, values.join(','));
  };

  appendArray('projects', query.projects);
  appendArray('models', query.models);
  appendArray('versions', query.versions);
  appendArray('branches', query.branches);
  appendArray('tools', query.tools);
  appendArray('tokenTypes', query.tokenTypes);

  if (query.dateFrom) {
    params.set('dateFrom', query.dateFrom);
  }
  if (query.dateTo) {
    params.set('dateTo', query.dateTo);
  }
  if (query.sessionSearch) {
    params.set('sessionSearch', query.sessionSearch);
  }
  if (query.tokenMode) {
    params.set('tokenMode', query.tokenMode);
  }
  if (query.timeGranularity) {
    params.set('timeGranularity', query.timeGranularity);
  }
  if (query.page) {
    params.set('page', String(query.page));
  }
  if (query.pageSize) {
    params.set('pageSize', String(query.pageSize));
  }
  if (query.sortBy) {
    params.set('sortBy', query.sortBy);
  }
  if (query.sortDir) {
    params.set('sortDir', query.sortDir);
  }

  const output = params.toString();
  return output ? `?${output}` : '';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  scan(): Promise<ScanSummary> {
    return requestJson<ScanSummary>('/api/scan', { method: 'POST' });
  },
  getFilters(): Promise<FiltersPayload> {
    return requestJson<FiltersPayload>('/api/filters');
  },
  getOverview(query: SessionQuery): Promise<OverviewPayload> {
    return requestJson<OverviewPayload>(`/api/overview${buildQuery(query)}`);
  },
  getSessions(query: SessionQuery): Promise<SessionsResponse> {
    return requestJson<SessionsResponse>(`/api/sessions${buildQuery(query)}`);
  },
  getSessionDetail(sessionId: string): Promise<SessionDetailPayload> {
    return requestJson<SessionDetailPayload>(`/api/sessions/${sessionId}`);
  },
  getSessionRequests(
    sessionId: string,
    tokenMode: SessionQuery['tokenMode'],
    dateFrom?: string,
    dateTo?: string,
  ): Promise<SessionRequestsPayload> {
    return requestJson<SessionRequestsPayload>(
      `/api/sessions/${sessionId}/requests${buildQuery({ tokenMode, dateFrom, dateTo })}`,
    );
  },
};
