import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import * as Switch from '@radix-ui/react-switch';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clipboard,
  CloudUpload,
  Copy,
  CreditCard,
  Download,
  Expand,
  FileText,
  Folder,
  FolderOpen,
  Globe2,
  History,
  Languages,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Rocket,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';

type ThemeMode = 'system' | 'light' | 'dark';
type PurposeKey =
  | 'auto'
  | 'review'
  | 'compare'
  | 'verify'
  | 'improve'
  | 'research'
  | 'plan'
  | 'consider'
  | 'decide'
  | 'cause';
type PaidOptionKey = 'advancedTranslation' | 'documentGeneration' | 'advancedRewrite';
type TurnStatus = 'running' | 'completed' | 'error';

type SettingsState = {
  theme: ThemeMode;
  language: 'ja' | 'en';
  templatesEnabled: boolean;
  paidOptionsEnabled: boolean;
  fullscreenDefault: boolean;
  reducedMotion: boolean;
};

type AttachedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
};

type ResultSection = {
  key: string;
  title: string;
  body: string;
};

type Turn = {
  id: string;
  title: string;
  prompt: string;
  purposes: PurposeKey[];
  paidOptions: PaidOptionKey[];
  files: AttachedFile[];
  status: TurnStatus;
  sections: ResultSection[];
  createdAt: string;
  error?: string;
};

type InfoPanel = 'plan' | 'credits' | 'account' | null;

type ApiPayload = {
  input: string;
  purposes: PurposeKey[];
  paid_options: PaidOptionKey[];
  files: AttachedFile[];
  template: string | null;
};

const STORAGE_KEY = 'astera-app-settings-v1';
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
const API_BASE = (import.meta.env.VITE_ASTERA_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const HP_URL = (import.meta.env.VITE_ASTERA_HP_URL as string | undefined) ?? 'https://asterav8.jp/';
const SUPPORT_DEVELOPMENT_URL =
  (import.meta.env.VITE_SUPPORT_DEVELOPMENT_URL as string | undefined) ??
  'https://asterav8.jp/support/development';
const SUPPORT_CROWDFUNDING_URL =
  (import.meta.env.VITE_SUPPORT_CROWDFUNDING_URL as string | undefined) ??
  'https://asterav8.jp/support/crowdfunding';
const SUPPORT_PARTNERSHIP_URL =
  (import.meta.env.VITE_SUPPORT_PARTNERSHIP_URL as string | undefined) ??
  'https://asterav8.jp/support/partnership';

const purposeOrder: PurposeKey[] = [
  'auto',
  'review',
  'compare',
  'verify',
  'improve',
  'research',
  'plan',
  'consider',
  'decide',
  'cause',
];

const paidOptionOrder: PaidOptionKey[] = [
  'advancedTranslation',
  'documentGeneration',
  'advancedRewrite',
];

const templateDefinitions = [
  { id: 'review', labelKey: 'templateReview', textJa: 'この資料を目的・前提・事実・危機・反対視点・比較案・推奨判断の観点から確認してください。', textEn: 'Examine this material across purpose, assumptions, facts, risks, opposing views, alternatives, and a recommended decision.' },
  { id: 'compare', labelKey: 'templateCompare', textJa: '複数案を同じ条件で比較し、違い・リスク・適用条件・推奨判断を整理してください。', textEn: 'Compare the options under the same conditions and organize differences, risks, applicability, and a recommended decision.' },
  { id: 'plan', labelKey: 'templatePlan', textJa: 'この目的を実行するための条件、順序、依存関係、失敗要因、判断点を整理してください。', textEn: 'Organize the conditions, sequence, dependencies, failure factors, and decision points required to execute this objective.' },
  { id: 'risk', labelKey: 'templateRisk', textJa: '成立に必要な前提、未確認事項、重大リスク、反対側の見方を優先して確認してください。', textEn: 'Prioritize required assumptions, unresolved items, major risks, and opposing perspectives.' },
] as const;

const defaultSettings = (): SettingsState => ({
  theme: 'system',
  language: navigator.language.toLowerCase().startsWith('en') ? 'en' : 'ja',
  templatesEnabled: false,
  paidOptionsEnabled: false,
  fullscreenDefault: false,
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
});

function loadSettings(): SettingsState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultSettings();
    return { ...defaultSettings(), ...(JSON.parse(saved) as Partial<SettingsState>) };
  } catch {
    return defaultSettings();
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function responseSectionsFromPayload(data: unknown, t: (key: string) => string): ResultSection[] {
  if (!data || typeof data !== 'object') return [];
  const root = data as Record<string, unknown>;
  const candidate = (root.result && typeof root.result === 'object' ? root.result : root) as Record<string, unknown>;
  const directSections = Array.isArray(root.sections)
    ? root.sections
    : Array.isArray(candidate.sections)
      ? candidate.sections
      : null;

  if (directSections) {
    return directSections
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null;
        const section = item as Record<string, unknown>;
        const title = typeof section.title === 'string' ? section.title : `Section ${index + 1}`;
        const body = typeof section.body === 'string' ? section.body : typeof section.content === 'string' ? section.content : '';
        return body ? { key: String(section.key ?? index), title, body } : null;
      })
      .filter((item): item is ResultSection => Boolean(item));
  }

  const mappings: Array<[string, string]> = [
    ['purpose', 'responsePurpose'],
    ['missing_assumptions', 'responseAssumptions'],
    ['facts', 'responseFacts'],
    ['risks', 'responseRisks'],
    ['opposing_view', 'responseOpposition'],
    ['options', 'responseOptions'],
    ['recommendation', 'responseRecommendation'],
    ['instruction_for_primary_ai', 'responseInstruction'],
  ];

  return mappings.flatMap(([key, titleKey]) => {
    const value = candidate[key];
    if (typeof value === 'string' && value.trim()) {
      return [{ key, title: t(titleKey), body: value }];
    }
    if (Array.isArray(value) && value.length) {
      return [{ key, title: t(titleKey), body: value.map(String).join('\n') }];
    }
    return [];
  });
}

