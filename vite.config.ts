// The web client build (web-stack §2.1–§2.2): src/client → dist/client, which the Node server serves. In development
// `npm run dev:client` proxies /api (event streams included) to `npm run dev:server`. There is no public folder: game
// assets live under data/ and must never be copied into dist/.

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: { outDir: '../../dist/client', emptyOutDir: true },
  plugins: [react()],
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8765' } },
  worker: { format: 'es' },
});
