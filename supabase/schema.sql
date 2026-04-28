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
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  provider_transaction_id text,
  current_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
