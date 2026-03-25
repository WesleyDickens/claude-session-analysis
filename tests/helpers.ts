import os from 'node:os';
import path from 'node:path';

export const FIXTURE_ROOT = path.join(process.cwd(), 'tests', 'fixtures', 'claude', 'projects');

export function tempDbPath(name: string): string {
  return path.join(os.tmpdir(), `claude-session-analysis-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}
