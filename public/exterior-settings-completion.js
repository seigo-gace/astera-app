(() => {
'use strict';

const route = location.pathname.replace(/\/+$/, '') || '/';
const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

function pageContent() {
  return q('.platform-page-content') || q('.platform-main') || q('main');
}

function section(title, subtitle = '', marker = '') {
  const node = document.createElement('section');
  node.className = 'exterior-canon-section';
  if (marker) node.dataset[marker] = '1';
  node.innerHTML = `<header><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div></header>`;
  return node;
}

function chips(items, className = 'exterior-canon-chips') {
  const row = document.createElement('div');
  row.className = className;
  items.forEach((label) => {
    const chip = document.createElement('span');
    chip.textContent = label;
    row.append(chip);
  });
  return row;
}

function facts(items) {
  const grid = document.createElement('div');
  grid.className = 'exterior-canon-grid';
  items.forEach(([label, value = '—']) => {
    const card = document.createElement('div');
    card.className = 'exterior-canon-fact';
    card.innerHTML = `<small>${label}</small><strong>${value}</strong>`;
    grid.append(card);
  });
  return grid;
}

function actions(labels) {
  const row = document.createElement('div');
  row.className = 'exterior-canon-actions';
  labels.forEach((label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.textContent = label;
    row.append(button);
  });
  return row;
}

function addOnce(marker, build, where = 'append') {
  const root = pageContent();
  if (!(root instanceof HTMLElement) || q(`[data-${marker}]`, root)) return;
  const node = build();
  node.setAttribute(`data-${marker}`, '1');
  if (where === 'prepend') root.prepend(node);
  else root.append(node);
}

function style() {
  if (q('[data-exterior-settings-completion-style]')) return;
  const node = document.createElement('style');
  node.dataset.exteriorSettingsCompletionStyle = '1';
  node.textContent = `
.exterior-canon-section{display:grid;gap:12px;padding:16px;border:1px solid var(--ex-line,var(--platform-border,#2c2c2c));border-radius:18px;background:var(--ex-bg,var(--platform-bg,#090909));color:var(--ex-text,var(--platform-text,#f2f2f2));min-width:0}
.exterior-canon-section>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.exterior-canon-section h2{margin:0;font-size:15px;line-height:1.35}
.exterior-canon-section header p{margin:4px 0 0;color:var(--ex-muted,var(--platform-muted,#aaa));font-size:12px;line-height:1.5}
.exterior-canon-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;min-width:0}
.exterior-canon-fact{min-width:0;padding:10px;border:1px solid var(--ex-line,var(--platform-border,#2c2c2c));border-radius:12px;background:transparent}
.exterior-canon-fact small{display:block;color:var(--ex-muted,var(--platform-muted,#aaa));font-size:10px;line-height:1.4}
.exterior-canon-fact strong{display:block;margin-top:5px;overflow-wrap:anywhere;font-size:12px;line-height:1.45}
.exterior-canon-chips{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.exterior-canon-chips span{display:inline-flex;align-items:center;min-height:30px;max-width:100%;padding:0 9px;border:1px solid var(--ex-line,var(--platform-border,#2c2c2c));border-radius:999px;color:var(--ex-muted,var(--platform-muted,#aaa));font-size:11px;line-height:1.25;overflow-wrap:anywhere}
.exterior-canon-actions{display:flex;flex-wrap:wrap;gap:7px;min-width:0}
.exterior-canon-actions button{min-height:36px;max-width:100%;padding:0 11px;border:1px solid var(--ex-line,var(--platform-border,#2c2c2c));border-radius:9px;background:transparent;color:var(--ex-muted,var(--platform-muted,#aaa));font:inherit;opacity:.72}
.exterior-canon-note{margin:0;padding:10px 12px;border:1px solid var(--ex-line,var(--platform-border,#2c2c2c));border-radius:12px;color:var(--ex-muted,var(--platform-muted,#aaa));font-size:12px;line-height:1.55}
.exterior-canon-alert{display:grid;gap:8px;padding:12px;border:1px solid var(--ex-line,var(--platform-border,#2c2c2c));border-radius:14px}
.exterior-canon-alert strong{font-size:13px}.exterior-canon-alert p{margin:0;color:var(--ex-muted,var(--platform-muted,#aaa));font-size:12px;line-height:1.55}
.exterior-canon-dialog-preview{display:grid;gap:8px;padding:12px;border:1px dashed var(--ex-line,var(--platform-border,#2c2c2c));border-radius:14px}
.exterior-canon-dialog-preview>strong{font-size:13px}.exterior-canon-dialog-preview>p{margin:0;color:var(--ex-muted,var(--platform-muted,#aaa));font-size:12px;line-height:1.5}
@media(max-width:900px){.exterior-canon-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.exterior-canon-section{padding:14px}.exterior-canon-grid{grid-template-columns:1fr}.exterior-canon-actions{display:grid;grid-template-columns:1fr}.exterior-canon-actions button{width:100%}.exterior-canon-section>header{display:block}}
@media(prefers-reduced-motion:reduce){.exterior-canon-section *{transition-duration:.001ms!important;animation-duration:.001ms!important}}
`;
  document.head.append(node);
}

function settingsIndex() {
  if (route !== '/app/settings') return;
  addOnce('exterior-settings-states', () => {
    const s = section('Settings状態', '全Categoryで共通に扱う画面状態');
    s.append(chips(['Loading', 'Ready', 'Locked', 'Permission Required', 'Maintenance', 'Error']));
    s.append(facts([
      ['Locked表示', '理由＋必要Plan'],
      ['Permission', '必要権限を明示'],
      ['Desktop', 'Overlay / Panel'],
      ['Mobile', '全画面List'],
    ]));
    return s;
  });
}

function options() {
  if (route !== '/app/settings/options') return;
  addOnce('exterior-options-states', () => {
    const s = section('Option設定 状態', 'Toggleは候補表示だけを制御し、自動実行・課金しない');
    s.append(chips(['Saving', 'Saved', 'Plan Locked', 'Provider Unavailable', 'Error']));
    s.append(facts([
      ['高精度翻訳', '候補表示Toggle'],
      ['Agent Mode', '候補表示Toggle'],
      ['書類作成', '候補表示Toggle'],
      ['外部Storage転送', '候補表示Toggle'],
    ]));
    return s;
  });
}

function language() {
  if (route !== '/app/settings/language') return;
  addOnce('exterior-language-complete', () => {
    const s = section('表示・言語 詳細', '表示、言語、根拠表示、Motion、Locale状態を同じ画面で確認');
    s.append(facts([
      ['System言語', document.documentElement.lang || 'ja-JP'],
      ['Theme', document.documentElement.dataset.theme || 'System'],
      ['根拠表示方式', '—'],
      ['Reduced Motion', 'Preference'],
      ['HTML lang', document.documentElement.lang || '—'],
      ['Direction / RTL', document.documentElement.dir || 'LTR'],
      ['Locale Support', 'Catalogで判定'],
      ['Focus保持', '言語変更後も維持'],
    ]));
    s.append(chips(['Loading', 'Saving', 'Saved', 'Unsupported Locale', 'Error']));
    return s;
  });
}

function templates() {
  if (route !== '/app/settings/templates') return;
  addOnce('exterior-template-complete', () => {
    const s = section('Template管理', '作成後の検査・Preview・Version・Lifecycleまで含む外装');
    s.append(chips(['Draft', 'Validating', 'Ready', 'Warning', 'Rejected', 'Disabled', 'Deleted']));
    s.append(facts([
      ['Google接続', '未接続 / 接続状態'],
      ['Template検査', '状態・警告を表示'],
      ['Preview', '差分確認面'],
      ['Version', '現在Version / 履歴'],
      ['原本変更', 'Diff Gateで確認'],
      ['権限', 'Provider権限状態'],
      ['名称', '選択Template'],
      ['有効状態', 'Enabled / Disabled'],
    ]));
    s.append(actions(['Googleへ接続', '検査', 'Preview', '名称変更', '複製', '有効/無効', 'Version履歴', '削除']));
    return s;
  });
}

function storageDestinations() {
  if (route !== '/app/settings/storage-destinations') return;
  addOnce('exterior-storage-destinations-complete', () => {
    const s = section('外部Storage 接続詳細', 'Destinationごとの認証・Scope・Root・接続Test・Revoke外装');
    s.append(chips(['Connected', 'Needs Reauth', 'Scope Changed', 'Unavailable', 'Revoked', 'Error']));
    s.append(facts([
      ['Provider', '—'],
      ['Scope', '—'],
      ['Root Folder', '—'],
      ['接続Test', '—'],
      ['最終利用日時', '—'],
      ['Credential', 'Vault Referenceのみ'],
      ['OAuth状態', '—'],
      ['登録数', '任意上限なし'],
    ]));
    s.append(actions(['追加', '再認証', 'Scope確認', 'Root Folder変更', '接続Test', '削除']));
    return s;
  });
}

function asteraStorage() {
  if (route !== '/app/settings/astera-storage') return;
  addOnce('exterior-astera-storage-complete', () => {
    const s = section('Astera Storage 詳細', '容量・Quota・Grace・保存停止・Object Lifecycle外装');
    s.append(chips(['Active', 'Near Limit', 'Over Limit', 'Grace', 'Read Only', 'Deletion Scheduled', 'Unavailable']));
    s.append(facts([
      ['契約容量', '—'],
      ['使用量', '—'],
      ['予約量', '—'],
      ['残量', '—'],
      ['次回Credit減算', '—'],
      ['Grace', '—'],
      ['保存停止', '—'],
      ['削除予定', '—'],
      ['暗号化', '—'],
      ['Private Mode', '保存対象外'],
      ['Object数', '—'],
      ['容量変更', '—'],
    ]));
    s.append(actions(['容量変更', 'File一覧', 'Download', 'Delete', 'Restore Request']));
    return s;
  });
}

function privacy() {
  if (route !== '/app/settings/data-privacy') return;
  addOnce('exterior-privacy-states-complete', () => {
    const s = section('Data Rights 状態', 'Export・削除・再認証を含む状態外装');
    s.append(chips(['Ready', 'Export Preparing', 'Export Ready', 'Deletion Scheduled', 'Legal Hold', 'Error']));
    s.append(facts([
      ['Private Mode', '永続保存しない'],
      ['Normal Mode', '保存設定に従う'],
      ['Data Export', '状態・取得導線'],
      ['削除Request', '状態・取消導線'],
      ['保持期間', '—'],
      ['外部Provider送信', '—'],
      ['同意Version', '—'],
      ['Fresh Session', '重要操作で必要'],
      ['Cookie / 認証技術', '説明表示'],
      ['Legal Hold', '法定保持と本文削除を分離'],
    ]));
    return s;
  });
}

function notifications() {
  if (route !== '/app/settings/notifications') return;
  addOnce('exterior-notifications-complete', () => {
    const s = section('通知・Credit警告 詳細', 'Channel、Event、Quiet Hours、権限、Deep Linkをまとめて表示');
    s.append(facts([
      ['App内通知', '必須 / 無効化不可'],
      ['Email', '任意 ON / OFF'],
      ['Push', '任意 ON / OFF'],
      ['端末Permission', '—'],
      ['低残高Policy', 'Version付きCatalog'],
      ['Quiet Hours', '低残高通知だけ対象'],
      ['Billing権限', '購入Action表示を分離'],
      ['Dedupe', '同一状態の重複禁止'],
    ]));
    s.append(chips(['credit.low', 'credit.critical', 'credit.insufficient', 'credit.purchase_pending', 'credit.credited', 'credit.resume_available', 'credit.resume_blocked']));
    s.append(facts([
      ['通知表示', 'Icon / 見出し / 状態文'],
      ['Credit情報', '残高 / 必要量'],
      ['Action', '状態別Action'],
      ['発生日時', 'Timestamp'],
      ['Deep Link', 'Return Context付き'],
      ['Screen Reader', 'Live Region'],
      ['Mobile', 'Bottom Sheet対応'],
      ['Privacy', 'Prompt / File名 / Secretを含めない'],
    ]));
    return s;
  });
}

function security() {
  if (route !== '/account/security') return;
  addOnce('exterior-security-complete', () => {
    const s = section('Account・Security 詳細', 'Login手段、Session、Security Eventまで含む外装');
    s.append(chips(['Fresh Auth Required', '2FA Setup', 'Recovery Codes Shown', 'Session Revoked', 'Provider Error']));
    s.append(facts([
      ['Password変更', 'Fresh Session'],
      ['Passkey', '一覧 / 名称 / 削除'],
      ['TOTP', '設定 / 状態'],
      ['Backup Code', '再生成 / 1回表示'],
      ['OAuth Identity', 'Link / Unlink'],
      ['Session', '一覧 / 個別失効 / 全失効'],
      ['Security Event', '履歴表示'],
      ['最後のLogin手段', '削除禁止'],
    ]));
    s.append(actions(['Password変更', 'Passkey管理', 'TOTP設定', 'Backup Code再生成', 'OAuth Link/Unlink', 'Session一覧', '全Session失効', 'Security Event']));
    return s;
  });
}

function subscription() {
  if (route !== '/account/subscription') return;
  addOnce('exterior-subscription-complete', () => {
    const s = section('Plan・Subscription 詳細', '契約状態と変更・失敗・Graceを同一Surfaceで確認');
    s.append(chips(['Active', 'Pending Change', 'Past Due', 'Cancelled At Period End', 'Expired', 'Reconciliation']));
    s.append(facts([
      ['Current Plan', '—'],
      ['更新日', '—'],
      ['月次Credit', '—'],
      ['Payment状態', '—'],
      ['Grace', '—'],
      ['Downgrade影響', 'API / Storage / Private等'],
      ['Catalog Version', '—'],
      ['Square管理', '外部導線'],
    ]));
    s.append(actions(['Upgrade', 'Downgrade', '解約', 'Square管理']));
    return s;
  });
}

function credit() {
  if (route !== '/account/credit') return;
  addOnce('exterior-credit-complete', () => {
    const s = section('Credit 状態・Recovery', '購入、Ledger、通常App復帰、Developer API復帰を分けて表示');
    s.append(chips(['Healthy', 'Low', 'Critical', 'Insufficient For Estimate', 'Depleted', 'Purchase Pending', 'Payment Confirmed / Credit Pending', 'Credited', 'App Resume Ready', 'API Resume Evaluating', 'API Auto Resumed', 'API Manual Resume Required', 'Reconciliation', 'Error']));
    s.append(facts([
      ['利用可能残高', '—'],
      ['予約残高', '—'],
      ['概算残り実行回数', '—'],
      ['固定Pack / 自由購入', 'Catalog'],
      ['Ledger Filter', '—'],
      ['取引詳細', '—'],
      ['補填・返却', '—'],
      ['通知設定', '—'],
      ['通常App復帰待ち', '—'],
      ['停止Developer API Key数', '—'],
      ['不足量', '—'],
      ['Return Context', 'Surface / Return Path'],
    ]));
    s.append(actions(['Ledgerを絞り込む', '取引詳細', '元の入力へ戻る', '必要量を減らす', '停止中Keyを見る', '通知設定']));
    return s;
  });
}

function developer() {
  if (route !== '/app/developer') return;
  addOnce('exterior-developer-canon-complete', () => {
    const s = section('Developer Mode 状態・Recovery', 'Key Lifecycle、Credit停止、再開、削除確認までの外装');
    s.append(facts([
      ['Login中Account', '—'],
      ['Tenant / Workspace', '—'],
      ['Current Plan', '—'],
      ['API Entitlement', '—'],
      ['利用可能Credit', '—'],
      ['予約中Credit', '—'],
      ['API全体状態', '—'],
      ['低残高警告', '—'],
    ]));
    s.append(chips(['稼働中', 'Credit残量低下', 'Credit不足で停止中', '補給確認中', '補給済み・自動再開', '補給済み・手動再開待ち', '利用者が停止中', 'Plan変更で停止', 'Account停止', 'Security確認中', 'Target停止', '削除済み']));

    const alert = document.createElement('div');
    alert.className = 'exterior-canon-alert';
    alert.innerHTML = '<strong>Credit不足Banner</strong><p>新しいAPI実行を実行前に停止し、現在残高・必要予約量・停止日時・対象Tenant・Auto Resumeを表示する。</p>';
    alert.append(actions(['Creditを追加', '停止中Keyを見る', '状態を更新']));
    s.append(alert);

    s.append(facts([
      ['Key名 / Prefix', '—'],
      ['Target / Environment', '—'],
      ['Scope', '—'],
      ['主状態 / 全停止理由', '—'],
      ['Auto Resume', '—'],
      ['最終利用', '—'],
      ['今月Request / Credit', '—'],
      ['概算残りRequest', '—'],
      ['Status History', '—'],
      ['Usage / Credit内訳', '—'],
      ['Rate / Quota', '—'],
      ['OpenAPI / Code例', '—'],
    ]));
    s.append(actions(['詳細', 'Rotate', '停止', '再開', '削除', 'もう一度実行']));

    const dialog = document.createElement('div');
    dialog.className = 'exterior-canon-dialog-preview';
    dialog.innerHTML = '<strong>削除前確認Dialog</strong><p>Key名・Prefix・Target・Environment・最終利用・「削除後は復元できない」を表示。Production Keyは再認証が必要。</p>';
    dialog.append(actions(['削除を確認', 'キャンセル']));
    s.append(dialog);

    const pause = document.createElement('div');
    pause.className = 'exterior-canon-dialog-preview';
    pause.innerHTML = '<strong>Pause / Resume</strong><p>Pause理由、予約済み実行の継続/Cancel、残存Holdと解消Actionを表示する。</p>';
    pause.append(actions(['Pause', '予約済みを継続', '予約済みをCancel', 'Resume']));
    s.append(pause);
    return s;
  });
}

function run() {
  style();
  settingsIndex();
  options();
  language();
  templates();
  storageDestinations();
  asteraStorage();
  privacy();
  notifications();
  security();
  subscription();
  credit();
  developer();
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    run();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
else schedule();
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
