import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles.css';
import App from './App';
import PricingPage from './features/pricing/PricingPage';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
const page = normalizedPath === '/pricing' ? <PricingPage /> : <App />;

createRoot(root).render(
  <StrictMode>
    {page}
  </StrictMode>,
);
