// @vitest-environment jsdom

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { App } from '../client/src/App';

const baseFilters = {
  projects: ['sample', 'other'],
  models: ['claude-opus-4-6', 'claude-sonnet-4-6'],
  versions: ['2.1.81', '2.1.82'],
  branches: ['main', 'feature-b'],
  tools: ['Write', 'Bash'],
  dateBounds: { min: '2026-03-20', max: '2026-03-25' },
};

const baseOverview = {
  kpis: {
    totalInputTokens: 28,
    totalOutputTokens: 51,
    totalCacheCreationTokens: 195,
    totalCacheReadTokens: 175,
    totalRequests: 5,
    totalUserMessages: 3,
    totalAssistantTurns: 5,
    uniqueTools: 2,
    totalSessions: 2,
    medianSessionCost: 255,
    medianSessionDuration: 12,
  },
  tokenTrend: [{ bucket: '2026-03-24', inputTokens: 28, outputTokens: 42, cacheCreationTokens: 120, cacheReadTokens: 170 }],
  tokenMixByProject: [{ label: 'sample', inputTokens: 28, outputTokens: 52, cacheCreationTokens: 220, cacheReadTokens: 175, totalTokens: 475 }],
  tokenMixByModel: [{ label: 'claude-opus-4-6', inputTokens: 18, outputTokens: 35, cacheCreationTokens: 100, cacheReadTokens: 150, totalTokens: 303 }],
  topTools: [{ toolName: 'Write', sessionCount: 1, toolCallCount: 1 }],
  sessionScatter: [{ sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', project: 'sample', durationSec: 12, totalTokens: 360 }],
};

const baseSessions = {
  total: 1,
  page: 1,
  pageSize: 20,
  items: [
    {
      sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
      project: 'sample',
      cwd: '/home/user/sample',
      startedAt: '2026-03-24T10:00:00.000Z',
      endedAt: '2026-03-24T10:00:12.000Z',
      durationSec: 12,
      models: ['claude-opus-4-6'],
      versionSet: ['2.1.81'],
      gitBranches: ['main'],
      tokenBreakdownTopLevel: { inputTokens: 18, outputTokens: 32, cacheCreationTokens: 100, cacheReadTokens: 150, totalTokens: 300 },
      tokenBreakdownRolledUp: { inputTokens: 28, outputTokens: 42, cacheCreationTokens: 220, cacheReadTokens: 170, totalTokens: 460 },
      userMessageCount: 1,
      assistantRequestCount: 3,
      toolCount: 1,
      uniqueToolCount: 1,
      topTools: ['Write'],
      subagentCount: 1,
      subagentShare: 0.3478,
      anomalyBadges: {
        topLevelOnly: ['Cache-build-heavy', 'Single-request spike'],
        rolledUp: ['Subagent-heavy', 'Cache-build-heavy', 'Single-request spike'],
      },
    },
  ],
};

const detailPayload = {
  summary: baseSessions.items[0],
  subagents: [
    {
      agentId: 'a-sub',
      agentType: 'Explore',
      description: 'Check subagent accounting',
      requestCount: 1,
      tokenBreakdown: { inputTokens: 10, outputTokens: 10, cacheCreationTokens: 120, cacheReadTokens: 20, totalTokens: 160 },
    },
  ],
  expensiveReasons: {
    topLevelOnly: ['Cache-build-heavy', 'Single-request spike'],
    rolledUp: ['Subagent-heavy', 'Cache-build-heavy', 'Single-request spike'],
  },
};

const requestPayload = {
  items: [
    {
      requestId: 'req-a-1',
      sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
      agentId: null,
      timestamp: '2026-03-24T10:00:06.000Z',
      model: 'claude-opus-4-6',
      stopReason: 'tool_use',
      tokenBreakdown: { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 100, cacheReadTokens: 50, totalTokens: 180 },
      toolCount: 1,
      toolNames: ['Write'],
      fragmentTypes: ['thinking', 'text', 'tool_use'],
      fragments: [
        { kind: 'thinking', content: 'plan' },
        { kind: 'text', content: "I'll inspect the logs." },
        { kind: 'tool_use', content: '{"name":"Write"}' },
      ],
      hasSubagentContext: false,
    },
  ],
};

describe('UI flows', () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/filters')) {
      return jsonResponse(baseFilters);
    }
    if (url.startsWith('/api/overview')) {
      return jsonResponse(baseOverview);
    }
    if (url.startsWith('/api/sessions?')) {
      return jsonResponse(baseSessions);
    }
    if (url === '/api/scan' && init?.method === 'POST') {
      return jsonResponse({
        startedAt: '2026-03-24T00:00:00Z',
        finishedAt: '2026-03-24T00:00:01Z',
        filesDiscovered: 4,
        filesScanned: 1,
        filesSkipped: 3,
        sessionsUpdated: 1,
        subagentsUpdated: 0,
        errors: [],
      });
    }
    if (url === '/api/sessions/aaaaaaaa-1111-2222-3333-444444444444') {
      return jsonResponse(detailPayload);
    }
    if (url.startsWith('/api/sessions/aaaaaaaa-1111-2222-3333-444444444444/requests')) {
      return jsonResponse(requestPayload);
    }
    throw new Error(`Unhandled fetch: ${url}`);
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  it('propagates dashboard filters and drills into a session', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findAllByText('Sessions');
    fireEvent.click(screen.getAllByText('sample')[0]);

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes('/api/overview?projects=sample'))).toBe(true);
      expect(urls.some((url) => url.includes('/api/sessions?projects=sample'))).toBe(true);
    });

    fireEvent.click(screen.getByRole('link', { name: /aaaaaaaa/i }));

    await screen.findByText('Why this session is expensive');
    expect(screen.getByText('Subagent-heavy')).toBeInTheDocument();
  });

  it('updates overview scope when token types are toggled', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText('Input tokens');
    expect(container.querySelectorAll('.data-table .token-mix-bar span')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Input' }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(
        urls.some((url) =>
          url.includes('/api/overview?tokenTypes=outputTokens%2CcacheCreationTokens%2CcacheReadTokens'),
        ),
      ).toBe(true);
      expect(screen.queryByText('Input tokens')).not.toBeInTheDocument();
      expect(container.querySelectorAll('.data-table .token-mix-bar span')).toHaveLength(3);
    });
  });

  it('cycles table header sorting through descending, ascending, and cleared states', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findAllByText('Sessions');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Duration' }));
    await waitFor(() => {
      const lastSessionsUrl = [...fetchMock.mock.calls.map(([url]) => String(url))]
        .filter((url) => url.startsWith('/api/sessions?'))
        .at(-1);
      expect(lastSessionsUrl).toContain('sortBy=durationSec');
      expect(lastSessionsUrl).toContain('sortDir=desc');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Duration' }));
    await waitFor(() => {
      const lastSessionsUrl = [...fetchMock.mock.calls.map(([url]) => String(url))]
        .filter((url) => url.startsWith('/api/sessions?'))
        .at(-1);
      expect(lastSessionsUrl).toContain('sortBy=durationSec');
      expect(lastSessionsUrl).toContain('sortDir=asc');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Duration' }));
    await waitFor(() => {
      const lastSessionsUrl = [...fetchMock.mock.calls.map(([url]) => String(url))]
        .filter((url) => url.startsWith('/api/sessions?'))
        .at(-1);
      expect(lastSessionsUrl).not.toContain('sortBy=durationSec');
      expect(lastSessionsUrl).not.toContain('sortDir=');
    });
  });

  it('refetches overview when time granularity changes', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText('Token trend');
    fireEvent.change(screen.getByLabelText('Time granularity'), { target: { value: 'weekly' } });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes('/api/overview') && url.includes('timeGranularity=weekly'))).toBe(true);
      expect(screen.getByText('Grouped weekly by request timestamp in Eastern time.')).toBeInTheDocument();
    });
  });

  it('updates detail token scope, turn granularity, and refetches when the token mode toggle changes', async () => {
    render(
      <MemoryRouter initialEntries={['/sessions/aaaaaaaa-1111-2222-3333-444444444444?tokenMode=rolled_up']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText('Request ledger');
    expect(screen.getByText('Request token flow')).toBeInTheDocument();
    expect(screen.getByText('Spend by model')).toBeInTheDocument();
    fireEvent.click(screen.getByText('req-a-1'));
    await screen.findByText("I'll inspect the logs.");
    fireEvent.click(screen.getByRole('button', { name: 'Input' }));
    await waitFor(() => {
      expect(screen.queryByText('Input tokens')).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Turn timestamp granularity'), { target: { value: 'hour' } });
    expect(screen.getByText('Grouped by hour of the request timestamp in Eastern time.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Top Level Only' }));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(
        urls.some((url) =>
          url.includes('/api/sessions/aaaaaaaa-1111-2222-3333-444444444444/requests?tokenMode=top_level_only'),
        ),
      ).toBe(true);
    });
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
