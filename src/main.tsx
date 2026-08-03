import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles.css';
import AppRouter from './platform/app-router';
import './device-compatibility.css';
import { initializeDeviceCompatibility } from './device-compatibility';
import { initializeNativeShell } from './native-shell';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const runtimeUnsupported = (window as Window & { __ASTERA_RUNTIME_UNSUPPORTED__?: boolean })
  .__ASTERA_RUNTIME_UNSUPPORTED__ === true;

if (!runtimeUnsupported) {
  initializeDeviceCompatibility();
  void initializeNativeShell();

  createRoot(root).render(
    <StrictMode>
      <AppRouter />
    </StrictMode>,
  );
}
