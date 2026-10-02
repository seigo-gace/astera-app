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
    assert.deepEqual(revisionPurposeAuthority(purpose, purpose), { mode: 'revision' });
  }
});

test('all 42 manual cross-purpose transitions become full new analyses', () => {
  let mismatches = 0;
  for (const parent of MANUAL) {
    for (const current of MANUAL) {
      if (parent === current) continue;
      const result = revisionPurposeAuthority(parent, current);
      assert.equal(result.mode, 'full');
      if (result.mode !== 'full') continue;
      assert.equal(result.reason, 'REVISION_PURPOSE_MISMATCH');
      assert.equal(result.parent_purpose, parent);
      assert.equal(result.current_purpose, current);
      assert.equal(result.required_action, 'start_new_analysis');
      mismatches += 1;
    }
  }
  assert.equal(mismatches, 42);
});

test('auto/manual transitions are also full new analyses', () => {
  for (const [parent, current] of [['auto', 'review'], ['review', 'auto']]) {
    const result = revisionPurposeAuthority(parent, current);
    assert.equal(result.mode, 'full');
    if (result.mode === 'full') assert.equal(result.required_action, 'start_new_analysis');
  }
});

test('estimate strips revision billing when purpose authority changes', () => {
  const source = readFileSync(new URL('../functions/api/jobs/estimate.ts', import.meta.url), 'utf8');
  assert.match(source, /SELECT j\.id, j\.state, j\.private_mode, j\.purpose, j\.purpose_text, e\.prompt_sha256/);
  const authority = source.indexOf('revisionPurposeAuthority(parent.purpose, input.purpose)');
  const downgrade = source.indexOf("if (purposeAuthority.mode === 'full')", authority);
  const parentReset = source.indexOf('effectiveParentJobId: null', downgrade);
  const diff = source.indexOf('metric: revisedCreditMetric(input.revision.basePrompt, input.prompt, policy)', parentReset);
  assert.ok(authority >= 0, 'revision purpose authority check is missing');
  assert.ok(downgrade > authority, 'cross-purpose revision must be downgraded to full analysis');
  assert.ok(parentReset > downgrade, 'cross-purpose full analysis must clear effective revision parent');
  assert.ok(diff > parentReset, 'revision diff billing must happen only on the same-purpose path');
  assert.match(source, /billing_mode:\s*revisionDecision\.effectiveParentJobId \? 'revision' : 'full'/);
  assert.match(source, /revision_reset_reason:\s*revisionDecision\.resetReason/);
});

test('selected purpose participates in estimate/job fingerprint authority', () => {
  const source = readFileSync(new URL('../functions/_job-policy.ts', import.meta.url), 'utf8');
  const stable = source.slice(source.indexOf('function stableInput'), source.indexOf('async function sha256'));
  assert.match(stable, /purpose:\s*input\.purpose/);
});

test('estimate exposes purpose provenance without rewriting prompt', () => {
  const source = readFileSync(new URL('../functions/api/jobs/estimate.ts', import.meta.url), 'utf8');
  assert.match(source, /purpose:\s*input\.purpose/);
  assert.match(source, /purpose_origin:\s*purposeSelectionOrigin\(input\.purpose\)/);
});

test('private custom purpose text and failure messages stay transient instead of being persisted to D1', () => {
  const jobs = readFileSync(new URL('../functions/api/jobs/index.ts', import.meta.url), 'utf8');
  assert.match(jobs, /const persistedPurposeText = input\.privateMode \? null : purposeText;/);
  assert.match(jobs, /input\.purpose, persistedPurposeText, optionSummary/);
  assert.match(jobs, /purpose_text: persistedPurposeText/);
  assert.match(jobs, /purpose_text: purposeText,\n\s+options: input\.options/);

  const settlement = readFileSync(new URL('../functions/_job-settlement.ts', import.meta.url), 'utf8');
  assert.match(settlement, /const persistedMessage = Boolean\(job\.private_mode\) \? null : message;/);
  assert.match(settlement, /\.bind\(state, code, persistedMessage, now, job\.id\)/);
  assert.match(settlement, /JSON\.stringify\(Boolean\(job\.private_mode\) \? \{ code \} : \{ code, message \}\)/);
  assert.match(settlement, /error_message: message/);
});

test('result and history preserve selected purpose as provenance instead of reclassifying text', () => {
  const trigger = readFileSync(new URL('../migrations/d1/0009_result_settlement_trigger.sql', import.meta.url), 'utf8');
  const history = readFileSync(new URL('../functions/_history-store.ts', import.meta.url), 'utf8');
  const purposeIndex = readFileSync(new URL('../migrations/d1/0021_purpose_history_index.sql', import.meta.url), 'utf8');
  assert.match(trigger, /NEW\.purpose/);
  assert.match(history, /r\.purpose=\?5/);
  assert.doesNotMatch(history, /inferPurpose|classifyPurpose|detectPurpose/i);
  assert.match(purposeIndex, /CREATE INDEX IF NOT EXISTS results_tenant_purpose_created/);
  assert.match(purposeIndex, /ON results\(tenant_id, purpose, created_at DESC\)/);
});
