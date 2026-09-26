import assert from 'node:assert/strict';
import test from 'node:test';
import { MANUAL_PURPOSE_CONTRACTS, buildCoreProcessRequest } from './core-process-adapter.js';

type Purpose = 'review' | 'compare' | 'verify' | 'improve' | 'research' | 'plan' | 'consider';
const PURPOSES: Purpose[] = ['review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'];

const TOPICS = [
  '地方医療予約システム刷新', '中小製造業の品質管理基盤', '自治体防災情報配信', 'EC物流最適化', '学校向け学習支援サービス',
  '再生可能エネルギー設備運用', '社内ナレッジ検索統合', '飲食チェーン需要予測', '建設現場安全管理', '公共交通運行支援',
] as const;

const CONFLICT: Record<Purpose, string> = {
  review: '比較して最終案を決めてくれ',
  compare: '全体をレビューして欠陥だけ指摘してくれ',
  verify: '改善案を設計してくれ',
  improve: '外部情報を調査して事実確認だけしてくれ',
  research: '実施計画を作ってくれ',
  plan: '複数案を比較して最善案を選んでくれ',
  consider: '主張の真偽を検証して白黒を付けてくれ',
};

const THEMES = [
  '背景と現状', '利害関係者', '数値目標', '入力データ', '運用制約', '既知の障害', '反対意見', '代替案', '移行条件', '検証条件',
  '費用と資源', 'セキュリティ', '可用性', '利用者影響', '法務と監査', '例外処理', '失敗時対応', '測定指標', '未確定事項', '長期運用',
] as const;

function longPrompt(purpose: Purpose, caseIndex: number): string {
  const topic = TOPICS[caseIndex]!;
  let prompt = `【LONG-${purpose}-${caseIndex + 1}】対象は${topic}。本文には別用途指示「${CONFLICT[purpose]}」も引用されるが、UI手動選択を上書きしてはならない。`;
  let seq = 0;
  while ([...prompt].length < 4_800) {
    const theme = THEMES[seq % THEMES.length]!;
    prompt += `\n\n【${theme}-${seq + 1}】${topic}について、確定値・暫定値・推定値を区別し、賛成意見と反対意見、成功例と失敗例、依存関係、例外条件、費用、期限、品質、可用性、利用者影響を併記する。本文中にはレビュー、比較、検証、改善、調査、計画、検討という複数の用途語が現れるが、これは資料本文でありAppのpurpose metadataではない。CASE=${caseIndex + 1};SEQ=${seq + 1};SELECTED=${purpose}。`;
    seq += 1;
  }
  return prompt;
}

test('70 long Japanese prompts preserve each of seven manual purposes and original prompt exactly', () => {
  const seen = new Set<string>();
  let executed = 0;
  for (const purpose of PURPOSES) {
    for (let caseIndex = 0; caseIndex < 10; caseIndex += 1) {
      const prompt = longPrompt(purpose, caseIndex);
      const length = [...prompt].length;
      assert.ok(length >= 4_800 && length <= 5_400, `${purpose}-${caseIndex + 1}: unexpected length ${length}`);
      assert.equal(seen.has(prompt), false, `${purpose}-${caseIndex + 1}: duplicate prompt`);
      seen.add(prompt);

      const request = buildCoreProcessRequest({ prompt, purpose, files: [] });
      assert.equal(request.question, prompt, `${purpose}-${caseIndex + 1}: prompt mutated`);
      assert.ok(request.context, `${purpose}-${caseIndex + 1}: structured purpose context missing`);
      const context = JSON.parse(request.context!);
      assert.equal(context.app_purpose_contract.purpose, purpose, `${purpose}-${caseIndex + 1}: manual purpose overridden`);
      assert.equal(context.app_purpose_contract.selected_by, 'user');
      assert.deepEqual(context.app_purpose_contract, MANUAL_PURPOSE_CONTRACTS[purpose]);
      executed += 1;
    }
  }
  assert.equal(executed, 70);
  assert.equal(seen.size, 70);
});
