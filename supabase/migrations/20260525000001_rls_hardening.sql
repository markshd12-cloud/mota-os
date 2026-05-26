-- ═════════════════════════════════════════════════════════════════════════════
-- RLS Hardening — Fase B da auditoria de segurança (2026-05-25)
--
-- Contexto: várias tabelas foram criadas em 20260508000000_init.sql com a
-- policy `for all to authenticated using (true) with check (true)`. Isso dá
-- acesso total (leitura E escrita) a qualquer JWT autenticado, inclusive via
-- chamada direta à REST API do Supabase.
--
-- Como TODAS as rotas de API do app passam pelo createAdminClient() (que
-- bypassa RLS via service_role), este hardening NÃO quebra a aplicação —
-- apenas fecha o flanco de acesso direto via anon/user JWT.
--
-- Estratégia:
--   • api_connections      → admin-only (armazena segredos de integração)
--   • projects, tasks      → membros da company (via company_members) + admin
--   • sources, source_files,
--     knowledge_chunks     → membros da company (via FK sources) + admin
--   • companies, agents,
--     agent_model_configs,
--     skills, schedules    → leitura autenticada / escrita admin-only
--
-- Idempotente: pode ser re-executado.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── Helpers ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.user_in_company(target_company text)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM company_members
    WHERE user_id    = auth.uid()
      AND company_id = target_company
      AND status     = 'active'
  );
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. api_connections — CRÍTICO (armazena segredos de integração no jsonb config)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access"   ON api_connections;
DROP POLICY IF EXISTS "api_connections: team all"   ON api_connections;
DROP POLICY IF EXISTS "api_connections: admin all"  ON api_connections;

CREATE POLICY "api_connections: admin all" ON api_connections
  FOR ALL TO authenticated
  USING      (public.is_admin())
  WITH CHECK (public.is_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. projects — scope por company_members + admin
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON projects;
DROP POLICY IF EXISTS "projects: team all"        ON projects;
DROP POLICY IF EXISTS "projects: member or admin" ON projects;

CREATE POLICY "projects: member or admin" ON projects
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR public.user_in_company(company_id::text)
  )
  WITH CHECK (
    public.is_admin()
    OR public.user_in_company(company_id::text)
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. tasks — scope via projects.company_id + admin
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON tasks;
DROP POLICY IF EXISTS "tasks: team all"           ON tasks;
DROP POLICY IF EXISTS "tasks: member or admin"    ON tasks;

CREATE POLICY "tasks: member or admin" ON tasks
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR assignee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = tasks.project_id
        AND public.user_in_company(p.company_id::text)
    )
  )
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = tasks.project_id
        AND public.user_in_company(p.company_id::text)
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. sources — scope por company_members + admin
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON sources;
DROP POLICY IF EXISTS "sources: team all"         ON sources;
DROP POLICY IF EXISTS "sources: member or admin"  ON sources;

CREATE POLICY "sources: member or admin" ON sources
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR public.user_in_company(company_id::text)
  )
  WITH CHECK (
    public.is_admin()
    OR public.user_in_company(company_id::text)
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. source_files — scope via sources.company_id + admin
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access"    ON source_files;
DROP POLICY IF EXISTS "source_files: team all"       ON source_files;
DROP POLICY IF EXISTS "source_files: member or admin" ON source_files;

CREATE POLICY "source_files: member or admin" ON source_files
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM sources s
      WHERE s.id = source_files.source_id
        AND public.user_in_company(s.company_id::text)
    )
  )
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM sources s
      WHERE s.id = source_files.source_id
        AND public.user_in_company(s.company_id::text)
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. knowledge_chunks — scope via sources.company_id + admin
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access"      ON knowledge_chunks;
DROP POLICY IF EXISTS "knowledge_chunks: team all"     ON knowledge_chunks;
DROP POLICY IF EXISTS "knowledge_chunks: member or admin" ON knowledge_chunks;

CREATE POLICY "knowledge_chunks: member or admin" ON knowledge_chunks
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM sources s
      WHERE s.id = knowledge_chunks.source_id
        AND public.user_in_company(s.company_id::text)
    )
  )
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM sources s
      WHERE s.id = knowledge_chunks.source_id
        AND public.user_in_company(s.company_id::text)
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. companies — read autenticado / write admin-only
--    (Lista de empresas pode ser visível; criação/edição só admin.)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON companies;
DROP POLICY IF EXISTS "companies: team read"      ON companies;
DROP POLICY IF EXISTS "companies: team write"     ON companies;
DROP POLICY IF EXISTS "companies: auth read"      ON companies;
DROP POLICY IF EXISTS "companies: admin write"    ON companies;

CREATE POLICY "companies: auth read" ON companies
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "companies: admin write" ON companies
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "companies: admin update" ON companies
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "companies: admin delete" ON companies
  FOR DELETE TO authenticated USING (public.is_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. agents — catálogo global; read autenticado / write admin-only
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON agents;
DROP POLICY IF EXISTS "agents: team read"         ON agents;
DROP POLICY IF EXISTS "agents: team write"        ON agents;
DROP POLICY IF EXISTS "agents: auth read"         ON agents;
DROP POLICY IF EXISTS "agents: admin write"       ON agents;

CREATE POLICY "agents: auth read" ON agents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agents: admin write" ON agents
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "agents: admin update" ON agents
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "agents: admin delete" ON agents
  FOR DELETE TO authenticated USING (public.is_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. agent_model_configs — read autenticado / write admin-only
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access"   ON agent_model_configs;
DROP POLICY IF EXISTS "agent_model_configs: team all" ON agent_model_configs;
DROP POLICY IF EXISTS "agent_model_configs: auth read" ON agent_model_configs;
DROP POLICY IF EXISTS "agent_model_configs: admin write" ON agent_model_configs;

CREATE POLICY "agent_model_configs: auth read" ON agent_model_configs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agent_model_configs: admin write" ON agent_model_configs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "agent_model_configs: admin update" ON agent_model_configs
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "agent_model_configs: admin delete" ON agent_model_configs
  FOR DELETE TO authenticated USING (public.is_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. skills — catálogo global; read autenticado / write admin-only
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON skills;
DROP POLICY IF EXISTS "skills: team all"          ON skills;
DROP POLICY IF EXISTS "skills: auth read"         ON skills;
DROP POLICY IF EXISTS "skills: admin write"       ON skills;

CREATE POLICY "skills: auth read" ON skills
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "skills: admin write" ON skills
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "skills: admin update" ON skills
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "skills: admin delete" ON skills
  FOR DELETE TO authenticated USING (public.is_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 11. schedules — read autenticado / write admin-only
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON schedules;
DROP POLICY IF EXISTS "schedules: team all"       ON schedules;
DROP POLICY IF EXISTS "schedules: auth read"      ON schedules;
DROP POLICY IF EXISTS "schedules: admin write"    ON schedules;

CREATE POLICY "schedules: auth read" ON schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "schedules: admin write" ON schedules
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "schedules: admin update" ON schedules
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "schedules: admin delete" ON schedules
  FOR DELETE TO authenticated USING (public.is_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- 12. Auditoria pós-aplicação (queries para rodar manualmente no Studio)
-- ═════════════════════════════════════════════════════════════════════════════

-- Listar todas as policies ativas + tabela:
-- SELECT schemaname, tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- Listar tabelas ainda com policy permissiva (using = 'true'):
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND (qual = 'true' OR with_check = 'true');

-- Listar tabelas com RLS desabilitado:
-- SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS rls_enabled
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
