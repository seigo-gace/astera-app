-- Account/Tenant-owned D1 is the authority for Project membership.
-- Reject Project-bound Jobs before credit reservation/runtime dispatch can commit.
CREATE TRIGGER IF NOT EXISTS app_jobs_project_write_access_before_insert
BEFORE INSERT ON app_jobs
WHEN NEW.project_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM projects p
    JOIN project_members pm
      ON pm.project_id = p.id
     AND pm.tenant_id = p.tenant_id
    WHERE p.id = NEW.project_id
      AND p.tenant_id = NEW.tenant_id
      AND p.archived_at IS NULL
      AND pm.user_id = NEW.user_id
      AND pm.role IN ('owner','editor')
  ) THEN RAISE(ABORT, 'PROJECT_WRITE_PERMISSION_REQUIRED') END;
END;
