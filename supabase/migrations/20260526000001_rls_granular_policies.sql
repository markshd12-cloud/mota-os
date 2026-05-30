-- ─── VULN-02 Fix: Políticas RLS Granulares ────────────────────────────────────
-- Substitui as políticas permissivas "authenticated full access" (USING true)
-- por políticas que isolam dados por usuário e empresa.
--
-- Modelo de acesso:
--   admin (profiles.role = 'admin') → acessa tudo via service_role + policies
--   usuário comum                   → acessa apenas dados da(s) sua(s) empresa(s)
--   anônimo                         → bloqueado (RLS bloqueia sem JWT autenticado)
--
-- IMPORTANTE: A aplicação usa createAdminClient() (service_role) server-side,
-- que bypassa RLS por design. Estas políticas protegem acesso direto à API REST
-- do Supabase com a anon key (ex: chamadas client-side, vazamento de chave).

-- ═════════════════════════════════════════════════════════════════════════════
-- HELPERS — funções de verificação reutilizadas nas policies
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_global_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  )
$$;

-- Retorna true se o usuário autenticado tem acesso à empresa informada
CREATE OR REPLACE FUNCTION public.can_access_company(cid text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM company_members
      WHERE user_id   = auth.uid()
        AND company_id::text = cid
        AND status    = 'active'
    )
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- profiles
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON profiles;
DROP POLICY IF EXISTS "profiles: read own or admin" ON profiles;
DROP POLICY IF EXISTS "profiles: write own" ON profiles;

CREATE POLICY "profiles: read own or admin" ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_global_admin());

-- Usuário só atualiza o próprio perfil; criação é feita via trigger/service_role
CREATE POLICY "profiles: update own" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));

-- ═════════════════════════════════════════════════════════════════════════════
-- companies (dados de referência pública — leitura livre, escrita admin)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON companies;
DROP POLICY IF EXISTS "companies: authenticated read" ON companies;
DROP POLICY IF EXISTS "companies: admin write" ON companies;

CREATE POLICY "companies: authenticated read" ON companies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "companies: admin write" ON companies
  FOR ALL TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- agents (dados de referência — leitura livre para auth, escrita admin)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON agents;
DROP POLICY IF EXISTS "agents: authenticated read" ON agents;
DROP POLICY IF EXISTS "agents: admin write" ON agents;
DROP POLICY IF EXISTS "agents: admin update delete" ON agents;

CREATE POLICY "agents: authenticated read" ON agents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agents: admin write" ON agents
  FOR ALL TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- agent_model_configs (leitura livre para auth — necessário para o chat)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON agent_model_configs;
DROP POLICY IF EXISTS "agent_model_configs: authenticated read" ON agent_model_configs;
DROP POLICY IF EXISTS "agent_model_configs: admin write" ON agent_model_configs;

CREATE POLICY "agent_model_configs: authenticated read" ON agent_model_configs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "agent_model_configs: admin write" ON agent_model_configs
  FOR ALL TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- agent_runs
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON agent_runs;
DROP POLICY IF EXISTS "agent_runs: own or admin" ON agent_runs;
DROP POLICY IF EXISTS "agent_runs: insert own" ON agent_runs;

CREATE POLICY "agent_runs: own or admin" ON agent_runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_global_admin());

CREATE POLICY "agent_runs: insert own" ON agent_runs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ═════════════════════════════════════════════════════════════════════════════
-- sessions
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON sessions;
DROP POLICY IF EXISTS "sessions: own or admin" ON sessions;
DROP POLICY IF EXISTS "sessions: write own" ON sessions;

CREATE POLICY "sessions: read own or admin" ON sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_global_admin());

CREATE POLICY "sessions: write own" ON sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "sessions: update own" ON sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_global_admin());

CREATE POLICY "sessions: delete own" ON sessions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- messages (acesso via posse da sessão)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON messages;
DROP POLICY IF EXISTS "messages: via session owner or admin" ON messages;
DROP POLICY IF EXISTS "messages: insert via own session" ON messages;

