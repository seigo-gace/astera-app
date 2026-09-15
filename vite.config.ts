import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const previewWithoutAuth = process.env.VITE_PREVIEW_WITHOUT_AUTH ?? 'false';
const e2eCanonicalComposer = process.env.VITE_E2E_CANONICAL_COMPOSER ?? 'false';
const buildOutDir = process.env.VITE_E2E_BUILD_OUT_DIR ?? 'pages-dist';

function spaPreviewFallback(): Plugin {
  return {
    name: 'spa-preview-fallback',
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const raw = req.url ?? '/';
        const path = raw.split('?')[0] ?? '/';
        const looksLikeAsset = /\.[a-zA-Z0-9]+$/.test(path) && !path.endsWith('.html');
        if (!looksLikeAsset) req.url = '/index.html';
        next();
      });
    },
  };
}

export default defineConfig({
  appType: 'spa',
  plugins: [react(), spaPreviewFallback()],
  define: {
    'import.meta.env.VITE_PREVIEW_WITHOUT_AUTH': JSON.stringify(previewWithoutAuth),
    'import.meta.env.VITE_E2E_CANONICAL_COMPOSER': JSON.stringify(e2eCanonicalComposer),
  },
  build: {
    outDir: buildOutDir,
    emptyOutDir: true,
    target: ['es2019', 'safari15', 'chrome80'],
    cssTarget: 'safari15',
    sourcemap: true,
  },
});
