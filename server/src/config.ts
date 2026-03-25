import os from 'node:os';
import path from 'node:path';

export const DEFAULT_DATA_ROOT = process.env.CLAUDE_PROJECTS_DIR ?? path.join(os.homedir(), '.claude', 'projects');
export const DEFAULT_DB_PATH = process.env.CLAUDE_ANALYTICS_DB ?? path.join(process.cwd(), '.data', 'claude-analytics.sqlite');
export const DEFAULT_PORT = Number(process.env.PORT ?? 3001);