CREATE POLICY "messages: read via session" ON messages
  FOR SELECT TO authenticated
  USING (
    public.is_global_admin()
    OR EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = messages.session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "messages: insert via session" ON messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_global_admin()
    OR EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = messages.session_id
        AND sessions.user_id = auth.uid()
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- projects
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON projects;
DROP POLICY IF EXISTS "projects: company or admin" ON projects;
DROP POLICY IF EXISTS "projects: write company or admin" ON projects;

CREATE POLICY "projects: read by company" ON projects
  FOR SELECT TO authenticated
  USING (public.is_global_admin() OR public.can_access_company(company_id::text));

CREATE POLICY "projects: write by company" ON projects
  FOR ALL TO authenticated
  USING (public.is_global_admin() OR public.can_access_company(company_id::text))
  WITH CHECK (public.is_global_admin() OR public.can_access_company(company_id::text));

-- ═════════════════════════════════════════════════════════════════════════════
-- tasks (acesso via projeto ou responsável)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON tasks;
DROP POLICY IF EXISTS "tasks: via project company or admin" ON tasks;
DROP POLICY IF EXISTS "tasks: write via project or admin" ON tasks;

CREATE POLICY "tasks: read by project company or assignee" ON tasks
  FOR SELECT TO authenticated
  USING (
    public.is_global_admin()
    OR assignee_id = auth.uid()
    OR (
      project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM projects
        WHERE projects.id = tasks.project_id
          AND public.can_access_company(projects.company_id::text)
      )
    )
  );

