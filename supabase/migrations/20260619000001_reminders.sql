-- ═══════════════════════════════════════════════════════════════════════════════
-- Mota OS — Lembretes recorrentes + Notificações in-app
-- Migration: 20260619000001
--
-- `reminders`: lembretes que o usuário cria pelo chat ("me lembre todo dia às 14h…").
-- `notifications`: entrega in-app (sininho); a entrega no Rocket.Chat usa a infra
-- de rocketchat_destinations já existente.
--
-- O disparo é feito por um cron (Supabase pg_cron → pg_net → /api/cron/reminders),
-- configurado em snippet separado. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── reminders ───────────────────────────────────────────────────────────────
create table if not exists reminders (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users on delete cascade,
  company_id    text,
  content       text        not null,
  time_of_day   time        not null,
  timezone      text        not null default 'America/Recife',
  recurrence    text        not null default 'daily' check (recurrence in ('daily','weekly','once')),
  days_of_week  int[],                       -- 0=domingo … 6=sábado (apenas weekly)
  next_run_at   timestamptz not null,
  last_run_at   timestamptz,
  active        boolean     not null default true,
  channels      text[]      not null default '{inapp,rocketchat}',
  created_at    timestamptz not null default now()
);

create index if not exists reminders_due_idx     on reminders (next_run_at) where active;
create index if not exists reminders_user_idx     on reminders (user_id, active);

alter table reminders enable row level security;

drop policy if exists "reminders: owner all" on reminders;
create policy "reminders: owner all" on reminders
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── notifications (in-app) ──────────────────────────────────────────────────
create table if not exists notifications (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users on delete cascade,
  title       text        not null default '',
  body        text        not null default '',
  kind        text        not null default 'reminder',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on notifications (user_id, read_at, created_at desc);

alter table notifications enable row level security;

drop policy if exists "notifications: owner read"   on notifications;
drop policy if exists "notifications: owner update" on notifications;
create policy "notifications: owner read" on notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications: owner update" on notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- INSERT é feito apenas pelo service role (cron), que ignora RLS.
