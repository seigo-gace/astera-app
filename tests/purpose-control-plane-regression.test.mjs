import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  purposeSelectionOrigin,
  revisionPurposeAuthority,
} from '../functions/_purpose-control.ts';

const MANUAL = ['review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'];

test('manual purposes are user-selected control-plane values and auto stays auto', () => {
  for (const purpose of MANUAL) assert.equal(purposeSelectionOrigin(purpose), 'user');
  assert.equal(purposeSelectionOrigin('auto'), 'auto');
});

test('same-purpose revisions remain eligible for revision treatment', () => {
  for (const purpose of ['auto', ...MANUAL]) {
    assert.deepEqual(revisionPurposeAuthority(purpose, purpose), { ok: true });
  }
});

test('all 42 manual cross-purpose transitions become new-analysis boundaries', () => {
  let mismatches = 0;
  for (const parent of MANUAL) {
    for (const current of MANUAL) {
      if (parent === current) continue;
      const result = revisionPurposeAuthority(parent, current);
      assert.equal(result.ok, false);
      if (result.ok) continue;
      assert.equal(result.code, 'REVISION_PURPOSE_MISMATCH');
      assert.equal(result.status, 409);
      assert.equal(result.parent_purpose, parent);
      assert.equal(result.current_purpose, current);
      assert.equal(result.required_action, 'start_new_analysis');
      mismatches += 1;
    }
  }
  assert.equal(mismatches, 42);
});

test('auto/manual transitions also become new-analysis boundaries', () => {
  for (const [parent, current] of [['auto', 'review'], ['review', 'auto']]) {
    const result = revisionPurposeAuthority(parent, current);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.required_action, 'start_new_analysis');
  }
});

test('estimate verifies parent purpose before revision diff billing', () => {
  const source = readFileSync(new URL('../functions/api/jobs/estimate.ts', import.meta.url), 'utf8');
  assert.match(source, /SELECT j\.id, j\.state, j\.private_mode, j\.purpose, e\.prompt_sha256/);
  const authority = source.indexOf('revisionPurposeAuthority(parent.purpose, input.purpose)');
  const rejection = source.indexOf("'用途を変更した実行は修整再投稿として扱えません。新しい分析として実行してください。'");
  const diff = source.indexOf('return revisedCreditMetric(input.revision.basePrompt, input.prompt, policy)');
  assert.ok(authority >= 0, 'revision purpose authority check is missing');
  assert.ok(rejection > authority, 'purpose mismatch must become an explicit fail-closed response');
  assert.ok(diff > rejection, 'revision diff billing must happen only after purpose authority validation');
});

test('selected purpose participates in estimate/job fingerprint authority', () => {
  const source = readFileSync(new URL('../functions/_job-policy.ts', import.meta.url), 'utf8');
  const stable = source.slice(source.indexOf('function stableInput'), source.indexOf('async function sha256'));
  assert.match(stable, /purpose:\s*input\.purpose/);
});

test('result and history preserve selected purpose as provenance instead of reclassifying text', () => {
  const trigger = readFileSync(new URL('../migrations/d1/0009_result_settlement_trigger.sql', import.meta.url), 'utf8');
  const history = readFileSync(new URL('../functions/_history-store.ts', import.meta.url), 'utf8');
  assert.match(trigger, /NEW\.purpose/);
  assert.match(history, /r\.purpose=\?5/);
  assert.doesNotMatch(history, /inferPurpose|classifyPurpose|detectPurpose/i);
});
