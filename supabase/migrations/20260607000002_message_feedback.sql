-- Feedback do usuário em respostas do assistente.
-- NULL = sem feedback · 1 = positivo (👍) · -1 = negativo (👎)

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS feedback smallint;

ALTER TABLE messages
  ADD CONSTRAINT messages_feedback_check
  CHECK (feedback IS NULL OR feedback IN (-1, 1));

-- Índice parcial para análise de feedbacks dados (ignora a maioria NULL)
CREATE INDEX IF NOT EXISTS messages_feedback_idx
  ON messages (feedback)
  WHERE feedback IS NOT NULL;
