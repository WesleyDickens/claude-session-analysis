import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function readServerPort(): number {
  try {
    return Number(fs.readFileSync(path.join(process.cwd(), '.data', '.port'), 'utf-8').trim());
  } catch {
    return 3001;
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${readServerPort()}`,
    },
  },
  build: {
    outDir: 'dist/public',
  },
});
