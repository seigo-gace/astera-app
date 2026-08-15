-- Persist every non-private terminal Job into the Account/Tenant-owned D1 Result store.
-- This trigger runs inside the same D1 transaction as the app_jobs settlement update.
CREATE TRIGGER IF NOT EXISTS app_jobs_persist_result_after_update
AFTER UPDATE OF state, result_payload ON app_jobs
WHEN NEW.private_mode = 0
 AND NEW.state IN ('completed','partially_completed')
 AND NEW.result_payload IS NOT NULL
 AND (OLD.state NOT IN ('completed','partially_completed') OR OLD.result_payload IS NULL)
BEGIN
  SELECT CASE WHEN json_valid(NEW.result_payload) = 0
    THEN RAISE(ABORT, 'ASTERA_RESULT_JSON_INVALID') END;
  SELECT CASE WHEN json_type(NEW.result_payload, '$.sections') <> 'array'
    THEN RAISE(ABORT, 'ASTERA_RESULT_SECTIONS_INVALID') END;
  SELECT CASE WHEN json_type(NEW.result_payload, '$.sources') <> 'array'
    THEN RAISE(ABORT, 'ASTERA_RESULT_SOURCES_INVALID') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.result_payload, '$.sources')
    WHERE length(trim(COALESCE(json_extract(value, '$.id'), ''))) = 0
       OR length(trim(COALESCE(json_extract(value, '$.url'), ''))) = 0
       OR length(trim(COALESCE(json_extract(value, '$.title'), ''))) = 0
       OR length(trim(COALESCE(json_extract(value, '$.retrievedAt'), ''))) = 0
       OR COALESCE(json_extract(value, '$.status'), '') NOT IN ('verified','unverified','unavailable')
  ) THEN RAISE(ABORT, 'ASTERA_SOURCE_REFERENCE_INVALID') END;
  SELECT CASE WHEN (
    SELECT COUNT(DISTINCT json_extract(value, '$.key'))
    FROM json_each(NEW.result_payload, '$.sections')
    WHERE json_extract(value, '$.key') IN (
      'true_purpose','missing_assumptions','fact_check','risk_detection',
      'counter_view','alternatives','recommendation','next_prompt'
    )
    AND length(trim(COALESCE(json_extract(value, '$.body'), ''))) > 0
  ) <> 8 THEN RAISE(ABORT, 'ASTERA_RESPONSE_SECTIONS_INCOMPLETE') END;

  INSERT OR IGNORE INTO results
    (id, tenant_id, project_id, job_id, title, created_by_user_id, purpose, private_mode,
     schema_version, runtime_version, purpose_version, completion_state, current_revision,
     created_at, updated_at)
  VALUES
    ('result:' || NEW.id, NEW.tenant_id, NEW.project_id, NEW.id,
     'Astera Result',
     NEW.user_id, NEW.purpose, 0,
     COALESCE(json_extract(NEW.result_payload, '$.schema_version'), 'astera-result-v1'),
     COALESCE(json_extract(NEW.result_payload, '$.runtime_version'), 'unknown'),
     COALESCE(json_extract(NEW.result_payload, '$.purpose_version'), 'unknown'),
     CASE WHEN NEW.state = 'partially_completed' THEN 'partial' ELSE 'complete' END,
     1, COALESCE(NEW.completed_at, NEW.updated_at), NEW.updated_at);

  INSERT OR IGNORE INTO result_revisions
    (id, result_id, tenant_id, revision_number, parent_revision_id, editor_user_id, revision_kind, created_at)
  VALUES
    ('revision:' || NEW.id || ':1', 'result:' || NEW.id, NEW.tenant_id, 1, NULL, NEW.user_id, 'generated', COALESCE(NEW.completed_at, NEW.updated_at));

  INSERT OR IGNORE INTO result_sections
    (revision_id, tenant_id, section_key, title, content, source_ids_json)
  SELECT
    'revision:' || NEW.id || ':1', NEW.tenant_id,
    json_extract(value, '$.key'),
    COALESCE(NULLIF(trim(json_extract(value, '$.title')), ''), json_extract(value, '$.key')),
    trim(json_extract(value, '$.body')),
    COALESCE(json_extract(value, '$.sourceIds'), '[]')
  FROM json_each(NEW.result_payload, '$.sections')
  WHERE json_extract(value, '$.key') IN (
    'true_purpose','missing_assumptions','fact_check','risk_detection',
    'counter_view','alternatives','recommendation','next_prompt'
  );

  INSERT OR IGNORE INTO source_references
    (result_id, tenant_id, source_id, display_number, source_url, title, retrieved_at, verification_status)
  SELECT
    'result:' || NEW.id, NEW.tenant_id,
    trim(json_extract(value, '$.id')), CAST(key AS INTEGER) + 1,
    trim(json_extract(value, '$.url')), trim(json_extract(value, '$.title')),
    trim(json_extract(value, '$.retrievedAt')), json_extract(value, '$.status')
  FROM json_each(NEW.result_payload, '$.sources');
END;
