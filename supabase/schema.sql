-- Run this once in Supabase SQL Editor.
-- It gives every auth user a profile and enforces unique nickname/email.

create extension if not exists citext;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  nickname text not null,
  nickname_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable for nickname login" on public.profiles;
create policy "profiles are readable for nickname login"
on public.profiles for select
using (true);

drop policy if exists "users can insert own profile" on public.profiles;
create policy "users can insert own profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_nickname text;
begin
  raw_nickname := nullif(trim(new.raw_user_meta_data ->> 'nickname'), '');

  if raw_nickname is null then
    raise exception 'nickname is required';
  end if;

  insert into public.profiles (id, email, nickname, nickname_key)
  values (new.id, new.email, raw_nickname, lower(raw_nickname));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill existing users that were created before this trigger existed.
insert into public.profiles (id, email, nickname, nickname_key)
select
  users.id,
  users.email,
  trim(users.raw_user_meta_data ->> 'nickname') as nickname,
  lower(trim(users.raw_user_meta_data ->> 'nickname')) as nickname_key
from auth.users as users
where nullif(trim(users.raw_user_meta_data ->> 'nickname'), '') is not null
on conflict (id) do nothing;

create table if not exists public.skill_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill text not null default 'shen.skill',
  conversation_id text,
  message_id text,
  feedback text not null check (feedback in ('like', 'dislike')),
  comment text,
  user_message text,
  assistant_message text,
  settings jsonb not null default '{}'::jsonb,
  absorbed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.skill_memories enable row level security;

drop policy if exists "users can read own skill memories" on public.skill_memories;
create policy "users can read own skill memories"
on public.skill_memories for select
using (auth.uid() = user_id);

drop policy if exists "users can insert own skill memories" on public.skill_memories;
create policy "users can insert own skill memories"
on public.skill_memories for insert
with check (auth.uid() = user_id);

create index if not exists skill_memories_user_skill_created_idx
on public.skill_memories (user_id, skill, created_at desc);

create table if not exists public.skill_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submitter_email citext not null,
  name text not null,
  repo_url text not null,
  description text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'published')),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.skill_submissions
add column if not exists review_note text;

alter table public.skill_submissions enable row level security;

drop trigger if exists skill_submissions_set_updated_at on public.skill_submissions;
create trigger skill_submissions_set_updated_at
before update on public.skill_submissions
for each row execute function public.set_updated_at();

drop policy if exists "users can insert own skill submissions" on public.skill_submissions;
create policy "users can insert own skill submissions"
on public.skill_submissions for insert
with check (auth.uid() = user_id);

drop policy if exists "users can read own skill submissions" on public.skill_submissions;
create policy "users can read own skill submissions"
on public.skill_submissions for select
using (auth.uid() = user_id);

drop policy if exists "admins can read skill submissions" on public.skill_submissions;
create policy "admins can read skill submissions"
on public.skill_submissions for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can update skill submissions" on public.skill_submissions;
create policy "admins can update skill submissions"
on public.skill_submissions for update
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
)
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists skill_submissions_created_idx
on public.skill_submissions (created_at desc);

create table if not exists public.skill_publish_tasks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.skill_submissions(id) on delete cascade,
  repo_url text not null,
  skill_name text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  created_by_email citext not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.skill_publish_tasks enable row level security;

drop trigger if exists skill_publish_tasks_set_updated_at on public.skill_publish_tasks;
create trigger skill_publish_tasks_set_updated_at
before update on public.skill_publish_tasks
for each row execute function public.set_updated_at();

drop policy if exists "admins can read skill publish tasks" on public.skill_publish_tasks;
create policy "admins can read skill publish tasks"
on public.skill_publish_tasks for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can insert skill publish tasks" on public.skill_publish_tasks;
create policy "admins can insert skill publish tasks"
on public.skill_publish_tasks for insert
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can update skill publish tasks" on public.skill_publish_tasks;
create policy "admins can update skill publish tasks"
on public.skill_publish_tasks for update
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
)
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists skill_publish_tasks_created_idx
on public.skill_publish_tasks (created_at desc);

create unique index if not exists skill_publish_tasks_submission_unique_idx
on public.skill_publish_tasks (submission_id);

create or replace function public.auto_queue_skill_publish_task(submission_id_input uuid)
returns public.skill_publish_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  submission_record public.skill_submissions;
  task_record public.skill_publish_tasks;
