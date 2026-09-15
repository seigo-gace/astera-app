import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const previewWithoutAuth = process.env.VITE_PREVIEW_WITHOUT_AUTH;

export default defineConfig({
  plugins: [react()],
  define: previewWithoutAuth !== undefined
    ? { 'import.meta.env.VITE_PREVIEW_WITHOUT_AUTH': JSON.stringify(previewWithoutAuth) }
    : undefined,
  build: {
    outDir: 'pages-dist',
    emptyOutDir: true,
    target: ['es2019', 'safari15', 'chrome80'],
    cssTarget: 'safari15',
    sourcemap: true,
  },
});
