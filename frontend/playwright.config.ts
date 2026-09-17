import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: 'bun run build && bun run preview --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', timeout: 120_000 },
    { command: `${process.platform === 'win32' ? '..\\backend\\.venv\\Scripts\\python.exe' : '../backend/.venv/bin/python'} -m uvicorn main:app --app-dir ../backend --host 127.0.0.1 --port 8000`, url: 'http://127.0.0.1:8000/health' },
  ],
})
