import type { D1Database } from './_account-projection';
import { MAX_PURPOSE_TEXT_CHARACTERS } from './_purpose-text';
import { getResult, ResultStoreError } from './_result-store';

export type ConversationActor = { userId: string; tenantId: string };

type ConversationRow = {
  id: string;
  project_id: string | null;
  title: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
type TurnRow = {
  id: string;
  conversation_id: string;
  job_id: string;
  prompt: string;
  purpose: string;
  purpose_text: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  job_state: string;
  error_code: string | null;
  error_message: string | null;
};
type JobRow = { id: string; private_mode: number; project_id: string | null; state: string; purpose: string; purpose_text: string | null };

export class ConversationStoreError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = 'ConversationStoreError';
  }
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function nullableText(value: unknown): string | null { return text(value) || null; }
function titleFromPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  return oneLine.slice(0, 80) || 'Astera Chat';
}

async function ownedConversation(db: D1Database, actor: ConversationActor, id: string): Promise<ConversationRow> {
  const row = await db.prepare(`SELECT id,project_id,title,archived_at,created_at,updated_at
    FROM chat_conversations WHERE id=?1 AND tenant_id=?2 AND user_id=?3 LIMIT 1`)
    .bind(id, actor.tenantId, actor.userId).first<ConversationRow>();
  if (!row) throw new ConversationStoreError(404, 'CONVERSATION_NOT_FOUND', 'Conversationが見つかりません。');
  return row;
}

async function ownedNormalJob(db: D1Database, actor: ConversationActor, jobId: string): Promise<JobRow> {
  const row = await db.prepare(`SELECT id,private_mode,project_id,state,purpose,purpose_text FROM app_jobs
    WHERE id=?1 AND tenant_id=?2 AND user_id=?3 LIMIT 1`)
    .bind(jobId, actor.tenantId, actor.userId).first<JobRow>();
  if (!row) throw new ConversationStoreError(404, 'CONVERSATION_JOB_NOT_FOUND', 'Conversationへ関連付けるJobを確認できません。');
  if (Boolean(row.private_mode)) throw new ConversationStoreError(409, 'PRIVATE_JOB_CONVERSATION_FORBIDDEN', 'Private Mode JobはConversationへ保存できません。');
  return row;
}

export async function appendConversationTurn(
  db: D1Database,
  actor: ConversationActor,
  value: unknown,
): Promise<Record<string, unknown>> {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const clientTurnId = text(body.client_turn_id ?? body.clientTurnId);
  const conversationIdInput = text(body.conversation_id ?? body.conversationId);
  const jobId = text(body.job_id ?? body.jobId);
  const prompt = text(body.prompt);
  const purpose = text(body.purpose);
  const purposeText = nullableText(body.purpose_text ?? body.purposeText);
  if (!clientTurnId) throw new ConversationStoreError(422, 'CONVERSATION_TURN_ID_REQUIRED', 'client_turn_idが必要です。');
  if (!jobId) throw new ConversationStoreError(422, 'CONVERSATION_JOB_ID_REQUIRED', 'job_idが必要です。');
  if (!prompt) throw new ConversationStoreError(422, 'CONVERSATION_PROMPT_REQUIRED', 'Prompt本文が必要です。');
  if (!['auto','review','compare','verify','improve','research','plan','consider'].includes(purpose)) {
    throw new ConversationStoreError(422, 'CONVERSATION_PURPOSE_INVALID', 'Purposeが不正です。');
  }
  if (purposeText && [...purposeText].length > MAX_PURPOSE_TEXT_CHARACTERS) {
    throw new ConversationStoreError(413, 'CONVERSATION_PURPOSE_TEXT_TOO_LARGE', `自由入力の目的は${MAX_PURPOSE_TEXT_CHARACTERS.toLocaleString()}文字以内です。`);
  }

  const job = await ownedNormalJob(db, actor, jobId);
  if (job.purpose !== purpose) throw new ConversationStoreError(409, 'CONVERSATION_PURPOSE_MISMATCH', 'JobとConversation TurnのPurposeが一致しません。');
  if ((job.purpose_text?.trim() || null) !== purposeText) {
    throw new ConversationStoreError(409, 'CONVERSATION_PURPOSE_TEXT_MISMATCH', 'JobとConversation Turnの自由目的が一致しません。');
  }
  const now = new Date().toISOString();
  let conversationId = conversationIdInput;

  // Resolve an existing client_turn_id before creating a new Conversation.
  // If the first response was lost after the D1 write succeeded, the frontend
  // retries the same turn with conversation_id=null. Reusing the existing
  // Conversation keeps the retry idempotent instead of creating a new orphan
  // Conversation and then failing on the turn ownership check.
  const existing = await db.prepare(`SELECT t.id,t.conversation_id,t.job_id,t.prompt,t.purpose,t.purpose_text,t.position,t.created_at,t.updated_at,
      j.state AS job_state,j.error_code,j.error_message
    FROM chat_turns t JOIN app_jobs j ON j.id=t.job_id
    WHERE t.id=?1 AND t.tenant_id=?2 AND t.user_id=?3 LIMIT 1`)
    .bind(clientTurnId, actor.tenantId, actor.userId).first<TurnRow>();

  if (existing) {
    if (existing.job_id !== jobId) {
      throw new ConversationStoreError(409, 'CONVERSATION_TURN_JOB_MISMATCH', '同じTurn IDが別Jobに使用されています。');
    }
    if (existing.conversation_id !== conversationIdInput && conversationIdInput) {
      throw new ConversationStoreError(409, 'CONVERSATION_TURN_OWNER_MISMATCH', 'Turnは別Conversationに属しています。');
    }
    conversationId = existing.conversation_id;
    const conversation = await ownedConversation(db, actor, conversationId);
    if (conversation.archived_at) throw new ConversationStoreError(409, 'CONVERSATION_ARCHIVED', 'Archived Conversationには投稿できません。');
    if (existing.prompt !== prompt || existing.purpose !== purpose || (existing.purpose_text?.trim() || null) !== purposeText) {
      throw new ConversationStoreError(409, 'CONVERSATION_TURN_PAYLOAD_MISMATCH', '同じTurn IDに異なる投稿内容が指定されています。');
    }
    await db.prepare(`UPDATE chat_turns SET updated_at=?1
      WHERE id=?2 AND conversation_id=?3 AND tenant_id=?4 AND user_id=?5`)
      .bind(now, clientTurnId, conversationId, actor.tenantId, actor.userId).run();
  } else if (conversationId) {
    const conversation = await ownedConversation(db, actor, conversationId);
    if (conversation.archived_at) throw new ConversationStoreError(409, 'CONVERSATION_ARCHIVED', 'Archived Conversationには投稿できません。');
  } else {
    conversationId = crypto.randomUUID();
    await db.prepare(`INSERT INTO chat_conversations(id,tenant_id,user_id,project_id,title,archived_at,created_at,updated_at)
      VALUES(?1,?2,?3,?4,?5,NULL,?6,?6)`)
      .bind(conversationId, actor.tenantId, actor.userId, job.project_id, titleFromPrompt(prompt), now).run();
  }

  if (!existing) {
    try {
      await db.prepare(`INSERT INTO chat_turns(id,conversation_id,tenant_id,user_id,job_id,prompt,purpose,purpose_text,position,created_at,updated_at)
        SELECT ?1,?2,?3,?4,?5,?6,?7,?8,COALESCE(MAX(position),0)+1,?9,?9
        FROM chat_turns WHERE conversation_id=?2`)
        .bind(clientTurnId, conversationId, actor.tenantId, actor.userId, jobId, prompt, purpose, purposeText, now).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|constraint/i.test(message)) {
        throw new ConversationStoreError(409, 'CONVERSATION_TURN_CONFLICT', '同じConversationへの同時投稿が競合しました。再試行してください。');
      }
      throw error;
    }
  }

  await db.prepare(`UPDATE chat_conversations SET project_id=COALESCE(?1,project_id),updated_at=?2
    WHERE id=?3 AND tenant_id=?4 AND user_id=?5`)
    .bind(job.project_id, now, conversationId, actor.tenantId, actor.userId).run();
  return { conversation_id: conversationId, turn_id: clientTurnId, job_id: jobId };
}