CREATE POLICY "tasks: write by project company" ON tasks
  FOR ALL TO authenticated
  USING (
    public.is_global_admin()
    OR assignee_id = auth.uid()
    OR (
      project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM projects
        WHERE projects.id = tasks.project_id
          AND public.can_access_company(projects.company_id::text)
      )
    )
  )
  WITH CHECK (
    public.is_global_admin()
    OR (
      project_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM projects
        WHERE projects.id = tasks.project_id
          AND public.can_access_company(projects.company_id::text)
      )
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- sources (legado)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON sources;
DROP POLICY IF EXISTS "sources: company or admin" ON sources;
DROP POLICY IF EXISTS "sources: write company or admin" ON sources;

CREATE POLICY "sources: read by company" ON sources
  FOR SELECT TO authenticated
  USING (public.is_global_admin() OR public.can_access_company(company_id::text));

CREATE POLICY "sources: write by company" ON sources
  FOR ALL TO authenticated
  USING (public.is_global_admin() OR public.can_access_company(company_id::text))
  WITH CHECK (public.is_global_admin() OR public.can_access_company(company_id::text));

-- ═════════════════════════════════════════════════════════════════════════════
-- source_files (acesso via sources)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON source_files;
DROP POLICY IF EXISTS "source_files: via source company or admin" ON source_files;
DROP POLICY IF EXISTS "source_files: write via source or admin" ON source_files;

CREATE POLICY "source_files: read via source" ON source_files
  FOR SELECT TO authenticated
  USING (
    public.is_global_admin()
    OR EXISTS (
      SELECT 1 FROM sources
      WHERE sources.id = source_files.source_id
        AND public.can_access_company(sources.company_id::text)
    )
  );

CREATE POLICY "source_files: write via source" ON source_files
  FOR ALL TO authenticated
  USING (
    public.is_global_admin()
    OR EXISTS (
      SELECT 1 FROM sources
      WHERE sources.id = source_files.source_id
        AND public.can_access_company(sources.company_id::text)
    )
  )
  WITH CHECK (
    public.is_global_admin()
    OR EXISTS (
      SELECT 1 FROM sources
      WHERE sources.id = source_files.source_id
        AND public.can_access_company(sources.company_id::text)
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- knowledge_chunks
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON knowledge_chunks;
DROP POLICY IF EXISTS "knowledge_chunks: company or admin" ON knowledge_chunks;
DROP POLICY IF EXISTS "knowledge_chunks: write company or admin" ON knowledge_chunks;

CREATE POLICY "knowledge_chunks: read by company" ON knowledge_chunks
  FOR SELECT TO authenticated
  USING (
    public.is_global_admin()
    OR company_id IS NULL
    OR public.can_access_company(company_id)
  );

CREATE POLICY "knowledge_chunks: write by company" ON knowledge_chunks
  FOR ALL TO authenticated
  USING (public.is_global_admin() OR public.can_access_company(company_id))
  WITH CHECK (public.is_global_admin() OR public.can_access_company(company_id));

-- ═════════════════════════════════════════════════════════════════════════════
-- workflows
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON workflows;
DROP POLICY IF EXISTS "workflows: company or admin" ON workflows;
DROP POLICY IF EXISTS "workflows: write admin" ON workflows;
-- Limpa políticas de migrations anteriores que podem existir
DROP POLICY IF EXISTS "workflows_read_by_company" ON workflows;
DROP POLICY IF EXISTS "workflows_write_by_company" ON workflows;

CREATE POLICY "workflows: read by company" ON workflows
  FOR SELECT TO authenticated
  USING (
    public.is_global_admin()
    OR company_id IS NULL
    OR public.can_access_company(company_id::text)
  );

CREATE POLICY "workflows: write admin" ON workflows
  FOR ALL TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- workflow_runs
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON workflow_runs;
DROP POLICY IF EXISTS "workflow_runs: own or admin" ON workflow_runs;
DROP POLICY IF EXISTS "workflow_runs: insert own" ON workflow_runs;
DROP POLICY IF EXISTS "workflow_runs: update own" ON workflow_runs;

CREATE POLICY "workflow_runs: read own or admin" ON workflow_runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_global_admin());

CREATE POLICY "workflow_runs: insert own" ON workflow_runs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_global_admin());

CREATE POLICY "workflow_runs: update own" ON workflow_runs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- skills (dados de referência)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON skills;
DROP POLICY IF EXISTS "skills: authenticated read" ON skills;
DROP POLICY IF EXISTS "skills: admin write" ON skills;

CREATE POLICY "skills: authenticated read" ON skills
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "skills: admin write" ON skills
  FOR ALL TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- schedules (admin only)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON schedules;
DROP POLICY IF EXISTS "schedules: admin only" ON schedules;

CREATE POLICY "schedules: admin only" ON schedules
  FOR ALL TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- watchers
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON watchers;
DROP POLICY IF EXISTS "watchers: company or admin" ON watchers;
DROP POLICY IF EXISTS "watchers: admin write" ON watchers;
-- Limpa políticas de migrations anteriores
DROP POLICY IF EXISTS "watchers_read_policy" ON watchers;
DROP POLICY IF EXISTS "watchers_write_policy" ON watchers;

-- Watchers são recursos administrativos — leitura para auth, escrita para admin
CREATE POLICY "watchers: authenticated read" ON watchers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "watchers: admin write" ON watchers
  FOR ALL TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- api_connections (credenciais externas — admin only)
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON api_connections;
DROP POLICY IF EXISTS "api_connections: admin only" ON api_connections;

CREATE POLICY "api_connections: admin only" ON api_connections
  FOR ALL TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- activity_logs
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs: own or admin" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs: insert own or system" ON activity_logs;

CREATE POLICY "activity_logs: read own or admin" ON activity_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_global_admin());

CREATE POLICY "activity_logs: insert" ON activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid() OR public.is_global_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- announcements — fix: separar read (livre) de write (admin only)
-- ═════════════════════════════════════════════════════════════════════════════

-- Remove a política antiga que permite qualquer auth'd escrever
DROP POLICY IF EXISTS "announcements: admin write" ON announcements;

CREATE POLICY "announcements: admin write" ON announcements
  FOR ALL TO authenticated
  USING (public.is_global_admin())
  WITH CHECK (public.is_global_admin());