function fullResponseText(turn: Turn): string {
  return turn.sections.map((section) => `${section.title}\n${section.body}`).join('\n\n');
}

function useResolvedTheme(theme: ThemeMode): 'light' | 'dark' {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

function AsteraMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`astera-brand ${compact ? 'is-compact' : ''}`} aria-label="Astera v8">
      <span className="astera-mark" aria-hidden="true">
        <span className="astera-mark-ring" />
        <span className="astera-mark-a">A</span>
        <span className="astera-mark-core" />
      </span>
      {!compact && (
        <span className="astera-wordmark">
          ASTERA <b>v8</b>
        </span>
      )}
    </span>
  );
}

function TooltipButton({ label, children, ...buttonProps }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" {...buttonProps}>
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" sideOffset={8}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ExternalNavLink({ href, icon, children, compact }: { href: string; icon: ReactNode; children: ReactNode; compact: boolean }) {
  return (
    <a className="side-link" href={href} target="_self" rel="noreferrer">
      <span className="side-link-icon">{icon}</span>
      {!compact && <span>{children}</span>}
      {!compact && <ArrowUpRight size={14} className="external-indicator" />}
    </a>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const resolvedTheme = useResolvedTheme(settings.theme);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [projectSourcesOpen, setProjectSourcesOpen] = useState(false);
  const [paidOptionsOpen, setPaidOptionsOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [turnListOpen, setTurnListOpen] = useState(false);
  const [infoPanel, setInfoPanel] = useState<InfoPanel>(null);
  const [input, setInput] = useState('');
  const [selectedPurposes, setSelectedPurposes] = useState<PurposeKey[]>([]);
  const [selectedPaidOptions, setSelectedPaidOptions] = useState<PaidOptionKey[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const [newResultAvailable, setNewResultAvailable] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnElements = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.lang = settings.language;
    void i18n.changeLanguage(settings.language);
    const themeColor = resolvedTheme === 'dark' ? '#0a0a0a' : '#f3efe8';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  }, [settings, resolvedTheme, i18n]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const root = timelineRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top - window.innerHeight / 2) - Math.abs(b.boundingClientRect.top - window.innerHeight / 2));
        if (visible[0]) setActiveTurnId((visible[0].target as HTMLElement).dataset.turnId ?? null);
      },
      { root, rootMargin: '-35% 0px -45% 0px', threshold: [0, 0.1, 0.5] },
    );
    turnElements.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [turns]);

  const purposeLabels = useMemo<Record<PurposeKey, string>>(
    () => ({
      auto: t('purposeAuto'),
      review: t('purposeReview'),
      compare: t('purposeCompare'),
      verify: t('purposeVerify'),
      improve: t('purposeImprove'),
      research: t('purposeResearch'),
      plan: t('purposePlan'),
      consider: t('purposeConsider'),
      decide: t('purposeDecide'),
      cause: t('purposeCause'),
    }),
    [t],
  );

  const paidLabels = useMemo<Record<PaidOptionKey, string>>(
    () => ({
      advancedTranslation: t('advancedTranslation'),
      documentGeneration: t('documentGeneration'),
      advancedRewrite: t('advancedRewrite'),
    }),
    [t],
  );

  const estimatedCredits = 10 + selectedPaidOptions.length * 5;

  const scrollToTurn = useCallback(
    (turnId: string) => {
      turnElements.current.get(turnId)?.scrollIntoView({
        behavior: settings.reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      setTurnListOpen(false);
    },
    [settings.reducedMotion],
  );

  const scrollToBottom = useCallback(() => {
    const root = timelineRef.current;
    if (!root) return;
    root.scrollTo({ top: root.scrollHeight, behavior: settings.reducedMotion ? 'auto' : 'smooth' });
    setNewResultAvailable(false);
  }, [settings.reducedMotion]);

  const onTimelineScroll = () => {
    const root = timelineRef.current;
    if (!root) return;
    const distance = root.scrollHeight - root.scrollTop - root.clientHeight;
    setShowJumpBottom(distance > 180);
    if (distance < 80) setNewResultAvailable(false);
  };

  const togglePurpose = (key: PurposeKey) => {
    setSelectedPurposes((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const togglePaidOption = (key: PaidOptionKey) => {
    setSelectedPaidOptions((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const onFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    const next = chosen.flatMap((file) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        setToast(`${file.name}: ${t('fileTooLarge')}`);
        return [];
      }
      return [{ id: createId('file'), name: file.name, size: file.size, type: file.type || 'application/octet-stream' }];
    });
    setFiles((current) => [...current, ...next]);
    event.target.value = '';
  };

  const applyTemplate = (templateId: string) => {
    const template = templateDefinitions.find((item) => item.id === templateId);
    if (!template) return;
    const text = settings.language === 'ja' ? template.textJa : template.textEn;
    setInput((current) => (current.trim() ? `${current.trim()}\n\n${text}` : text));
    setSelectedTemplate(template.id);
    setTemplateOpen(false);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(t('copied'));
    } catch {
      setToast(t('copyFailed'));
    }
  };

  const normalizeTitle = (prompt: string, purposes: PurposeKey[]): string => {
    const compact = prompt.replace(/\s+/g, ' ').trim();
    const prefix = purposes.length ? `${purposeLabels[purposes[0]]}：` : '';
    return `${prefix}${compact.slice(0, 34)}${compact.length > 34 ? '…' : ''}`;
  };

  const handleRun = async () => {
    if (!input.trim() || isRunning) return;
    if (settings.fullscreenDefault && !fullscreenOpen) {
      setFullscreenOpen(true);
      return;
    }

    const prompt = input.trim();
    const turnId = createId('turn');
    const optimisticTurn: Turn = {
      id: turnId,
      title: normalizeTitle(prompt, selectedPurposes),
      prompt,
      purposes: [...selectedPurposes],
      paidOptions: [...selectedPaidOptions],
      files: [...files],
      status: 'running',
      sections: [],
      createdAt: new Date().toISOString(),
    };

    setTurns((current) => [...current, optimisticTurn]);
    setActiveTurnId(turnId);
    setIsRunning(true);
    setFullscreenOpen(false);
    window.setTimeout(scrollToBottom, 0);

    const controller = new AbortController();
    abortRef.current = controller;
    const payload: ApiPayload = {
      input: prompt,
      purposes: selectedPurposes,
      paid_options: selectedPaidOptions,
      files,
      template: selectedTemplate,
    };

    try {
      if (!API_BASE) throw new Error('ASTERA_API_BASE_NOT_CONFIGURED');
      const response = await fetch(`${API_BASE}/process`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`ASTERA_API_${response.status}`);
      const data: unknown = await response.json();
      const sections = responseSectionsFromPayload(data, t);
      if (!sections.length) throw new Error('ASTERA_RESPONSE_SECTIONS_EMPTY');
      setTurns((current) => current.map((turn) => (turn.id === turnId ? { ...turn, status: 'completed', sections } : turn)));
      setInput('');
      setSelectedPurposes([]);
      setSelectedPaidOptions([]);
      setSelectedTemplate(null);
      setFiles([]);
      const root = timelineRef.current;
      if (root) {
        const distance = root.scrollHeight - root.scrollTop - root.clientHeight;
        if (distance > 180) setNewResultAvailable(true);
        else window.setTimeout(scrollToBottom, 0);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setTurns((current) => current.filter((turn) => turn.id !== turnId));
      } else {
        const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
        setTurns((current) =>
          current.map((turn) => (turn.id === turnId ? { ...turn, status: 'error', error: `${t('apiUnavailable')} (${message})` } : turn)),
        );
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const stopRun = () => abortRef.current?.abort();

  const deleteTurn = (turnId: string) => {
    setTurns((current) => current.filter((turn) => turn.id !== turnId));
  };

  const renameTurn = (turnId: string) => {
    const current = turns.find((turn) => turn.id === turnId);
    if (!current) return;
    const next = window.prompt(t('rename'), current.title)?.trim();
    if (next) setTurns((items) => items.map((turn) => (turn.id === turnId ? { ...turn, title: next } : turn)));
  };

  const downloadTurn = (turn: Turn) => {
    const content = [
      `# ${turn.title}`,
      '',
      turn.prompt,
      '',
      ...turn.sections.flatMap((section) => [`## ${section.title}`, '', section.body, '']),
    ].join('\n');
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${turn.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const shareTurn = async (turn: Turn) => {
    const text = `${turn.title}\n\n${fullResponseText(turn)}`;
    if (navigator.share) {
      await navigator.share({ title: turn.title, text }).catch(() => undefined);
    } else {
      await handleCopy(text);
    }
  };

  const updateSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    if (key === 'paidOptionsEnabled' && value === false) setSelectedPaidOptions([]);
    if (key === 'templatesEnabled' && value === false) setSelectedTemplate(null);
  };

  const sidebarContent = (
    <div className={`sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-brand-row">
        <a href="/app" className="brand-link" aria-label="Astera v8">
          <AsteraMark compact={sidebarCollapsed} />
        </a>
        <TooltipButton
          className="icon-button sidebar-collapse desktop-only"
          label={sidebarCollapsed ? t('expandSidebar') : t('collapseSidebar')}
          onClick={() => setSidebarCollapsed((value) => !value)}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </TooltipButton>
        <button className="icon-button mobile-only" type="button" aria-label={t('sidebarClose')} onClick={() => setSidebarOpen(false)}>
          <X size={20} />
        </button>
      </div>

      <button className="new-run-button" type="button" onClick={() => { setInput(''); setSelectedPurposes([]); setSelectedPaidOptions([]); setFiles([]); setSidebarOpen(false); scrollToBottom(); }}>
        <Plus size={19} />
        {!sidebarCollapsed && <span>{t('newRun')}</span>}
      </button>

      <ScrollArea.Root className="sidebar-scroll">
        <ScrollArea.Viewport className="sidebar-scroll-viewport">
          <section className="sidebar-section">
            <div className="sidebar-heading">
              <FolderOpen size={15} />
              {!sidebarCollapsed && <span>{t('projects')}</span>}
            </div>
            {!sidebarCollapsed && <div className="sidebar-empty">{t('emptyProject')}</div>}
          </section>

          <section className="sidebar-section sidebar-history-section">
            <div className="sidebar-heading">
              <History size={15} />
              {!sidebarCollapsed && <span>{t('history')}</span>}
            </div>
            {!turns.length && !sidebarCollapsed && <div className="sidebar-empty">{t('emptyHistory')}</div>}
            <div className="history-list">
              {turns.map((turn) => (
                <div className={`history-row ${activeTurnId === turn.id ? 'is-active' : ''}`} key={turn.id}>
                  <button type="button" className="history-open" onClick={() => { scrollToTurn(turn.id); setSidebarOpen(false); }}>
                    <MessageSquareText size={15} />
                    {!sidebarCollapsed && <span>{turn.title}</span>}
                  </button>
                  {!sidebarCollapsed && (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button type="button" className="history-menu-trigger" aria-label="History actions">
                          <MoreHorizontal size={15} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="menu-content" sideOffset={6} align="start">
                          <DropdownMenu.Item className="menu-item" onSelect={() => renameTurn(turn.id)}>{t('rename')}</DropdownMenu.Item>
                          <DropdownMenu.Item className="menu-item" onSelect={() => downloadTurn(turn)}>{t('download')}</DropdownMenu.Item>
                          <DropdownMenu.Item className="menu-item" onSelect={() => void shareTurn(turn)}>{t('share')}</DropdownMenu.Item>
                          <DropdownMenu.Item className="menu-item" onSelect={() => setToast(t('comingBackend'))}>{t('moveToProject')}</DropdownMenu.Item>
                          <DropdownMenu.Separator className="menu-separator" />
                          <DropdownMenu.Item className="menu-item is-danger" onSelect={() => deleteTurn(turn.id)}>{t('delete')}</DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  )}
                </div>
              ))}
            </div>
          </section>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar className="scrollbar" orientation="vertical">
          <ScrollArea.Thumb className="scrollbar-thumb" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>

      <nav className="sidebar-footer" aria-label="Astera navigation">
        <ExternalNavLink href={HP_URL} icon={<BookOpen size={17} />} compact={sidebarCollapsed}>{t('about')}</ExternalNavLink>
        <Collapsible.Root open={supportOpen} onOpenChange={setSupportOpen}>
          <Collapsible.Trigger className="side-link support-trigger">
            <span className="side-link-icon"><Rocket size={17} /></span>
            {!sidebarCollapsed && <span>{t('supportGroup')}</span>}
            {!sidebarCollapsed && <ChevronDown size={15} className={supportOpen ? 'rotate-180' : ''} />}
          </Collapsible.Trigger>
          {!sidebarCollapsed && (
            <Collapsible.Content className="support-links">
              <a href={SUPPORT_DEVELOPMENT_URL}>{t('developmentSupport')}</a>
              <a href={SUPPORT_CROWDFUNDING_URL}>{t('crowdfunding')}</a>
              <a href={SUPPORT_PARTNERSHIP_URL}>{t('partnership')}</a>
            </Collapsible.Content>
          )}
        </Collapsible.Root>
        <button className="side-link" type="button" onClick={() => setInfoPanel('plan')}>
          <span className="side-link-icon"><ShieldCheck size={17} /></span>
          {!sidebarCollapsed && <span className="side-link-stack"><span>{t('plan')}</span><small>{t('currentPlan')}</small></span>}
        </button>
        <button className="side-link" type="button" onClick={() => setInfoPanel('credits')}>
          <span className="side-link-icon"><CreditCard size={17} /></span>
          {!sidebarCollapsed && <span className="side-link-stack"><span>{t('addCredits')}</span><small>{t('currentCredits')}</small></span>}
        </button>
        <button className="side-link" type="button" onClick={() => setSettingsOpen(true)}>
          <span className="side-link-icon"><Settings size={17} /></span>
          {!sidebarCollapsed && <span>{t('settings')}</span>}
        </button>
        <button className="side-link" type="button" onClick={() => setInfoPanel('account')}>
          <span className="side-link-icon"><CircleUserRound size={17} /></span>
          {!sidebarCollapsed && <span>{t('account')}</span>}
        </button>
      </nav>
    </div>
  );

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className="desktop-sidebar">{sidebarContent}</aside>
        {sidebarOpen && <div className="mobile-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
        <aside className={`mobile-sidebar ${sidebarOpen ? 'is-open' : ''}`}>{sidebarContent}</aside>

        <header className="mobile-header">
          <button className="icon-button" type="button" aria-label={t('sidebarOpen')} onClick={() => setSidebarOpen(true)}>
            <Menu size={21} />
          </button>
          <AsteraMark />
          <button className="credit-chip" type="button" onClick={() => setInfoPanel('credits')}>1,250</button>
        </header>

        <main className="main-column">
          <div className="timeline" ref={timelineRef} onScroll={onTimelineScroll}>
            <div className="timeline-inner">
              {!turns.length && (
                <section className="welcome-panel">
                  <div className="welcome-orbit" aria-hidden="true"><span /></div>
                  <div className="welcome-kicker">{t('welcomeKicker')}</div>
                  <h1>{t('welcomeTitle')}</h1>
                  <p>{t('welcomeBody')}</p>
                </section>
              )}

              {turns.map((turn, turnIndex) => (
                <article
                  key={turn.id}
                  data-turn-id={turn.id}
                  ref={(element) => {
                    if (element) turnElements.current.set(turn.id, element);
                    else turnElements.current.delete(turn.id);
                  }}
                  className={`turn ${turn.status === 'running' ? 'is-running' : ''}`}
                >
                  <section className="user-message">
                    <div className="turn-label">{t('turn')} {turnIndex + 1}</div>
                    <p>{turn.prompt}</p>
                    {(turn.purposes.length > 0 || turn.files.length > 0 || turn.paidOptions.length > 0) && (
                      <div className="turn-meta">
                        {turn.purposes.map((purpose) => <span className="meta-chip" key={purpose}>{purposeLabels[purpose]}</span>)}
                        {turn.files.map((file) => <span className="meta-chip" key={file.id}><Paperclip size={12} />{file.name}</span>)}
                        {turn.paidOptions.map((option) => <span className="meta-chip is-paid" key={option}><Sparkles size={12} />{paidLabels[option]}</span>)}
                      </div>
                    )}
                  </section>

                  <section className="response-card">
                    <header className="response-header">
                      <div>
                        <span className="response-mark"><AsteraMark compact /></span>
                        <strong>{t('response')}</strong>
                      </div>
                      {turn.status === 'completed' && (
                        <button type="button" className="copy-response-button" onClick={() => void handleCopy(fullResponseText(turn))}>
                          <Copy size={15} />{t('copyResponse')}
                        </button>
                      )}
                    </header>

                    {turn.status === 'running' && <ProcessingState t={t} />}
                    {turn.status === 'error' && <div className="error-panel">{turn.error}</div>}
                    {turn.status === 'completed' && (
                      <div className="result-sections">
                        {turn.sections.map((section, sectionIndex) => (
                          <section className="result-section" key={section.key}>
                            <div className="result-section-heading">
                              <span className="section-number">{String(sectionIndex + 1).padStart(2, '0')}</span>
                              <h2>{section.title}</h2>
                              <TooltipButton className="section-copy" label={t('copySection')} onClick={() => void handleCopy(section.body)}>
                                <Clipboard size={15} />
                              </TooltipButton>
                            </div>
                            <p>{section.body}</p>
                          </section>
                        ))}
                      </div>
                    )}
                  </section>
                </article>
              ))}
              <div className="timeline-bottom-spacer" />
            </div>
          </div>

          {(showJumpBottom || newResultAvailable) && (
            <button className="jump-bottom" type="button" onClick={scrollToBottom}>
              <ArrowDown size={17} />
              {newResultAvailable ? t('newResult') : t('latest')}
            </button>
          )}

          <Composer
            t={t}
            input={input}
            setInput={setInput}
            files={files}
            setFiles={setFiles}
            selectedPurposes={selectedPurposes}
            purposeLabels={purposeLabels}
            selectedPaidOptions={selectedPaidOptions}
            paidLabels={paidLabels}
            selectedTemplate={selectedTemplate}
            estimatedCredits={estimatedCredits}
            isRunning={isRunning}
            templatesEnabled={settings.templatesEnabled}
            paidOptionsEnabled={settings.paidOptionsEnabled}
            fileInputRef={fileInputRef}
            onFilesSelected={onFilesSelected}
            openPurpose={() => setPurposeOpen(true)}
            openProjectSources={() => setProjectSourcesOpen(true)}
            openTemplate={() => setTemplateOpen(true)}
            openPaidOptions={() => setPaidOptionsOpen(true)}
            openFullscreen={() => setFullscreenOpen(true)}
            onRun={() => void handleRun()}
            onStop={stopRun}
          />
        </main>

        <TurnRail
          turns={turns}
          activeTurnId={activeTurnId}
          onTurnSelect={scrollToTurn}
          onOpenMobile={() => setTurnListOpen(true)}
          t={t}
        />
      </div>

      <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesSelected} />

      <PurposeDialog open={purposeOpen} onOpenChange={setPurposeOpen} purposes={selectedPurposes} onToggle={togglePurpose} purposeLabels={purposeLabels} t={t} />
      <TemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} onSelect={applyTemplate} t={t} />
      <ProjectSourcesDialog open={projectSourcesOpen} onOpenChange={setProjectSourcesOpen} t={t} />
      <PaidOptionsDialog open={paidOptionsOpen} onOpenChange={setPaidOptionsOpen} selected={selectedPaidOptions} onToggle={togglePaidOption} paidLabels={paidLabels} estimatedCredits={estimatedCredits} t={t} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} updateSetting={updateSetting} t={t} />
      <FullscreenComposer open={fullscreenOpen} onOpenChange={setFullscreenOpen} input={input} setInput={setInput} onRun={() => void handleRun()} isRunning={isRunning} t={t} />
      <TurnListDialog open={turnListOpen} onOpenChange={setTurnListOpen} turns={turns} activeTurnId={activeTurnId} onSelect={scrollToTurn} t={t} />
      <InfoDialog panel={infoPanel} onClose={() => setInfoPanel(null)} t={t} />

      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    </Tooltip.Provider>
  );
}

function ProcessingState({ t }: { t: (key: string) => string }) {
  const stages = ['loadingMaterials', 'checkingInformation', 'matchingConditions', 'comparing', 'structuring', 'outputting'];
  return (
    <div className="processing-state" aria-live="polite">
      <div className="processing-orbit"><span /></div>
      <div className="processing-lines">
        {stages.map((stage, index) => (
          <div className="processing-line" style={{ '--delay': `${index * 0.18}s` } as React.CSSProperties} key={stage}>
            <span />{t(stage)}
          </div>
        ))}
      </div>
    </div>
  );
}

type ComposerProps = {
  t: (key: string) => string;
  input: string;
  setInput: (value: string) => void;
  files: AttachedFile[];
  setFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  selectedPurposes: PurposeKey[];
  purposeLabels: Record<PurposeKey, string>;
  selectedPaidOptions: PaidOptionKey[];
  paidLabels: Record<PaidOptionKey, string>;
  selectedTemplate: string | null;
  estimatedCredits: number;
  isRunning: boolean;
  templatesEnabled: boolean;
  paidOptionsEnabled: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  openPurpose: () => void;
  openProjectSources: () => void;
  openTemplate: () => void;
  openPaidOptions: () => void;
  openFullscreen: () => void;
  onRun: () => void;
  onStop: () => void;
};

function Composer(props: ComposerProps) {
  const {
    t,
    input,
    setInput,
    files,
    setFiles,
    selectedPurposes,
    purposeLabels,
    selectedPaidOptions,
    paidLabels,
    selectedTemplate,
    estimatedCredits,
    isRunning,
    templatesEnabled,
    paidOptionsEnabled,
    fileInputRef,
    openPurpose,
    openProjectSources,
    openTemplate,
    openPaidOptions,
    openFullscreen,
    onRun,
    onStop,
  } = props;

  return (
    <div className="composer-wrap">
      <div className="composer-helper">{t('composerHelper')}</div>
      <div className="composer">
        {(files.length > 0 || selectedPurposes.length > 0 || selectedPaidOptions.length > 0 || selectedTemplate) && (
          <div className="selection-row">
            {selectedPurposes.map((purpose) => <span className="selection-chip" key={purpose}>{purposeLabels[purpose]}</span>)}
            {files.map((file) => (
              <span className="selection-chip" key={file.id}>
                <FileText size={13} />{file.name}<small>{formatBytes(file.size)}</small>
                <button type="button" aria-label={t('remove')} onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}><X size={13} /></button>
              </span>
            ))}
            {selectedPaidOptions.map((option) => <span className="selection-chip is-paid" key={option}><Sparkles size={13} />{paidLabels[option]}</span>)}
            {selectedTemplate && <span className="selection-chip"><BookOpen size={13} />{t('templates')}</span>}
          </div>
        )}
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('composerPlaceholder')}
          rows={1}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onRun();
            }
          }}
        />
        <div className="composer-actions">
          <div className="composer-left-actions">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button type="button" className="composer-plus" aria-label={t('add')}><Plus size={20} /></button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu-content composer-menu" side="top" align="start" sideOffset={9}>
                  <DropdownMenu.Item className="menu-item" onSelect={() => fileInputRef.current?.click()}><Paperclip size={16} />{t('attachFile')}</DropdownMenu.Item>
                  <DropdownMenu.Item className="menu-item" onSelect={openPurpose}><Search size={16} />{t('choosePurpose')}</DropdownMenu.Item>
                  <DropdownMenu.Item className="menu-item" onSelect={openProjectSources}><Folder size={16} />{t('projectSources')}</DropdownMenu.Item>
                  {templatesEnabled && <DropdownMenu.Item className="menu-item" onSelect={openTemplate}><BookOpen size={16} />{t('templates')}</DropdownMenu.Item>}
                  {paidOptionsEnabled && <DropdownMenu.Item className="menu-item" onSelect={openPaidOptions}><Sparkles size={16} />{t('paidOptions')}</DropdownMenu.Item>}
                  <DropdownMenu.Separator className="menu-separator" />
                  <div className="menu-note">{t('menuHiddenHint')}</div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <TooltipButton className="composer-tool" label={t('fullscreen')} onClick={openFullscreen}><Expand size={18} /></TooltipButton>
            {selectedPaidOptions.length > 0 && <span className="credit-estimate">{t('estimatedCredits')} {estimatedCredits} {t('credits')}</span>}
          </div>
          {isRunning ? (
            <button type="button" className="run-button is-stop" onClick={onStop}><Square size={17} fill="currentColor" />{t('stop')}</button>
          ) : (
            <button type="button" className="run-button" disabled={!input.trim()} onClick={onRun}><Send size={17} />{t('run')}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function TurnRail({ turns, activeTurnId, onTurnSelect, onOpenMobile, t }: { turns: Turn[]; activeTurnId: string | null; onTurnSelect: (id: string) => void; onOpenMobile: () => void; t: (key: string) => string }) {
  const activeIndex = Math.max(0, turns.findIndex((turn) => turn.id === activeTurnId));
  return (
    <aside className="turn-rail" aria-label={t('turnList')}>
      <div className="turn-rail-inner">
        {turns.map((turn, index) => (
          <Tooltip.Root key={turn.id}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className={`turn-dot ${turn.id === activeTurnId ? 'is-active' : ''} ${index < activeIndex ? 'is-passed' : ''}`}
                onClick={() => onTurnSelect(turn.id)}
                aria-label={`${t('turn')} ${index + 1}: ${turn.title}`}
              >
                <span>{index + 1}</span>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal><Tooltip.Content className="tooltip-content" side="left" sideOffset={10}>{turn.title}<Tooltip.Arrow className="tooltip-arrow" /></Tooltip.Content></Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </div>
      {turns.length > 0 && <button className="mobile-turn-counter" type="button" onClick={onOpenMobile}>{activeIndex + 1}/{turns.length}</button>}
    </aside>
  );
}

function BaseDialog({ open, onOpenChange, title, description, children, className = '' }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog-content ${className}`}>
          <div className="dialog-heading">
            <div><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description>{description}</Dialog.Description>}</div>
            <Dialog.Close asChild><button type="button" className="icon-button"><X size={19} /></button></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PurposeDialog({ open, onOpenChange, purposes, onToggle, purposeLabels, t }: { open: boolean; onOpenChange: (open: boolean) => void; purposes: PurposeKey[]; onToggle: (purpose: PurposeKey) => void; purposeLabels: Record<PurposeKey, string>; t: (key: string) => string }) {
  return (
    <BaseDialog open={open} onOpenChange={onOpenChange} title={t('purposesTitle')} description={t('purposesDescription')}>
      <div className="option-grid">
        {purposeOrder.map((purpose) => (
          <button type="button" className={`option-card ${purposes.includes(purpose) ? 'is-selected' : ''}`} onClick={() => onToggle(purpose)} key={purpose}>
            <span>{purposeLabels[purpose]}</span>{purposes.includes(purpose) && <Check size={17} />}
          </button>
        ))}
      </div>
    </BaseDialog>
  );
}

function TemplateDialog({ open, onOpenChange, onSelect, t }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (id: string) => void; t: (key: string) => string }) {
  return (
    <BaseDialog open={open} onOpenChange={onOpenChange} title={t('templatesTitle')} description={t('templatesDescription')}>
      <div className="template-list">
        {templateDefinitions.map((template) => (
          <button type="button" className="template-card" onClick={() => onSelect(template.id)} key={template.id}>
            <BookOpen size={19} /><span>{t(template.labelKey)}</span><ChevronRight size={17} />
          </button>
        ))}
      </div>
    </BaseDialog>
  );
}

function ProjectSourcesDialog({ open, onOpenChange, t }: { open: boolean; onOpenChange: (open: boolean) => void; t: (key: string) => string }) {
  return (
    <BaseDialog open={open} onOpenChange={onOpenChange} title={t('projectSourcesTitle')} description={t('projectSourcesDescription')}>
      <div className="template-list">
        <button type="button" className="template-card" onClick={() => undefined}><FolderOpen size={19} /><span>{t('entireProject')}</span><ChevronRight size={17} /></button>
        <button type="button" className="template-card" onClick={() => undefined}><Folder size={19} /><span>{t('selectFolder')}</span><ChevronRight size={17} /></button>
        <button type="button" className="template-card" onClick={() => undefined}><FileText size={19} /><span>{t('selectFiles')}</span><ChevronRight size={17} /></button>
      </div>
      <div className="dialog-notice">{t('emptyProject')}</div>
    </BaseDialog>
  );
}

function PaidOptionsDialog({ open, onOpenChange, selected, onToggle, paidLabels, estimatedCredits, t }: { open: boolean; onOpenChange: (open: boolean) => void; selected: PaidOptionKey[]; onToggle: (key: PaidOptionKey) => void; paidLabels: Record<PaidOptionKey, string>; estimatedCredits: number; t: (key: string) => string }) {
  return (
    <BaseDialog open={open} onOpenChange={onOpenChange} title={t('paidOptionsTitle')} description={t('paidOptionsDescription')}>
      <div className="option-grid paid-option-grid">
        {paidOptionOrder.map((option) => (
          <button type="button" className={`option-card is-paid ${selected.includes(option) ? 'is-selected' : ''}`} onClick={() => onToggle(option)} key={option}>
            <Sparkles size={17} /><span>{paidLabels[option]}</span><small>+5</small>{selected.includes(option) && <Check size={17} />}
          </button>
        ))}
      </div>
      <div className="credit-summary"><CreditCard size={18} />{t('estimatedCredits')} <strong>{estimatedCredits}</strong> {t('credits')}</div>
    </BaseDialog>
  );
}

function SettingRow({ label, description, checked, onCheckedChange }: { label: string; description?: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="setting-row">
      <div><strong>{label}</strong>{description && <span>{description}</span>}</div>
      <Switch.Root className="switch-root" checked={checked} onCheckedChange={onCheckedChange}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </div>
  );
}

function SettingsDialog({ open, onOpenChange, settings, updateSetting, t }: { open: boolean; onOpenChange: (open: boolean) => void; settings: SettingsState; updateSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void; t: (key: string) => string }) {
  return (
    <BaseDialog open={open} onOpenChange={onOpenChange} title={t('settingsTitle')} className="settings-dialog">
      <section className="settings-section">
        <h3><Settings size={17} />{t('appearance')}</h3>
        <label className="select-row"><span>{t('theme')}</span><select value={settings.theme} onChange={(event) => updateSetting('theme', event.target.value as ThemeMode)}><option value="system">{t('themeSystem')}</option><option value="light">{t('themeLight')}</option><option value="dark">{t('themeDark')}</option></select></label>
        <label className="select-row"><span>{t('language')}</span><select value={settings.language} onChange={(event) => updateSetting('language', event.target.value as 'ja' | 'en')}><option value="ja">{t('languageJapanese')}</option><option value="en">{t('languageEnglish')}</option></select></label>
      </section>
      <section className="settings-section">
        <h3><Plus size={17} />{t('inputFeatures')}</h3>
        <SettingRow label={t('templateToggle')} checked={settings.templatesEnabled} onCheckedChange={(value) => updateSetting('templatesEnabled', value)} />
        <SettingRow label={t('paidOptionsToggle')} checked={settings.paidOptionsEnabled} onCheckedChange={(value) => updateSetting('paidOptionsEnabled', value)} />
        <SettingRow label={t('fullscreenDefault')} checked={settings.fullscreenDefault} onCheckedChange={(value) => updateSetting('fullscreenDefault', value)} />
        <SettingRow label={t('motion')} checked={settings.reducedMotion} onCheckedChange={(value) => updateSetting('reducedMotion', value)} />
      </section>
      <div className="dialog-notice"><Check size={15} />{t('settingsSaved')}</div>
    </BaseDialog>
  );
}

function FullscreenComposer({ open, onOpenChange, input, setInput, onRun, isRunning, t }: { open: boolean; onOpenChange: (open: boolean) => void; input: string; setInput: (value: string) => void; onRun: () => void; isRunning: boolean; t: (key: string) => string }) {
  return (
    <BaseDialog open={open} onOpenChange={onOpenChange} title={t('fullscreen')} className="fullscreen-dialog">
      <textarea autoFocus value={input} onChange={(event) => setInput(event.target.value)} placeholder={t('composerPlaceholder')} />
      <div className="fullscreen-actions"><Dialog.Close asChild><button type="button" className="secondary-button">{t('close')}</button></Dialog.Close><button type="button" className="run-button" disabled={!input.trim() || isRunning} onClick={onRun}><Send size={17} />{t('run')}</button></div>
    </BaseDialog>
  );
}

function TurnListDialog({ open, onOpenChange, turns, activeTurnId, onSelect, t }: { open: boolean; onOpenChange: (open: boolean) => void; turns: Turn[]; activeTurnId: string | null; onSelect: (id: string) => void; t: (key: string) => string }) {
  return (
    <BaseDialog open={open} onOpenChange={onOpenChange} title={t('turnList')}>
      <div className="turn-list-dialog">
        {turns.map((turn, index) => (
          <button type="button" className={turn.id === activeTurnId ? 'is-active' : ''} onClick={() => onSelect(turn.id)} key={turn.id}><span>{index + 1}</span><strong>{turn.title}</strong></button>
        ))}
      </div>
    </BaseDialog>
  );
}

function InfoDialog({ panel, onClose, t }: { panel: InfoPanel; onClose: () => void; t: (key: string) => string }) {
  const config = panel === 'plan'
    ? { title: t('planTitle'), body: t('planDescription'), icon: <ShieldCheck size={22} /> }
    : panel === 'credits'
      ? { title: t('creditsTitle'), body: t('creditsDescription'), icon: <CreditCard size={22} /> }
      : { title: t('accountTitle'), body: t('accountDescription'), icon: <CircleUserRound size={22} /> };
  return (
    <BaseDialog open={panel !== null} onOpenChange={(open) => { if (!open) onClose(); }} title={config.title}>
      <div className="info-panel-icon">{config.icon}</div>
      <p className="info-panel-body">{config.body}</p>
      <div className="dialog-notice">{t('comingBackend')}</div>
    </BaseDialog>
  );
}

export default App;
