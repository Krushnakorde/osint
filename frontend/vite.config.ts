import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api calls are proxied to the Node backend (npm start in ../backend).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
});
