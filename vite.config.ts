import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const buildOutDir = process.env.ASTERA_VITE_OUT_DIR?.trim() || 'dist';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: buildOutDir,
    emptyOutDir: true,
    target: ['es2019', 'safari15', 'chrome80'],
    cssTarget: 'safari15',
    sourcemap: true,
  },
});
