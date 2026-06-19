/**
 * Jarvis — canonical TypeScript types.
 *
 * Each interface maps 1-to-1 to a Supabase table (snake_case columns).
 * The mock data files use a subset of these fields with camelCase aliases;
 * when Supabase is connected, fetch functions should map the DB rows to these types.
 */

// ─── Primitives ─────────────────────────────────────────────────────────────

export type UUID           = string
export type ISODateString  = string
export type HexColor       = string  // "#rrggbb"

// ─── Domain enums ───────────────────────────────────────────────────────────

export type CompanySlug =
  | "cppem"
  | "unicive"
  | "colegio"
  | "everton"
  | "grupo"

export type UserRole         = "admin" | "editor" | "viewer"
export type AgentStatus      = "active" | "paused"
export type ProjectStatus    = "active" | "paused" | "completed" | "planning"
export type TaskStatus       = "backlog" | "todo" | "doing" | "waiting_approval" | "done"
export type TaskPriority     = "baixa" | "media" | "alta" | "urgente"
export type SourceType       = "documents" | "api" | "folder" | "drive" | "reports" | "knowledge" | "links"
export type WorkflowStatus   = "active" | "paused"
export type AutomationStatus = "active" | "paused"
export type MessageRole      = "user" | "assistant" | "system"
export type EmbeddingStatus  = "pending" | "processing" | "done" | "error"
export type WorkflowRunState = "pending" | "running" | "done" | "error"
export type MessageStatus    = "pending" | "streaming" | "done" | "error"
export type ApiProvider      = "anthropic" | "openai" | "google" | "meta" | "reportei" | "rocketchat" | "whatsapp" | "google_drive"
export type ApiConnStatus    = "connected" | "disconnected" | "error"
export type ScheduleFreq     = "daily" | "weekly" | "monthly" | "custom"
export type WatcherTrigger   = "threshold" | "absence" | "schedule" | "event"
export type LogEventType     = "chat" | "workflow" | "auto" | "source" | "watcher" | "auth" | "settings" | "api"

// ─── Message blocks ──────────────────────────────────────────────────────────

export type MessageBlockType = "text" | "card" | "checklist" | "actions" | "tags" | "divider"

export interface TextBlock      { type: "text";      content: string }
export interface DividerBlock   { type: "divider" }
export interface TagsBlock      { type: "tags";      items: string[] }
export interface CardBlock      { type: "card";      title: string; body: string }
export interface ChecklistBlock {
  type:  "checklist"
  title: string
  items: { id: string; label: string; done: boolean }[]
}
export interface ActionsBlock {
  type:    "actions"
  buttons: { label: string; variant: "primary" | "secondary" | "ghost"; action: string }[]
}

export type MessageBlock =
  | TextBlock
  | DividerBlock
  | TagsBlock
  | CardBlock
  | ChecklistBlock
  | ActionsBlock

// ─── Supabase table interfaces ───────────────────────────────────────────────

/** Table: profiles */
export interface UserProfile {
  id:                 UUID
  email:              string
  name:               string
  role:               UserRole
  job_title:          string
  default_company_id: CompanySlug
  avatar_url:         string | null
  created_at:         ISODateString
  updated_at:         ISODateString
}

/** Table: companies */
export interface Company {
  id:         UUID
  slug:       CompanySlug
  name:       string
  color:      HexColor
  initials:   string
  active:     boolean
  created_at: ISODateString
}

/** Table: agents */
export interface AgentRow {
  id:               UUID
  slug:             string
  name:             string
  short_name:       string
  description:      string
  long_description: string
  icon:             string
  color:            HexColor
  bg_color:         string
  capabilities:     string[]
  status:           AgentStatus
  model_id:         string       // e.g. "claude-sonnet-4-6"
  companies:        CompanySlug[]
  created_at:       ISODateString
  updated_at:       ISODateString
}

/** Table: agent_model_configs */
export interface AgentModelConfig {
  id:            UUID
  agent_id:      UUID
  provider:      ApiProvider
  model_id:      string
  max_tokens:    number
  temperature:   number
  system_prompt: string
  created_at:    ISODateString
  updated_at:    ISODateString
}

/** Table: agent_runs */
export interface AgentRun {
  id:            UUID
  agent_id:      UUID
  session_id:    UUID
  user_id:       UUID
  model_used:    string
  input_tokens:  number
  output_tokens: number
  cost_usd:      number
  duration_ms:   number
  created_at:    ISODateString
}

/** Table: sessions */
export interface SessionRow {
  id:               UUID
  title:            string
  user_id:          UUID
  agent_id:         UUID | null     // nullable: nova sessão antes de selecionar agente
  company_id:       CompanySlug
  pinned:           boolean
  archived:         boolean
  tags:             string[]
  message_count:    number
  last_message_at:  ISODateString
  created_at:       ISODateString
}

