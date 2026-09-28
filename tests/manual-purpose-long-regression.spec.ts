import { expect, test, type Page, type Route } from '@playwright/test';

type Purpose = 'review' | 'compare' | 'verify' | 'improve' | 'research' | 'plan' | 'consider';

const PURPOSES: Array<[Purpose, string]> = [
  ['review', 'レビュー'],
  ['compare', '比較'],
  ['verify', '検証'],
  ['improve', '改善'],
  ['research', '調査'],
  ['plan', '計画'],
  ['consider', '検討'],
];

const TOPICS = [
  ['地方医療予約システム刷新', '複数病院の予約、紹介状、当日受付、災害時切替を統合する計画。高齢利用者の操作性、個人情報、既存電子カルテとの連携、停止時間の最小化が論点。'],
  ['中小製造業の品質管理基盤', '検査記録、設備保全、ロット追跡、不良原因分析を一本化する案件。現場入力負荷、センサー精度、紙帳票移行、監査証跡、教育コストが論点。'],
  ['自治体防災情報配信', '避難情報、河川水位、停電、道路規制を住民へ多経路配信する仕組み。誤報耐性、多言語、通信断、位置情報、責任分界が論点。'],
  ['EC物流最適化', '在庫配置、配送会社選択、返品、繁忙期増員を統合する改善案。配送費、遅延率、欠品、倉庫作業負荷、顧客通知品質が論点。'],
  ['学校向け学習支援サービス', '教材配信、課題提出、保護者連絡、学習履歴を扱うサービス。年齢別UI、アクセシビリティ、端末差、教員負荷、データ保持が論点。'],
  ['再生可能エネルギー設備運用', '太陽光、蓄電池、需要予測、売電制御を組み合わせる運用案。気象変動、劣化、保守契約、系統制約、収益予測が論点。'],
  ['社内ナレッジ検索統合', '文書、議事録、FAQ、チケットを横断検索する基盤。権限継承、更新鮮度、重複文書、検索精度、監査ログが論点。'],
  ['飲食チェーン需要予測', '店舗別需要、食材発注、廃棄削減、人員配置を最適化する計画。季節性、イベント影響、欠測、現場例外、説明可能性が論点。'],
  ['建設現場安全管理', '入退場、危険区域、点検、事故報告を統合する仕組み。通信不安定、手袋操作、位置精度、協力会社権限、法定保存が論点。'],
  ['公共交通運行支援', 'バス遅延、乗継、運休、車両点検を統合する運行支援。リアルタイム性、誤差、現場裁量、乗客案内、災害時運用が論点。'],
] as const;

const CONFLICTING_SENTENCE: Record<Purpose, string> = {
  review: '本文中には「候補を比較して最終案を決めてくれ」という別用途の依頼文も引用されている。',
  compare: '本文中には「全体をレビューして欠陥だけ指摘してくれ」という別用途の依頼文も引用されている。',
  verify: '本文中には「改善案を設計して実装順まで決めてくれ」という別用途の依頼文も引用されている。',
  improve: '本文中には「外部情報を調査して事実確認だけしてくれ」という別用途の依頼文も引用されている。',
  research: '本文中には「実施計画を作って担当と期限まで決めてくれ」という別用途の依頼文も引用されている。',
  plan: '本文中には「複数案を比較して最善案を選んでくれ」という別用途の依頼文も引用されている。',
  consider: '本文中には「主張の真偽を検証して白黒を付けてくれ」という別用途の依頼文も引用されている。',
};

const SECTION_THEMES = [
  '背景と現状', '利害関係者', '数値目標', '入力データ', '運用制約', '既知の障害', '反対意見', '代替案', '移行条件', '検証条件',
  '費用と資源', 'セキュリティ', '可用性', '利用者影響', '法務と監査', '例外処理', '失敗時対応', '測定指標', '未確定事項', '長期運用',
] as const;

function buildLongPrompt(purpose: Purpose, caseIndex: number): string {
  const [title, summary] = TOPICS[caseIndex]!;
  let prompt = `【LONG-${purpose}-${String(caseIndex + 1).padStart(2, '0')}】\n対象: ${title}\n${summary}\n${CONFLICTING_SENTENCE[purpose]}\n以下は利用者が実際に渡す長文資料を模した本文であり、UIで選択した用途を本文中の語句から再判定してはならない。`;
  let sequence = 0;
  while ([...prompt].length < 4_800) {
    const theme = SECTION_THEMES[sequence % SECTION_THEMES.length]!;
    const round = Math.floor(sequence / SECTION_THEMES.length) + 1;
    prompt += `\n\n【資料${String(sequence + 1).padStart(2, '0')}｜${theme}｜第${round}巡】${title}では、${summary} 現場からは同じ事象について賛成意見と反対意見が混在し、数値は暫定値・確定値・推定値を区別する必要がある。担当部署ごとに前提が異なるため、引用された「レビュー」「比較」「検証」「改善」「調査」「計画」「検討」という語だけで用途を上書きしてはならない。資料には成功例だけでなく、失敗例、保留事項、例外条件、外部依存、期限、費用、品質条件、利用者への影響も含まれる。CASE=${caseIndex + 1};SEQ=${sequence + 1};SELECTED=${purpose}。`;
    sequence += 1;
  }
  return prompt;
}

