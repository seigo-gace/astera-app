import LoginPage from '../features/auth/LoginPage';
import DeveloperPage from '../features/developer/DeveloperPage';
import HistoryPage from '../features/history/HistoryPage';
import ProjectPage from '../features/projects/ProjectPage';
import ResultPage from '../features/results/ResultPage';
import SecurityPage from '../features/security/SecurityPage';
import DataPrivacyPage from '../features/settings/DataPrivacyPage';
import OptionSettingsPage from '../features/settings/OptionSettingsPage';
import TemplateSettingsPage from '../features/settings/TemplateSettingsPage';
import ShareManagementPage from '../features/share/ShareManagementPage';
import type { RouteMatch } from './route-registry';
import { AccountPlatformPage } from './pages/AccountPages';
import { AuthPage } from './pages/AuthPages';
import { PublicPlatformPage } from './pages/PublicPages';
import { WorkspacePage } from './pages/WorkspacePages';

const authRoutes = new Set(['register', 'verify-email', 'forgot-password', 'reset-password', 'password-setup', 'two-factor']);
const workspaceRoutes = new Set(['settings', 'settings-language', 'settings-storage-destinations', 'settings-astera-storage', 'settings-notifications']);
const accountRoutes = new Set(['account', 'account-subscription', 'account-credit', 'billing-status']);

export function CanonicalPage({ route }: { route: RouteMatch }) {
  if (route.id === 'login') return <LoginPage route={route} />;
  if (authRoutes.has(route.id)) return <AuthPage route={route} />;
  if (route.id === 'projects') return <ProjectPage route={route} />;
  if (route.id === 'history') return <HistoryPage route={route} />;
  if (route.id === 'result-detail') return <ResultPage route={route} />;
  if (route.id === 'shares') return <ShareManagementPage route={route} />;
  if (route.id === 'settings-options') return <OptionSettingsPage route={route} />;
  if (route.id === 'settings-templates') return <TemplateSettingsPage route={route} />;
  if (route.id === 'settings-data-privacy') return <DataPrivacyPage route={route} />;
  if (route.id === 'developer') return <DeveloperPage route={route} />;
  if (workspaceRoutes.has(route.id)) return <WorkspacePage route={route} />;
  if (route.id === 'account-security') return <SecurityPage route={route} />;
  if (accountRoutes.has(route.id)) return <AccountPlatformPage route={route} />;
  return <PublicPlatformPage route={route} />;
}
