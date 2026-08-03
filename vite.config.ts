import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: ['es2019', 'safari15', 'chrome80'],
    cssTarget: 'safari15',
    sourcemap: true,
  },
});