begin
  select *
  into submission_record
  from public.skill_submissions
  where id = submission_id_input;

  if submission_record.id is null then
    raise exception 'submission not found';
  end if;

  if submission_record.user_id <> auth.uid() then
    raise exception 'permission denied';
  end if;

  if submission_record.status <> 'approved' then
    raise exception 'submission is not approved';
  end if;

  insert into public.skill_publish_tasks (
    submission_id,
    repo_url,
    skill_name,
    status,
    created_by_email
  )
  values (
    submission_record.id,
    submission_record.repo_url,
    submission_record.name,
    'pending',
    submission_record.submitter_email
  )
  on conflict (submission_id)
  do update set
    repo_url = excluded.repo_url,
    skill_name = excluded.skill_name,
    status = case
      when public.skill_publish_tasks.status = 'done' then public.skill_publish_tasks.status
      else 'pending'
    end,
    updated_at = now()
  returning * into task_record;

  return task_record;
end;
$$;

revoke all on function public.auto_queue_skill_publish_task(uuid) from public;
grant execute on function public.auto_queue_skill_publish_task(uuid) to authenticated;

create table if not exists public.request_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now()
);

alter table public.request_events enable row level security;

drop policy if exists "users can insert own request events" on public.request_events;
create policy "users can insert own request events"
on public.request_events for insert
with check (auth.uid() = user_id);

drop policy if exists "users can read own request events" on public.request_events;
create policy "users can read own request events"
on public.request_events for select
using (auth.uid() = user_id);

create index if not exists request_events_user_type_created_idx
on public.request_events (user_id, event_type, created_at desc);

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'inactive',
  quota_bonus integer not null default 0,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  provider_transaction_id text,
  current_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_entitlements
add column if not exists quota_bonus integer not null default 0;

alter table public.user_entitlements enable row level security;

drop trigger if exists user_entitlements_set_updated_at on public.user_entitlements;
create trigger user_entitlements_set_updated_at
before update on public.user_entitlements
for each row execute function public.set_updated_at();

drop policy if exists "users can read own entitlements" on public.user_entitlements;
create policy "users can read own entitlements"
on public.user_entitlements for select
using (auth.uid() = user_id);

drop policy if exists "admins can read all entitlements" on public.user_entitlements;
create policy "admins can read all entitlements"
on public.user_entitlements for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists user_entitlements_status_idx
on public.user_entitlements (status, updated_at desc);

create table if not exists public.billing_events (
  id text primary key,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.billing_events enable row level security;

drop policy if exists "admins can read billing events" on public.billing_events;
create policy "admins can read billing events"
on public.billing_events for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists billing_events_created_idx
on public.billing_events (created_at desc);

create table if not exists public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'paddle',
  provider_transaction_id text,
  checkout_url text,
  status text not null default 'created',
  created_at timestamptz not null default now()
);

alter table public.checkout_sessions enable row level security;

drop policy if exists "users can read own checkout sessions" on public.checkout_sessions;
create policy "users can read own checkout sessions"
on public.checkout_sessions for select
using (auth.uid() = user_id);

create index if not exists checkout_sessions_user_created_idx
on public.checkout_sessions (user_id, created_at desc);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email citext not null,
  plan text not null check (plan in ('plus', 'pro')),
  amount_cny integer not null,
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),
  action text not null default 'subscribe' check (action in ('subscribe', 'renew', 'upgrade')),
  quota_delta integer not null default 0,
  period_months integer not null default 1,
  payment_method text not null check (payment_method in ('wechat', 'alipay')),
  payer_name text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by_email citext,
  reviewed_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_requests
add column if not exists billing_cycle text not null default 'monthly';

alter table public.payment_requests
add column if not exists action text not null default 'subscribe';

alter table public.payment_requests
add column if not exists quota_delta integer not null default 0;

alter table public.payment_requests
add column if not exists period_months integer not null default 1;

alter table public.payment_requests enable row level security;

drop trigger if exists payment_requests_set_updated_at on public.payment_requests;
create trigger payment_requests_set_updated_at
before update on public.payment_requests
for each row execute function public.set_updated_at();

drop policy if exists "users can insert own payment requests" on public.payment_requests;
create policy "users can insert own payment requests"
on public.payment_requests for insert
with check (auth.uid() = user_id);

drop policy if exists "users can read own payment requests" on public.payment_requests;
create policy "users can read own payment requests"
on public.payment_requests for select
using (auth.uid() = user_id);

drop policy if exists "admins can read payment requests" on public.payment_requests;
create policy "admins can read payment requests"
on public.payment_requests for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can update payment requests" on public.payment_requests;
create policy "admins can update payment requests"
on public.payment_requests for update
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
)
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists payment_requests_created_idx
on public.payment_requests (created_at desc);

create index if not exists payment_requests_status_created_idx
on public.payment_requests (status, created_at desc);

