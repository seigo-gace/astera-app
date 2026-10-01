export const ASTERA_EVIDENCE_MARKER = '===ASTERA_EVIDENCE===';

export type CoreEvidenceClaimLink = {
  task_id: string | null;
  claim_id: string | null;
  claim_text: string;
  confirmation_status: string | null;
  relation: string;
  binding_id: string;
};

export type CoreEvidenceSource = {
  id: string;
  source_id: string;
  display_number: number;
  candidate_id: string | null;
  canonical_record_id: string | null;
  title: string;
  url: string | null;
  canonical_locator: { url: string | null; locator_type: string; replayable: boolean };
  provider_id: string | null;
  source_class: string | null;
  source_role: string | null;
  source_family_id: string | null;
  authority_id: string | null;
  publisher: { id: string | null; name: string | null };
  excerpt: string;
  published_at: string | null;
  updated_at: string | null;
  retrieved_at: string | null;
  content_hash: string | null;
  revision_id: string | null;
  verification_status: string;
  section_keys: string[];
  claim_links: CoreEvidenceClaimLink[];
};

export type ParsedCoreEvidence = {
  main8: string;
  schema_version: string | null;
  sources: CoreEvidenceSource[];
  section_source_ids: Record<string, string[]>;
  claim_source_ids: Record<string, string[]>;
};

type ContractError = Error & { code?: string; retryable?: boolean };
function contractError(message: string): ContractError {
  return Object.assign(new Error(message), { code: 'ASTERA_EVIDENCE_CONTRACT_INVALID', retryable: false });
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))] : [];
}
function safeUrl(value: unknown): string | null {
  const raw = stringOrNull(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported scheme');
    return url.toString();
  } catch {
    throw contractError('Evidence URL is not a valid HTTP(S) URL.');
  }
}
function parseClaimLink(value: unknown): CoreEvidenceClaimLink {
  const item = record(value);
  const relation = stringOrNull(item.relation);
  if (!relation || !['SUPPORTS', 'CONTRADICTS', 'PARTIALLY_SUPPORTS'].includes(relation)) {
    throw contractError('Evidence claim link relation is invalid.');
  }
  const claimId = stringOrNull(item.claim_id);
  const claimText = stringOrNull(item.claim_text) || '';
  if (!claimId && !claimText) throw contractError('Evidence claim link has no claim identity.');
  const bindingId = stringOrNull(item.binding_id);
  if (!bindingId) throw contractError('Evidence claim link has no binding identity.');
  return {
    task_id: stringOrNull(item.task_id),
    claim_id: claimId,
    claim_text: claimText,
    confirmation_status: stringOrNull(item.confirmation_status),
    relation,
    binding_id: bindingId,
  };
}
function parseSource(value: unknown, index: number): CoreEvidenceSource {
  const item = record(value);
  const id = stringOrNull(item.id);
  if (!id || !/^E\d{2,}$/u.test(id)) throw contractError(`Evidence source ${index + 1} has an invalid id.`);
  const locator = record(item.canonical_locator);
  const url = safeUrl(item.url ?? locator.url);
  const canonicalRecordId = stringOrNull(item.canonical_record_id);
  const locatorType = stringOrNull(locator.locator_type) || (url ? 'URL' : 'RECORD_ID');
  const locatorReplayable = locator.replayable !== false;
  const hasReplayableIdentity = Boolean(url) || Boolean(canonicalRecordId && locatorReplayable);
  if (!hasReplayableIdentity) throw contractError(`Evidence source ${id} has no replayable URL or canonical record locator.`);
  const claimLinks = Array.isArray(item.claim_links) ? item.claim_links.map(parseClaimLink) : [];
  if (!claimLinks.length) throw contractError(`Evidence source ${id} is not linked to any claim.`);
  const publisher = record(item.publisher);
  return {
    id,
    source_id: stringOrNull(item.source_id) || id,
    display_number: Number.isInteger(item.display_number) && Number(item.display_number) > 0 ? Number(item.display_number) : index + 1,
    candidate_id: stringOrNull(item.candidate_id),
    canonical_record_id: canonicalRecordId,
    title: stringOrNull(item.title) || stringOrNull(publisher.name) || url || canonicalRecordId || id,
    url,
    canonical_locator: { url, locator_type: locatorType, replayable: locatorReplayable && Boolean(url || canonicalRecordId) },
    provider_id: stringOrNull(item.provider_id),
    source_class: stringOrNull(item.source_class),
    source_role: stringOrNull(item.source_role),
    source_family_id: stringOrNull(item.source_family_id),
    authority_id: stringOrNull(item.authority_id),
    publisher: { id: stringOrNull(publisher.id), name: stringOrNull(publisher.name) },
    excerpt: stringOrNull(item.excerpt) || '',
    published_at: stringOrNull(item.published_at),
    updated_at: stringOrNull(item.updated_at),
    retrieved_at: stringOrNull(item.retrieved_at),
    content_hash: stringOrNull(item.content_hash),
    revision_id: stringOrNull(item.revision_id),
    verification_status: stringOrNull(item.verification_status) || 'qualified',
    section_keys: stringArray(item.section_keys),
    claim_links: claimLinks,
  };
}

export function parseCoreEvidenceTrailer(raw: string): ParsedCoreEvidence {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  const token = `\n${ASTERA_EVIDENCE_MARKER}\n`;
  const markerIndex = normalized.lastIndexOf(token);
  if (markerIndex < 0) {
    return { main8: normalized, schema_version: null, sources: [], section_source_ids: {}, claim_source_ids: {} };
  }
  const main8 = normalized.slice(0, markerIndex).trim();
  const payloadText = normalized.slice(markerIndex + token.length).trim();
  let payload: unknown;
  try { payload = JSON.parse(payloadText); } catch { throw contractError('Evidence trailer JSON could not be parsed.'); }
  const root = record(payload);
  if (root.schema_version !== 'astera.evidence-citation.v1') throw contractError('Unsupported Astera evidence schema version.');
  const sources = Array.isArray(root.sources) ? root.sources.map(parseSource) : [];
  const sourceIds = new Set(sources.map((source) => source.id));
  if (Number(root.source_count) !== sources.length) throw contractError('Evidence source_count does not match sources.');
  const sectionIdsRaw = record(root.section_source_ids);
  const section_source_ids: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(sectionIdsRaw)) {
    const ids = stringArray(value);
    if (ids.some((id) => !sourceIds.has(id))) throw contractError(`Section ${key} references an unknown evidence id.`);
    section_source_ids[key] = ids;
  }
  const claimIdsRaw = record(root.claim_source_ids);
  const claim_source_ids: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(claimIdsRaw)) {
    const ids = stringArray(value);
    if (ids.some((id) => !sourceIds.has(id))) throw contractError(`Claim ${key} references an unknown evidence id.`);
    claim_source_ids[key] = ids;
  }
  return { main8, schema_version: 'astera.evidence-citation.v1', sources, section_source_ids, claim_source_ids };
}
