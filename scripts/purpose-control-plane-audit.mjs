import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const productionFiles = [
  'src/features/composer/NativeComposerPage.tsx',
  'functions/_job-policy.ts',
  'functions/_runtime.ts',
  'functions/api/jobs/index.ts',
  'functions/api/jobs/estimate.ts',
  'functions/_history-store.ts',
  'functions/_template-store.ts',
  'functions/_project-store.ts',
  'contabo/app-api/src/core-process-adapter.ts',
];

const forbiddenFreeFormPurpose = [
  /User-selected analysis purpose:/i,
  /analysis purpose:\s*\$?\{/i,
  /Preserve this as analysis intent/i,
];

for (const file of productionFiles) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of forbiddenFreeFormPurpose) {
    assert.doesNotMatch(source, pattern, `${file} reintroduced free-form Purpose text into the data plane`);
  }
}

const composer = readFileSync('src/features/composer/NativeComposerPage.tsx', 'utf8');
assert.match(composer, /prompt:\s*submittedText,[\s\S]*?purpose,/m, 'Composer must send prompt and purpose as separate fields');
assert.doesNotMatch(composer, /submittedText\s*[+`]\s*[^\n]*purpose|purpose\s*[+`]\s*[^\n]*submittedText/i, 'Composer must not concatenate purpose into prompt');

const policy = readFileSync('functions/_job-policy.ts', 'utf8');
assert.match(policy, /purpose:\s*input\.purpose/, 'request fingerprint must bind selected purpose');

const adapter = readFileSync('contabo/app-api/src/core-process-adapter.ts', 'utf8');
assert.match(adapter, /app_purpose_contract/, 'manual purpose must remain structured control metadata');
assert.match(adapter, /selected_by:\s*'user'/, 'manual purpose provenance must remain explicit');

const resultTrigger = readFileSync('migrations/d1/0009_result_settlement_trigger.sql', 'utf8');
assert.match(resultTrigger, /NEW\.purpose/, 'Result persistence must preserve selected Job purpose');

const history = readFileSync('functions/_history-store.ts', 'utf8');
assert.match(history, /r\.purpose=\?5/, 'History filtering must use persisted purpose, not text inference');
assert.doesNotMatch(history, /inferPurpose|classifyPurpose|detectPurpose/i, 'History must not reclassify Result text');

const templates = readFileSync('functions/_template-store.ts', 'utf8');
assert.doesNotMatch(templates, /setPurpose|inferPurpose|classifyPurpose|detectPurpose/i, 'Template content must not silently become Purpose authority');

const projects = readFileSync('functions/_project-store.ts', 'utf8');
assert.doesNotMatch(projects, /setPurpose|inferPurpose|classifyPurpose|detectPurpose/i, 'Project context must not silently become Purpose authority');

const legacyProjection = readFileSync('public/canonical-interaction-contract.js', 'utf8');
const projectionStart = legacyProjection.indexOf('function commandProjection()');
const projectionEnd = legacyProjection.indexOf('function refreshCommandProjection()');
const projectionBody = legacyProjection.slice(projectionStart, projectionEnd);
assert.ok(projectionStart >= 0 && projectionEnd > projectionStart, 'legacy command projection boundary missing');
assert.doesNotMatch(projectionBody, /textarea\.value\s*=|setNativeValue\([^,]+,\s*commands/i, 'legacy Purpose projection must not rewrite user prompt text');

console.log('PURPOSE_CONTROL_PLANE_AUDIT=PASS');
