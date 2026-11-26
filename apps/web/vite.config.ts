import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        eval: resolve(__dirname, 'eval.html'),
        mockChat: resolve(__dirname, 'mock-chat.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
