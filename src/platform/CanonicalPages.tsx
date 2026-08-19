import LoginPage from '../features/auth/LoginPage';
import ProjectPage from '../features/projects/ProjectPage';
import SecurityPage from '../features/security/SecurityPage';
import type { RouteMatch } from './route-registry';
import { AccountPlatformPage } from './pages/AccountPages';
import { AuthPage } from './pages/AuthPages';
import { PublicPlatformPage } from './pages/PublicPages';
import { WorkspacePage } from './pages/WorkspacePages';

const authRoutes = new Set(['register', 'verify-email', 'forgot-password', 'reset-password', 'password-setup', 'two-factor']);
const workspaceRoutes = new Set(['result-detail', 'history', 'settings', 'settings-options', 'settings-language', 'settings-templates', 'settings-storage-destinations', 'settings-astera-storage', 'settings-data-privacy', 'settings-notifications']);
const accountRoutes = new Set(['account', 'account-subscription', 'account-credit', 'billing-status', 'developer']);

export function CanonicalPage({ route }: { route: RouteMatch }) {
  if (route.id === 'login') return <LoginPage route={route} />;
  if (authRoutes.has(route.id)) return <AuthPage route={route} />;
  if (route.id === 'projects') return <ProjectPage route={route} />;
  if (workspaceRoutes.has(route.id)) return <WorkspacePage route={route} />;
  if (route.id === 'account-security') return <SecurityPage route={route} />;
  if (accountRoutes.has(route.id)) return <AccountPlatformPage route={route} />;
  return <PublicPlatformPage route={route} />;
}
