import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const githubPagesBase = '/lsk-football-dream-xi/';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? githubPagesBase,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
  },
});
