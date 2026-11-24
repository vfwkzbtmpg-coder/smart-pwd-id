import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // The Express API (server/server.js, port 4000) owns the review endpoint,
    // the NFC reader bridge and the LGU card backgrounds. Proxying them keeps
    // the console on one origin so the Digital ID Card works exactly like it
    // does on the legacy admin pages.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/backgrounds': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
});