export async function listConversations(
  db: D1Database,
  actor: ConversationActor,
  limitRaw: number,
): Promise<Record<string, unknown>> {
  const limit = Number.isInteger(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 25;
  const rows = (await db.prepare(`SELECT id,project_id,title,archived_at,created_at,updated_at
    FROM chat_conversations
    WHERE tenant_id=?1 AND user_id=?2 AND archived_at IS NULL
    ORDER BY updated_at DESC,id DESC LIMIT ?3`)
    .bind(actor.tenantId, actor.userId, limit).all<ConversationRow>()).results ?? [];
  return {
    conversations: rows.map((row) => ({
      id: row.id,
      conversation_id: row.id,
      project_id: row.project_id,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    limit,
  };
}

export async function getConversation(
  db: D1Database,
  actor: ConversationActor,
  conversationId: string,
): Promise<Record<string, unknown>> {
  const conversation = await ownedConversation(db, actor, conversationId);
  const turns = (await db.prepare(`SELECT t.id,t.conversation_id,t.job_id,t.prompt,t.purpose,t.purpose_text,t.position,t.created_at,t.updated_at,
      j.state AS job_state,j.error_code,j.error_message
    FROM chat_turns t
    JOIN app_jobs j ON j.id=t.job_id AND j.tenant_id=t.tenant_id AND j.user_id=t.user_id
    WHERE t.conversation_id=?1 AND t.tenant_id=?2 AND t.user_id=?3
    ORDER BY t.position ASC`)
    .bind(conversationId, actor.tenantId, actor.userId).all<TurnRow>()).results ?? [];
  const hydrated: Record<string, unknown>[] = [];
  for (const turn of turns) {
    const resultRow = await db.prepare(`SELECT id FROM results WHERE job_id=?1 AND tenant_id=?2 AND deleted_at IS NULL LIMIT 1`)
      .bind(turn.job_id, actor.tenantId).first<{ id: string }>();
    let result: unknown = null;
    if (resultRow?.id) {
      try {
        result = (await getResult(db, actor, resultRow.id)).result ?? null;
      } catch (error) {
        if (!(error instanceof ResultStoreError && error.status === 404)) throw error;
      }
    }
    hydrated.push({
      id: turn.id,
      turn_id: turn.id,
      job_id: turn.job_id,
      prompt: turn.prompt,
      purpose: turn.purpose,
      purpose_text: turn.purpose_text,
      position: turn.position,
      job_state: turn.job_state,
      error: turn.error_code || turn.error_message
        ? { code: turn.error_code || 'JOB_FAILED', message: turn.error_message || 'Jobを完了できませんでした。' }
        : null,
      created_at: turn.created_at,
      updated_at: turn.updated_at,
      result,
    });
  }
  return {
    conversation: {
      id: conversation.id,
      conversation_id: conversation.id,
      project_id: conversation.project_id,
      title: conversation.title,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
      turns: hydrated,
    },
  };
}
