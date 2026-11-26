import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Content scripts can't be ES modules: build one self-contained IIFE (no Firebase inside).
export default defineConfig({
  envDir: '../../',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: resolve(__dirname, 'src/content/index.ts'), name: 'RedlineContent', formats: ['iife'], fileName: () => 'content.js' },
    rollupOptions: { output: { extend: true } },
  },
});
