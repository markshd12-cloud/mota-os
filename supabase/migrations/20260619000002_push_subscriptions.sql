-- ═══════════════════════════════════════════════════════════════════════════════
-- Mota OS — Web Push: inscrições por usuário/dispositivo
-- Migration: 20260619000002
--
-- Guarda a PushSubscription do navegador de cada usuário (por dispositivo).
-- O cron de lembretes usa estas inscrições para enviar a notificação do sistema
-- mesmo com a aba do Jarvis fechada. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users on delete cascade,
  endpoint    text        not null unique,
  p256dh      text        not null,
  auth        text        not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

drop policy if exists "push: owner all" on push_subscriptions;
create policy "push: owner all" on push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- O cron usa service role (ignora RLS) para ler as inscrições e enviar o push.
