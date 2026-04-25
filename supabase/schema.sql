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
