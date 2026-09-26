import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const MANUAL = ['review', 'compare', 'verify', 'improve', 'research', 'plan', 'consider'];
const control = readFileSync(new URL('../functions/_purpose-control.ts', import.meta.url), 'utf8');

test('purpose control module keeps manual/user and auto origins distinct', () => {
  assert.match(control, /purpose === 'auto' \? 'auto' : 'user'/);
  for (const purpose of MANUAL) assert.match(control, new RegExp(`PurposeKey|${purpose}|currentPurpose`));
});

test('cross-purpose revision fails closed as a new-analysis boundary', () => {
  assert.match(control, /normalizedParent === currentPurpose/);
  assert.match(control, /REVISION_PURPOSE_MISMATCH/);
  assert.match(control, /required_action:\s*'start_new_analysis'/);
  assert.match(control, /parent_purpose:\s*normalizedParent/);
  assert.match(control, /current_purpose:\s*currentPurpose/);
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
