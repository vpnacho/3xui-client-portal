import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      // Always proxy the API and default subscription path.
      '/api': 'http://localhost:3000',
      '/sub': 'http://localhost:3000',
      // When SUB_PATH is customised in development, set VITE_SUB_PATH and
      // the custom segment is also forwarded to the Express server.
      // The import.meta.env.VITE_SUB_PATH value is only available in Vite
      // plugin context, so we read the Node env here (Vite's config layer).
      ...(process.env.VITE_SUB_PATH && process.env.VITE_SUB_PATH !== 'sub'
        ? { [`/${process.env.VITE_SUB_PATH}`]: 'http://localhost:3000' }
        : {}),
    },
  },
});
