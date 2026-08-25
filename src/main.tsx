import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles.css';
import AppRouter from './platform/app-router';
import './platform/navigation-overrides.css';
import './platform/admin-title-labels.css';
import './device-compatibility.css';
import './horizontal-stability.css';
import './orientation-stability.css';
import './features/developer/developer-layout-correction.css';
import { initializeDeviceCompatibility } from './device-compatibility';
import { initializeNativeShell } from './native-shell';
import { initializeRevisionCreditBridge } from './revision-credit-bridge';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
const runtimeUnsupported = (window as Window & { __ASTERA_RUNTIME_UNSUPPORTED__?: boolean }).__ASTERA_RUNTIME_UNSUPPORTED__ === true;
const routePath = window.location.pathname.replace(/\/+$/, '') || '/';
document.documentElement.dataset.routePath = routePath;
const nativeComposerRoute = routePath === '/app' || routePath === '/app/new';

if (!runtimeUnsupported) {
  if (!nativeComposerRoute) initializeRevisionCreditBridge();
  initializeDeviceCompatibility();
  void initializeNativeShell();
  createRoot(root).render(<StrictMode><AppRouter /></StrictMode>);
}
