-- Chinese Reader — cloud sync schema for Supabase.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run again (idempotent).
--
-- Model: the device keeps the full book in IndexedDB. The cloud keeps
--  * the original files (Chinese book + human translation) in Storage, so a
--    new device can rebuild the book locally, and
--  * small per-user state (progress, words, vocabulary, bookmarks, settings).
-- Positions are (chapter_index, sentence_index): sentence ids are generated
-- per device and are not shared.
-- `updated_at` is the client's millisecond clock; the newest write wins.
-- `server_at` is set by the database on every write; devices pull rows whose
-- server_at is newer than what they saw last, independent of device clocks.

create table if not exists public.books (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  title text not null,
  author text,
  source_format text not null,
  source_name text,
  source_size bigint,
  source_path text,
  reference_name text,
  reference_path text,
  reference_title text,
  created_at bigint not null,
  updated_at bigint not null,
  server_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

create table if not exists public.reading_progress (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  book_id text not null,
  chapter_index integer not null,
  sentence_index integer not null,
  progress real not null default 0,
  updated_at bigint not null,
  server_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table if not exists public.word_progress (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  word text not null,
  status text not null check (status in ('learning', 'known', 'ignored')),
  exposures integer not null default 0,
  updated_at bigint not null,
  server_at timestamptz not null default now(),
  primary key (user_id, word)
);

create table if not exists public.vocabulary (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  word text not null,
  pinyin text,
  meaning text,
  part_of_speech text,
  source_book_id text,
  source_book_title text,
  added_at bigint not null,
  updated_at bigint not null,
  server_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, word)
);

create table if not exists public.bookmarks (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  book_id text not null,
  book_title text,
  chapter_index integer not null,
  chapter_title text,
  sentence_index integer not null,
  preview_text text,
  created_at bigint not null,
  updated_at bigint not null,
  server_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

create table if not exists public.settings (
  user_id uuid not null default auth.uid() references auth.users on delete cascade primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at bigint not null,
  server_at timestamptz not null default now()
);

-- Older installs of this schema: add server_at where missing.
do $$
declare t text;
begin
  foreach t in array array['books', 'reading_progress', 'word_progress', 'vocabulary', 'bookmarks', 'settings'] loop
    execute format('alter table public.%I add column if not exists server_at timestamptz not null default now()', t);
  end loop;
end $$;

-- Newest write wins on the server too: an update carrying an older
-- updated_at than the stored row is ignored (the row is left untouched).
create or replace function public.touch_server_at() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  new.server_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['books', 'reading_progress', 'word_progress', 'vocabulary', 'bookmarks', 'settings'] loop
    execute format('drop trigger if exists touch_server_at on public.%I', t);
    execute format('create trigger touch_server_at before insert or update on public.%I for each row execute function public.touch_server_at()', t);
    execute format('create index if not exists %I on public.%I (user_id, server_at)', t || '_server_at', t);
  end loop;
end $$;

-- Row Level Security: every row belongs to exactly one user.
do $$
declare t text;
begin
  foreach t in array array['books', 'reading_progress', 'word_progress', 'vocabulary', 'bookmarks', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t);
  end loop;
end $$;

-- Private bucket for the original files: <user id>/<book id>/<source|reference>.<ext>
insert into storage.buckets (id, name, public, file_size_limit)
values ('books', 'books', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "own book files read" on storage.objects;
drop policy if exists "own book files insert" on storage.objects;
drop policy if exists "own book files update" on storage.objects;
drop policy if exists "own book files delete" on storage.objects;

create policy "own book files read" on storage.objects for select to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own book files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own book files update" on storage.objects for update to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own book files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
