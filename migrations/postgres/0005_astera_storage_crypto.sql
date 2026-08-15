-- Astera managed Storage encryption metadata.
-- Raw object DEKs must never be stored in PostgreSQL. The DEK is wrapped by Libral-Vault.

ALTER TABLE astera_storage_objects
  ADD COLUMN dek_wrap_ciphertext text,
  ADD COLUMN dek_wrap_iv text,
  ADD COLUMN content_iv_base64 text,
  ADD COLUMN auth_tag_base64 text,
  ADD COLUMN encrypted_at timestamptz;

ALTER TABLE astera_storage_objects
  ADD CONSTRAINT astera_storage_encryption_profile_check
    CHECK (encryption_profile IS NULL OR encryption_profile = 'AES-256-GCM'),
  ADD CONSTRAINT astera_storage_encryption_metadata_check
    CHECK (
      (encryption_profile IS NULL
        AND dek_wrap_ciphertext IS NULL
        AND dek_wrap_iv IS NULL
        AND content_iv_base64 IS NULL
        AND auth_tag_base64 IS NULL
        AND encrypted_at IS NULL)
      OR
      (encryption_profile = 'AES-256-GCM'
        AND dek_wrap_ciphertext IS NOT NULL
        AND dek_wrap_iv IS NOT NULL
        AND content_iv_base64 IS NOT NULL
        AND encrypted_at IS NOT NULL)
    );