/** Table: messages */
export interface MessageRow {
  id:            UUID
  session_id:    UUID
  role:          MessageRole
  content:       string           // texto plano da mensagem
  blocks:        MessageBlock[] | null  // blocos estruturados (opcional, jsonb)
  agent_id:      UUID | null
  model_used:    string | null
  input_tokens:  number | null
  output_tokens: number | null
  status:        MessageStatus    // adicionado em 20260511000002
  error_message: string | null    // adicionado em 20260511000002
  created_at:    ISODateString
}

/** Table: projects */
export interface ProjectRow {
  id:              UUID
  title:           string
  description:     string
  company_id:      CompanySlug
  responsible_id:  UUID
  status:          ProjectStatus
  progress:        number        // 0–100
  budget:          number | null
  start_date:      ISODateString
  end_date:        ISODateString | null
  tags:            string[]
  highlights:      string[]
  sessions_count:  number
  tasks_open:      number
  tasks_total:     number
  created_at:      ISODateString
  updated_at:      ISODateString
}

/** Table: tasks */
export interface TaskRow {
  id:            UUID
  title:         string
  description:   string
  project_id:    UUID | null
  assignee_id:   UUID | null
  assignee_name: string | null
  company_id:    string | null
  status:        TaskStatus
  priority:      TaskPriority
  due_date:      ISODateString | null
  tags:          string[]
  position:      number
  archived:      boolean
  created_at:    ISODateString
  updated_at:    ISODateString
}

/** Table: sources */
export interface SourceRow {
  id:           UUID
  name:         string
  description:  string
  type:         SourceType
  company_id:   CompanySlug
  connected:    boolean
  config:       Record<string, unknown>  // encrypted at rest
  last_sync_at: ISODateString | null
  file_count:   number
  size_bytes:   number
  tags:         string[]
  icon:         string
  created_at:   ISODateString
}

/** Table: source_files */
export interface SourceFile {
  id:               UUID
  source_id:        UUID
  name:             string
  path:             string
  mime_type:        string
  size_bytes:       number
  embedding_status: EmbeddingStatus
  created_at:       ISODateString
}

/** Table: knowledge_chunks */
export interface KnowledgeChunk {
  id:         UUID
  source_id:  UUID
  file_id:    UUID
  content:    string
  embedding:  number[] | null    // pgvector
  metadata:   Record<string, unknown>
  created_at: ISODateString
}

/** Table: workflows */
export interface WorkflowRow {
  id:                 UUID
  name:               string
  description:        string
  area:               string
  area_color:         HexColor
  icon:               string
  steps:              WorkflowStepRow[]
  status:             WorkflowStatus
  estimated_minutes:  number
  steps_count:        number
  runs:               number
  last_run_at:        ISODateString | null
  created_at:         ISODateString
  updated_at:         ISODateString
}

export interface WorkflowStepRow {
  title:       string
  description: string
  fields:      WorkflowFieldRow[]
}

export interface WorkflowFieldRow {
  id:           string
  label:        string
  type:         "text" | "select" | "textarea" | "number" | "multiselect"
  placeholder?: string
  options?:     string[]
  required?:    boolean
}

/** Table: workflow_runs */
export interface WorkflowRun {
  id:          UUID
  workflow_id: UUID
  user_id:     UUID
  values:      Record<string, string | string[]>
  status:      WorkflowRunState
  result:      string | null
  duration_ms: number | null
  created_at:  ISODateString
}

/** Table: skills */
export interface SkillRow {
  id:              UUID
  name:            string
  description:     string
  icon:            string
  color:           HexColor
  category:        string
  prompt_template: string
  status:          AutomationStatus
  usage_count:     number
  last_used_at:    ISODateString | null
  created_at:      ISODateString
}

/** Table: schedules */
export interface ScheduleRow {
  id:              UUID
  name:            string
  description:     string
  agent_id:        UUID
  frequency:       ScheduleFreq
  cron_expression: string         // e.g. "0 8 * * *"
  next_run_at:     ISODateString
  last_run_at:     ISODateString | null
  status:          AutomationStatus
  payload:         Record<string, unknown>
  created_at:      ISODateString
}

/** Table: watchers */
export interface WatcherRow {
  id:               UUID
  name:             string
  description:      string
  trigger_type:     WatcherTrigger
  trigger_config:   Record<string, unknown>
  action_type:      string
  action_config:    Record<string, unknown>
  status:           AutomationStatus
  triggers_count:   number
  last_trigger_at:  ISODateString | null
  created_at:       ISODateString
}

/** Table: api_connections */
export interface ApiConnection {
  id:             UUID
  provider:       ApiProvider
  name:           string
  status:         ApiConnStatus
  config:         Record<string, unknown>  // encrypted — never expose keys to client
  last_tested_at: ISODateString | null
  created_at:     ISODateString
  updated_at:     ISODateString
}

/** Table: activity_logs */
export interface ActivityLog {
  id:         UUID
  user_id:    UUID | null
  event_type: LogEventType
  action:     string
  detail:     string
  metadata:   Record<string, unknown>
  created_at: ISODateString
}

// ─── Generic API wrappers ────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data:     T[]
  count:    number
  page:     number
  per_page: number
  has_more: boolean
}

export interface ApiResponse<T> {
  data:   T | null
  error:  string | null
  status: number
}

