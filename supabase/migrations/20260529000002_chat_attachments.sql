-- O.1.1 — Anexos no chat

CREATE TABLE IF NOT EXISTS chat_attachments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid,
  message_id     uuid,
  company_id     text        NOT NULL,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name      text        NOT NULL,
  file_type      text        NOT NULL,   -- 'image' | 'text' | 'pdf' | 'csv' | 'other'
  mime_type      text        NOT NULL,
  size_bytes     bigint      NOT NULL,
  storage_path   text        NOT NULL,
  extracted_text text,                  -- conteúdo extraído para injeção no contexto
  metadata       jsonb       NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE INDEX IF NOT EXISTS chat_attachments_session_idx    ON chat_attachments (session_id);
CREATE INDEX IF NOT EXISTS chat_attachments_message_idx    ON chat_attachments (message_id);
CREATE INDEX IF NOT EXISTS chat_attachments_user_idx       ON chat_attachments (user_id);
CREATE INDEX IF NOT EXISTS chat_attachments_company_idx    ON chat_attachments (company_id);

ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;

-- Usuário acessa apenas anexos da sua empresa e com acesso permitido
CREATE POLICY "chat_attachments_select_own"
  ON chat_attachments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "chat_attachments_insert_own"
  ON chat_attachments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Soft-delete: apenas o dono pode marcar como deletado
CREATE POLICY "chat_attachments_update_own"
  ON chat_attachments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
