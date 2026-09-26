import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertRevisionPurposeAuthority,
  purposeSelectionOrigin,
} from '../functions/_purpose-control.ts';

const MANUAL = ['review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'];

test('manual purposes are user-selected control-plane values', () => {
  for (const purpose of MANUAL) assert.equal(purposeSelectionOrigin(purpose), 'user');
  assert.equal(purposeSelectionOrigin('auto'), 'auto');
});

test('revision keeps the same selected purpose', () => {
  for (const purpose of ['auto', ...MANUAL]) {
    assert.doesNotThrow(() => assertRevisionPurposeAuthority(purpose, purpose));
  }
});

test('cross-purpose revision fails closed instead of receiving revision credit', () => {
  for (const parent of MANUAL) {
    for (const current of MANUAL) {
      if (parent === current) continue;
      assert.throws(
        () => assertRevisionPurposeAuthority(parent, current),
        (error) => error?.code === 'REVISION_PURPOSE_MISMATCH'
          && error?.status === 409
          && error?.details?.parent_purpose === parent
          && error?.details?.current_purpose === current
          && error?.details?.required_action === 'start_new_analysis',
      );
    }
  }
});

test('auto/manual transition is also a new analysis boundary', () => {
  assert.throws(() => assertRevisionPurposeAuthority('auto', 'review'), (error) => error?.code === 'REVISION_PURPOSE_MISMATCH');
  assert.throws(() => assertRevisionPurposeAuthority('review', 'auto'), (error) => error?.code === 'REVISION_PURPOSE_MISMATCH');
});

test('estimate verifies parent purpose before revision diff billing', () => {
  const source = readFileSync(new URL('../functions/api/jobs/estimate.ts', import.meta.url), 'utf8');
  assert.match(source, /SELECT j\.id, j\.state, j\.private_mode, j\.purpose, e\.prompt_sha256/);
  const authority = source.indexOf('assertRevisionPurposeAuthority(parent.purpose, input.purpose)');
  const diff = source.indexOf('return revisedCreditMetric(input.revision.basePrompt, input.prompt, policy)');
  assert.ok(authority >= 0, 'revision purpose authority check is missing');
  assert.ok(diff > authority, 'revision diff billing must happen after purpose authority validation');
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