create table if not exists public.membership_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  group_key text not null check (group_key in ('plus_monthly', 'plus_yearly', 'pro_monthly', 'pro_yearly')),
  plan text not null check (plan in ('plus', 'pro')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  quota_delta integer not null default 0,
  period_months integer not null default 1,
  status text not null default 'unused' check (status in ('unused', 'redeemed', 'disabled')),
  note text,
  created_by_email citext,
  redeemed_by_user_id uuid references auth.users(id) on delete set null,
  redeemed_by_email citext,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.membership_codes enable row level security;

drop trigger if exists membership_codes_set_updated_at on public.membership_codes;
create trigger membership_codes_set_updated_at
before update on public.membership_codes
for each row execute function public.set_updated_at();

drop policy if exists "admins can read membership codes" on public.membership_codes;
create policy "admins can read membership codes"
on public.membership_codes for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can insert membership codes" on public.membership_codes;
create policy "admins can insert membership codes"
on public.membership_codes for insert
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can update membership codes" on public.membership_codes;
create policy "admins can update membership codes"
on public.membership_codes for update
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
)
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists membership_codes_group_status_idx
on public.membership_codes (group_key, status, created_at desc);

create index if not exists membership_codes_redeemed_user_idx
on public.membership_codes (redeemed_by_user_id, redeemed_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null default 'all' check (audience in ('all', 'user', 'plan')),
  target_user_id uuid references auth.users(id) on delete cascade,
  target_email citext,
  target_plan text check (target_plan in ('free', 'plus', 'pro', 'admin')),
  type text not null default 'announcement',
  quota_delta integer not null default 0,
  title text not null,
  body text not null,
  created_by_email citext,
  created_at timestamptz not null default now()
);

alter table public.notifications
add column if not exists quota_delta integer not null default 0;

alter table public.notifications enable row level security;

drop policy if exists "users can read matching notifications" on public.notifications;
create policy "users can read matching notifications"
on public.notifications for select
using (
  audience = 'all'
  or target_user_id = auth.uid()
  or lower(coalesce(target_email::text, '')) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  or lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can insert notifications" on public.notifications;
create policy "admins can insert notifications"
on public.notifications for insert
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can update notifications" on public.notifications;
create policy "admins can update notifications"
on public.notifications for update
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
)
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can delete notifications" on public.notifications;
create policy "admins can delete notifications"
on public.notifications for delete
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists notifications_created_idx
on public.notifications (created_at desc);

create index if not exists notifications_audience_idx
on public.notifications (audience, target_email, target_plan, created_at desc);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_reads enable row level security;

drop policy if exists "users can read own notification receipts" on public.notification_reads;
create policy "users can read own notification receipts"
on public.notification_reads for select
using (auth.uid() = user_id);

drop policy if exists "users can insert own notification receipts" on public.notification_reads;
create policy "users can insert own notification receipts"
on public.notification_reads for insert
with check (auth.uid() = user_id);

create index if not exists notification_reads_user_idx
on public.notification_reads (user_id, read_at desc);