const RESULT_KEYS = [
  'true_purpose', 'missing_assumptions', 'fact_check', 'risk_detection',
  'counter_view', 'alternatives', 'recommendation', 'next_prompt',
] as const;

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

function completeSections() {
  return RESULT_KEYS.map((key, index) => ({ key, title: `判断材料 ${index + 1}`, body: `long-purpose gate ${index + 1}`, source_ids: [] }));
}

async function installRuntime(page: Page, estimates: Array<Record<string, unknown>>, jobs: Array<Record<string, unknown>>) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/account') return json(route, { account: { id: 'purpose-long-user', display_name: 'Purpose Long', account_status: 'active' } });
    if (path === '/api/preferences') return json(route, { preferences: { translation: true, agent_mode: true, document: true, storage_transfer: true } });
    if (path === '/api/history') return json(route, { items: [] });
    if (path === '/api/credit/balance') return json(route, { usable_balance: 100000, reserved_balance: 0, state: 'healthy', policy: { low_threshold: 200 } });
    if (path === '/api/account/catalog') return json(route, { subscription: { plan_id: 'basic' }, plans: [{ plan_id: 'basic', included_credits: 100000 }] });
    if (path === '/api/projects') return json(route, { projects: [] });
    if (path === '/api/templates') return json(route, { templates: [] });
    if (path === '/api/storage/destinations') return json(route, { destinations: [] });
    if (path === '/api/jobs/estimate' && request.method() === 'POST') {
      estimates.push(request.postDataJSON() as Record<string, unknown>);
      return json(route, { estimate: { estimate_id: `long-estimate-${estimates.length}`, required_credits: 1, available_credits: 100000, reserved_credits: 0, credit_state: 'normal', expires_at: new Date(Date.now() + 60_000).toISOString(), billing_mode: 'full', billable_characters: 5000 } }, 201);
    }
    if (path === '/api/jobs' && request.method() === 'POST') {
      jobs.push(request.postDataJSON() as Record<string, unknown>);
      return json(route, { job: { job_id: `long-purpose-job-${jobs.length}`, state: 'completed', result: { sections: completeSections() } } }, 201);
    }
    return json(route, { ok: true });
  });
}

for (const [purpose, label] of PURPOSES) {
  test(`LONG-${purpose}: 10 x approximately 5000 Japanese characters keep manual purpose fixed`, async ({ page }) => {
    const estimates: Array<Record<string, unknown>> = [];
    const jobs: Array<Record<string, unknown>> = [];
    await installRuntime(page, estimates, jobs);
    await page.goto('/app/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Astera入力')).toBeVisible();

    const purposeControl = page.getByLabel('Purposeを選択');
    await purposeControl.click();
    const initialDialog = page.getByRole('dialog', { name: '用途・目的' });
    await expect(initialDialog).toBeVisible();
    await initialDialog.getByRole('button', { name: label, exact: true }).click();
    await expect(purposeControl).toContainText(label);

    for (let caseIndex = 0; caseIndex < 10; caseIndex += 1) {
      if (caseIndex > 0 && await page.getByRole('button', { name: '新規' }).count()) await page.getByRole('button', { name: '新規' }).click();
      await expect(purposeControl).toContainText(label);

      const prompt = buildLongPrompt(purpose, caseIndex);
      const length = [...prompt].length;
      expect(length, `${purpose}-${caseIndex + 1}: prompt too short`).toBeGreaterThanOrEqual(4_800);
      expect(length, `${purpose}-${caseIndex + 1}: prompt too long`).toBeLessThanOrEqual(5_400);

      await page.getByLabel('Astera入力').fill(prompt);
      await page.getByRole('button', { name: '実行', exact: true }).click();
      await expect(page.locator('.native-result-section')).toHaveCount(8);

      const estimate = estimates.at(-1);
      const job = jobs.at(-1);
      expect(estimate?.purpose, `${purpose}-${caseIndex + 1}: estimate purpose changed`).toBe(purpose);
      expect(job?.purpose, `${purpose}-${caseIndex + 1}: job purpose changed`).toBe(purpose);
      expect(estimate?.prompt, `${purpose}-${caseIndex + 1}: estimate prompt mutated`).toBe(prompt);
      expect(job?.prompt, `${purpose}-${caseIndex + 1}: job prompt mutated`).toBe(prompt);
    }

    expect(estimates).toHaveLength(10);
    expect(jobs).toHaveLength(10);
    expect(new Set(jobs.map((item) => item.prompt)).size).toBe(10);
  });
}
