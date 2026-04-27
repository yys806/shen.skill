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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.skill_submissions enable row level security;

drop trigger if exists skill_submissions_set_updated_at on public.skill_submissions;
create trigger skill_submissions_set_updated_at
before update on public.skill_submissions
for each row execute function public.set_updated_at();

drop policy if exists "users can insert own skill submissions" on public.skill_submissions;
create policy "users can insert own skill submissions"
on public.skill_submissions for insert
with check (auth.uid() = user_id);

drop policy if exists "admins can read skill submissions" on public.skill_submissions;
create policy "admins can read skill submissions"
on public.skill_submissions for select
using (
  lower(coalesce((auth.jwt() ->> 'email'), '')) = '3492675568@qq.com'
);

create index if not exists skill_submissions_created_idx
on public.skill_submissions (created_at desc);
