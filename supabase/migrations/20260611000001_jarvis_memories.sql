-- ─── Memória evolutiva do Jarvis (escopo POR EMPRESA) ───────────────────────
-- Camada de memória RAG: fatos/aprendizados destilados das conversas, isolados
-- por empresa. NÃO é fine-tuning — é conhecimento acumulado buscável por embedding.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS jarvis_memories (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        text         NOT NULL,
  content           text         NOT NULL,
  kind              text         NOT NULL DEFAULT 'fact'
                    CHECK (kind IN ('fact','preference','process','entity')),
  embedding         vector(1536),
  source_session_id uuid         REFERENCES sessions(id) ON DELETE SET NULL,
  created_by        uuid         REFERENCES auth.users   ON DELETE SET NULL,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jarvis_memories_company_id_idx
  ON jarvis_memories (company_id);

-- Índice HNSW para busca semântica
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'jarvis_memories'
      AND indexname = 'jarvis_memories_embedding_hnsw_idx'
  ) THEN
    EXECUTE 'CREATE INDEX jarvis_memories_embedding_hnsw_idx
      ON jarvis_memories USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE jarvis_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jarvis_memories: read" ON jarvis_memories;

-- Leitura: membro ativo da empresa ou admin global. Escrita/edição/remoção:
-- apenas via service role (backend) — nenhuma policy de write para clientes.
CREATE POLICY "jarvis_memories: read" ON jarvis_memories
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_members.company_id::text = jarvis_memories.company_id
        AND company_members.user_id          = auth.uid()
        AND company_members.status           = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id   = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- ─── Função de busca semântica ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_jarvis_memories(
  query_embedding vector(1536),
  filter_company  text,
  match_count     int   DEFAULT 5,
  min_similarity  float DEFAULT 0.3
)
RETURNS TABLE (
  id         uuid,
  content    text,
  kind       text,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT
    jm.id,
    jm.content,
    jm.kind,
    1 - (jm.embedding <=> query_embedding) AS similarity
  FROM jarvis_memories jm
  WHERE
    jm.embedding IS NOT NULL
    AND jm.company_id = filter_company
    AND 1 - (jm.embedding <=> query_embedding) >= min_similarity
  ORDER BY jm.embedding <=> query_embedding
  LIMIT match_count;
$$;
