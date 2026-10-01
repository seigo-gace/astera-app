import assert from 'node:assert/strict';
import test from 'node:test';
import { ASTERA_EVIDENCE_MARKER, parseCoreEvidenceTrailer } from './core-evidence-contract.js';

const MAIN8 = [
  ['01 本当の目的', '- 目的'],['02 前提不足', '- 前提'],['03 事実確認', '- 事実'],['04 危機察知', '- リスク'],
  ['05 反対視点', '- 反対'],['06 比較案', '- 比較'],['07 根拠成立状態', '- 根拠'],['08 主役AI／利用者への再指示', '- 再指示'],
].map(([title, body]) => `${title}\n${body}`).join('\n---\n');

function payload(source: Record<string, unknown>) {
  return `${MAIN8}\n${ASTERA_EVIDENCE_MARKER}\n${JSON.stringify({
    schema_version: 'astera.evidence-citation.v1',
    source_count: 1,
    sources: [source],
    section_source_ids: { '03_facts': ['E01'] },
    claim_source_ids: { cl_01: ['E01'] },
  })}`;
}

function validSource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'E01', source_id: 'E01', display_number: 1,
    candidate_id: 'ev_01', canonical_record_id: 'official:record:01', title: 'Official Record',
    url: null, canonical_locator: { url: null, locator_type: 'RECORD_ID', replayable: true },
    provider_id: 'official-provider', source_class: 'AUTHORITATIVE', source_role: 'OFFICIAL', source_family_id: 'official-family', authority_id: 'official.example',
    publisher: { id: 'official.example', name: 'Official Publisher' }, excerpt: 'Observed official evidence.',
    published_at: null, updated_at: '2026-10-01T00:00:00Z', retrieved_at: '2026-10-01T12:00:00Z', content_hash: 'hash', revision_id: 'rev1', verification_status: 'confirmed',
    section_keys: ['03_facts'],
    claim_links: [{ task_id: 'T01', claim_id: 'cl_01', claim_text: '検証対象の主張', confirmation_status: 'CONFIRMED', relation: 'SUPPORTS', binding_id: 'eb_01' }],
    ...overrides,
  };
}

test('replayable canonical record locator is accepted when URL is absent', () => {
  const parsed = parseCoreEvidenceTrailer(payload(validSource()));
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0]?.canonical_record_id, 'official:record:01');
  assert.equal(parsed.sources[0]?.canonical_locator.replayable, true);
});

test('candidate id alone is not accepted as a replayable public evidence locator', () => {
  const source = validSource({ canonical_record_id: null, canonical_locator: { url: null, locator_type: 'RECORD_ID', replayable: false } });
  assert.throws(
    () => parseCoreEvidenceTrailer(payload(source)),
    (error: unknown) => (error as { code?: string }).code === 'ASTERA_EVIDENCE_CONTRACT_INVALID',
  );
});

test('claim link must identify the claim and canonical binding', () => {
  const noClaim = validSource({ claim_links: [{ task_id: 'T01', claim_id: null, claim_text: '', confirmation_status: 'CONFIRMED', relation: 'SUPPORTS', binding_id: 'eb_01' }] });
  assert.throws(() => parseCoreEvidenceTrailer(payload(noClaim)), (error: unknown) => (error as { code?: string }).code === 'ASTERA_EVIDENCE_CONTRACT_INVALID');
  const noBinding = validSource({ claim_links: [{ task_id: 'T01', claim_id: 'cl_01', claim_text: '検証対象の主張', confirmation_status: 'CONFIRMED', relation: 'SUPPORTS', binding_id: null }] });
  assert.throws(() => parseCoreEvidenceTrailer(payload(noBinding)), (error: unknown) => (error as { code?: string }).code === 'ASTERA_EVIDENCE_CONTRACT_INVALID');
});

test('direct HTTP source remains usable even when provider marks canonical replay false', () => {
  const source = validSource({
    url: 'https://official.example/record/01',
    canonical_record_id: null,
    canonical_locator: { url: 'https://official.example/record/01', locator_type: 'URL', replayable: false },
  });
  const parsed = parseCoreEvidenceTrailer(payload(source));
  assert.equal(parsed.sources[0]?.url, 'https://official.example/record/01');
  assert.equal(parsed.sources[0]?.canonical_locator.replayable, false);
});