create table if not exists public.notification_claims (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_delta integer not null default 0,
  claimed_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_claims enable row level security;

drop policy if exists "users can read own notification claims" on public.notification_claims;
create policy "users can read own notification claims"
on public.notification_claims for select
using (auth.uid() = user_id);

drop policy if exists "users can insert own notification claims" on public.notification_claims;
create policy "users can insert own notification claims"
on public.notification_claims for insert
with check (auth.uid() = user_id);

drop policy if exists "admins can read notification claims" on public.notification_claims;
create policy "admins can read notification claims"
on public.notification_claims for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists notification_claims_user_idx
on public.notification_claims (user_id, claimed_at desc);

create table if not exists public.mirror_conversations (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '新的镜室对话',
  pinned boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  created_at_ms bigint not null,
  updated_at_ms bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mirror_conversations enable row level security;

drop trigger if exists mirror_conversations_set_updated_at on public.mirror_conversations;
create trigger mirror_conversations_set_updated_at
before update on public.mirror_conversations
for each row execute function public.set_updated_at();

drop policy if exists "users can read own mirror conversations" on public.mirror_conversations;
create policy "users can read own mirror conversations"
on public.mirror_conversations for select
using (auth.uid() = user_id);

drop policy if exists "users can insert own mirror conversations" on public.mirror_conversations;
create policy "users can insert own mirror conversations"
on public.mirror_conversations for insert
with check (auth.uid() = user_id);

drop policy if exists "users can update own mirror conversations" on public.mirror_conversations;
create policy "users can update own mirror conversations"
on public.mirror_conversations for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users can delete own mirror conversations" on public.mirror_conversations;
create policy "users can delete own mirror conversations"
on public.mirror_conversations for delete
using (auth.uid() = user_id);

create index if not exists mirror_conversations_user_updated_idx
on public.mirror_conversations (user_id, updated_at_ms desc);

create table if not exists public.skill_settings (
  id text primary key,
  enabled boolean not null default true,
  display_order integer not null default 1000,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.skill_settings
add column if not exists display_order integer not null default 1000;

alter table public.skill_settings enable row level security;

drop trigger if exists skill_settings_set_updated_at on public.skill_settings;
create trigger skill_settings_set_updated_at
before update on public.skill_settings
for each row execute function public.set_updated_at();

drop policy if exists "admins can read skill settings" on public.skill_settings;
create policy "admins can read skill settings"
on public.skill_settings for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can insert skill settings" on public.skill_settings;
create policy "admins can insert skill settings"
on public.skill_settings for insert
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can update skill settings" on public.skill_settings;
create policy "admins can update skill settings"
on public.skill_settings for update
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
)
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

insert into public.skill_settings (id, enabled)
values ('shen.skill', false)
on conflict (id) do nothing;

update public.skill_settings
set display_order = 999
where id = 'shen.skill' and display_order = 1000;

create table if not exists public.model_routes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  provider text not null default 'custom' check (provider in ('deepseek', 'siliconflow', 'openrouter', 'custom')),
  api_base_url text not null,
  api_key text,
  api_key_env text,
  model text not null,
  temperature numeric not null default 0.7,
  enabled boolean not null default false,
  audience text not null default 'all' check (audience in ('all', 'plan', 'user')),
  target_plan text check (target_plan in ('free', 'plus', 'pro', 'admin')),
  target_email citext,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.model_routes enable row level security;

drop trigger if exists model_routes_set_updated_at on public.model_routes;
create trigger model_routes_set_updated_at
before update on public.model_routes
for each row execute function public.set_updated_at();

drop policy if exists "admins can read model routes" on public.model_routes;
create policy "admins can read model routes"
on public.model_routes for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can insert model routes" on public.model_routes;
create policy "admins can insert model routes"
on public.model_routes for insert
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can update model routes" on public.model_routes;
create policy "admins can update model routes"
on public.model_routes for update
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
)
with check (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

drop policy if exists "admins can delete model routes" on public.model_routes;
create policy "admins can delete model routes"
on public.model_routes for delete
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists model_routes_audience_idx
on public.model_routes (enabled, audience, target_plan, target_email, priority);

insert into public.model_routes
  (slug, name, provider, api_base_url, api_key_env, model, temperature, enabled, audience, priority)
values
  ('deepseek-deepseek-v4-flash', 'DeepSeek · DeepSeek v4 Flash', 'deepseek', 'https://api.deepseek.com/chat/completions', 'DEEPSEEK_API_KEY', 'deepseek-v4-flash', 0.7, true, 'all', 10),
  ('deepseek-deepseek-v4-pro', 'DeepSeek · DeepSeek v4 Pro', 'deepseek', 'https://api.deepseek.com/chat/completions', 'DEEPSEEK_API_KEY', 'deepseek-v4-pro', 0.7, false, 'all', 101),
  ('siliconflow-pro-moonshotai-kimi-k2-6', 'SiliconFlow · Kimi K2.6', 'siliconflow', 'https://api.siliconflow.cn/v1/chat/completions', 'SILICONFLOW_API_KEY', 'Pro/moonshotai/Kimi-K2.6', 0.7, false, 'all', 102),
  ('siliconflow-pro-zai-org-glm-5-1', 'SiliconFlow · GLM 5.1', 'siliconflow', 'https://api.siliconflow.cn/v1/chat/completions', 'SILICONFLOW_API_KEY', 'Pro/zai-org/GLM-5.1', 0.7, false, 'all', 103),
  ('siliconflow-pro-minimaxai-minimax-m2-5', 'SiliconFlow · MiniMax M2.5', 'siliconflow', 'https://api.siliconflow.cn/v1/chat/completions', 'SILICONFLOW_API_KEY', 'Pro/MiniMaxAI/MiniMax-M2.5', 0.7, false, 'all', 104),
  ('siliconflow-pro-deepseek-ai-deepseek-v3-2', 'SiliconFlow · DeepSeek V3.2', 'siliconflow', 'https://api.siliconflow.cn/v1/chat/completions', 'SILICONFLOW_API_KEY', 'Pro/deepseek-ai/DeepSeek-V3.2', 0.7, false, 'all', 105),
  ('openrouter-qwen-qwen3-6-plus', 'OpenRouter · Qwen 3.6 Plus', 'openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'OPENROUTER_API_KEY', 'qwen/qwen3.6-plus', 0.7, false, 'all', 106)
on conflict (slug) do nothing;
