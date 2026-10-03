import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repositorySource = readFileSync(new URL('../functions/_app-event-outbox.ts', import.meta.url), 'utf8');
const senderSource = readFileSync(new URL('../functions/_app-event-outbox-sender.ts', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('../docs/integrations/tgserver-vnext-app-event-outbox-schema.sql', import.meta.url), 'utf8');

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('delivered finalization requires a remote operation identity before D1 mutation', () => {
  const delivered = section(
    repositorySource,
    'export async function markAppEventOutboxDelivered',
    'export async function scheduleAppEventOutboxRetry',
  );
  assert.match(delivered, /tgsOperationId: string/);
  const validation = delivered.indexOf('requiredOperationId(tgsOperationId)');
  const prepare = delivered.indexOf('db.prepare');
  assert.ok(validation >= 0 && validation < prepare, 'remote operation identity must be validated before D1 prepare');
  assert.match(delivered, /tgs_operation_id=\?1/);
  assert.doesNotMatch(delivered, /COALESCE\(/);
});

test('outbox schema rejects delivered rows without a TGserver operation identity', () => {
  assert.match(schemaSource, /CHECK \(state <> 'delivered' OR tgs_operation_id IS NOT NULL\)/);
});

test('sender finalizes delivery with the committed remote operation identity', () => {
  assert.match(
    senderSource,
    /markAppEventOutboxDelivered\(db, claim, completionNow, receipt\.operationId\)/,
  );
});

test('repository runtime guards reject non-string values instead of trusting TypeScript only', () => {
  assert.match(repositorySource, /function iso\(value: unknown, code: string\)/);
  assert.match(repositorySource, /function boundedText\(value: unknown, code: string, max: number\)/);
  assert.match(repositorySource, /if \(typeof value !== 'string'\) throw new Error\(code\)/);
});
