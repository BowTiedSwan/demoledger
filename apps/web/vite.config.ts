import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { cspPlugin } from './csp';

// Same-origin in dev: the browser talks to :5173 and Vite proxies /api to the API,
// so Better Auth's httpOnly session cookie works without CORS.
export default defineConfig({
  plugins: [react(), tailwindcss(), cspPlugin()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
    },
  },
});
