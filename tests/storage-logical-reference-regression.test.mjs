import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('0025 adds logical TGserver reference authority without deleting legacy refs', () => {
  const sql = read('../migrations/d1/0025_tgserver_logical_object_refs.sql');
  for (const name of ['tgs_profile','tgs_namespace_ref','tgs_object_ref','tgs_operation_id','tgs_commit_state','tgs_last_reconciled_at']) {
    assert.match(sql, new RegExp(`ADD COLUMN ${name}`));
  }
  assert.match(sql, /DEFAULT 'legacy_v15'/);
  assert.match(sql, /CHECK \(tgs_profile IN \('legacy_v15', 'native_v1'\)\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS astera_storage_objects_native_ref_unique/);
  assert.match(sql, /WHERE tgs_profile = 'native_v1' AND tgs_object_ref IS NOT NULL/);
  assert.doesNotMatch(sql, /DROP COLUMN|RENAME COLUMN/i);
});

test('staging applies 0025 once, skips complete state, and rejects partial state before deploy', () => {
  const workflow = read('../.github/workflows/pages-staging.yml');
  assert.match(workflow, /tgs_ref_column_count=/);
  assert.match(workflow, /if \[ "\$tgs_ref_column_count" = "0" \]/);
  assert.match(workflow, /--file=migrations\/d1\/0025_tgserver_logical_object_refs\.sql/);
  assert.match(workflow, /elif \[ "\$tgs_ref_column_count" = "6" \]/);
  assert.match(workflow, /Unexpected TGserver logical reference column count/);
  assert.match(workflow, /astera_storage_objects_native_ref_unique/);
  assert.match(workflow, /invalid_profile_rows/);
  assert.match(workflow, /expected 6/);
  assert.match(workflow, /expected 1/);
  assert.match(workflow, /expected 0/);
});

test('storage store keeps legacy and native references mutually exclusive at commit', () => {
  const source = read('../functions/_storage-store.ts');
  assert.match(source, /StorageCommitReference=\{profile:'legacy_v15'/);
  assert.match(source, /\|\{profile:'native_v1';objectRef:string;operationId:string\|null;commitState:'committed'\}/);
  assert.match(source, /topicId:null,messageId:null,telegramFileId:null,objectRef:reference\.objectRef/);
  assert.match(source, /objectRef:null,operationId:null,commitState:null/);
  assert.match(source, /tgs_profile=\?1,topic_id=\?2,message_id=\?3,telegram_file_id=\?4,tgs_object_ref=\?5,tgs_operation_id=\?6,tgs_commit_state=\?7/);
});

test('native download requires committed logical identity while legacy still requires physical locator', () => {
  const source = read('../functions/_storage-store.ts');
  assert.match(source, /const profile=r\.tgs_profile\|\|'legacy_v15'/);
  assert.match(source, /profile==='legacy_v15'.*!r\.topic_id\|\|!r\.message_id\|\|!r\.telegram_file_id/s);
  assert.match(source, /profile==='native_v1'.*!r\.tgs_object_ref\|\|r\.tgs_commit_state!=='committed'/s);
});

test('both upload entrypoints accept native logical refs and fail closed on non-committed evidence', () => {
  for (const path of ['../functions/api/storage/uploads/[object]/complete.ts','../functions/api/storage/objects.ts']) {
    const source = read(path);
    assert.match(source, /native_v1/);
    assert.match(source, /tgs_object_ref/);
    assert.match(source, /reportedState/);
    assert.match(source, /reportedState !== 'committed'|reportedState&&reportedState!=='committed'/);
    assert.match(source, /commitState:\s*'committed'/);
  }
});

test('download and failed-upload purge use profile-specific logical headers without exposing Telegram locators for native', () => {
  const download = read('../functions/api/storage/objects/[object]/download.ts');
  const upload = read('../functions/api/storage/objects.ts');
  for (const source of [download, upload]) {
    assert.match(source, /X-Astera-TGS-Profile/);
    assert.match(source, /X-Astera-TGS-Object-Ref/);
    assert.match(source, /native_v1/);
    assert.match(source, /legacy_v15/);
  }
  assert.match(download, /if\(r\.tgs_profile==='native_v1'\)/);
  assert.match(upload, /if\(reference\.profile==='native_v1'\)/);
});

test('public storage payload remains logical App metadata and does not expose TGserver or Telegram locators', () => {
  const source = read('../functions/_storage-store.ts');
  const start = source.indexOf('function payload');
  const end = source.indexOf('async function owned', start);
  assert.ok(start >= 0 && end > start);
  const payload = source.slice(start, end);
  for (const forbidden of ['topic_id','message_id','telegram_file_id','tgs_object_ref','tgs_operation_id','tgs_namespace_ref']) {
    assert.doesNotMatch(payload, new RegExp(forbidden));
  }
});
