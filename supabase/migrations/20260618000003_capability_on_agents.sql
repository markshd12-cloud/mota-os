-- ═══════════════════════════════════════════════════════════════════════════════
-- Mota OS — Capability v1: `agents` como base física da Skill unificada
-- Migration: 20260618000003
--
-- Consolidação do HUB em 2 primitivos (Skill + Automação). Decisão de engenharia:
-- a "Skill" (capacidade) passa a viver sobre a infra MADURA de `agents`
-- (que já tem configs, vínculos de empresa, arquivos/RAG e auditoria), em vez de
-- reconstruir tudo na tabela fina `skills`. O chat NÃO muda — já lê `agents`.
--
-- Esta migration:
--   1. REVERTE a extensão experimental feita em `skills` (cópia paralela descartada).
--   2. ESTENDE `agents` com kind/steps/chat_enabled (aditivo, não-quebra).
--
-- NÃO migra workflows/skills para `agents` ainda — isso só acontece depois que o
-- filtro `chat_enabled` estiver no endpoint de listagem (senão linhas não-conversáveis
-- poluiriam o seletor de agentes em produção). Etapa separada.
--
-- Idempotente. Aditiva em `agents` (linhas existentes ganham kind='agent',
-- chat_enabled=true → comportamento inalterado).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Reverter extensão experimental em `skills` ───────────────────────────────
-- Remove as linhas que haviam sido copiadas de agents/workflows (mantém as skills
-- originais) e dropa as colunas v2 adicionadas. Guards tornam reexecutável.
DELETE FROM skills
  WHERE (source_agent_id IS NOT NULL) OR (source_workflow_id IS NOT NULL);

ALTER TABLE skills
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS chat_enabled,
  DROP COLUMN IF EXISTS slug,
  DROP COLUMN IF EXISTS model_id,
  DROP COLUMN IF EXISTS system_prompt,
  DROP COLUMN IF EXISTS temperature,
  DROP COLUMN IF EXISTS max_tokens,
  DROP COLUMN IF EXISTS steps,
  DROP COLUMN IF EXISTS companies,
  DROP COLUMN IF EXISTS source_agent_id,
  DROP COLUMN IF EXISTS source_workflow_id;

-- ─── 2. Estender `agents` como base da Skill unificada ───────────────────────────
ALTER TABLE agents
  -- Tipo da capacidade. Agentes atuais = 'agent' (conversáveis).
  ADD COLUMN IF NOT EXISTS kind               text    NOT NULL DEFAULT 'agent',
  -- Aparece no chat/seletor? Workflows e skills simples entrarão como false.
  ADD COLUMN IF NOT EXISTS chat_enabled       boolean NOT NULL DEFAULT true,
  -- Passos da capacidade multi-etapa (absorvido de workflows.steps).
  ADD COLUMN IF NOT EXISTS steps              jsonb   NOT NULL DEFAULT '[]',
  -- Rastro da futura migração skills/workflows → agents (backfill idempotente).
  ADD COLUMN IF NOT EXISTS source_skill_id    uuid,
  ADD COLUMN IF NOT EXISTS source_workflow_id uuid;

DO $$ BEGIN
  ALTER TABLE agents
    ADD CONSTRAINT agents_kind_check CHECK (kind IN ('agent', 'workflow', 'simple'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS agents_kind_idx ON agents (kind);
CREATE INDEX IF NOT EXISTS agents_source_skill_id_idx    ON agents (source_skill_id)    WHERE source_skill_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS agents_source_workflow_id_idx ON agents (source_workflow_id) WHERE source_workflow_id IS NOT NULL;
