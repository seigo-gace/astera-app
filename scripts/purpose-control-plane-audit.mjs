import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const productionFiles = [
  'src/features/composer/NativeComposerPage.tsx',
  'functions/_job-policy.ts',
  'functions/_runtime.ts',
  'functions/api/jobs/index.ts',
  'functions/api/jobs/estimate.ts',
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

console.log('PURPOSE_CONTROL_PLANE_AUDIT=PASS');
