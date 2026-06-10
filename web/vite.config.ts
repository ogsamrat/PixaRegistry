import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `npm run web:dev` serves the UI on :5173 and proxies API calls to the
// registry on :4055; the production build is served by the registry itself.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4055',
    },
  },
});
