-- NoWork database schema. Run once: Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
-- Row level security is ON with no policies, so the public (anon) key can read and write nothing.
-- Only the backend, using the service role key, touches these tables.

create table if not exists prompt_sets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,                    -- random id kept in the browser (no login yet)
  title text not null,
  summary text not null default '',
  ai_tool text not null default '',
  wants_code boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz                    -- set when all steps were downloaded
);

create table if not exists prompt_steps (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references prompt_sets(id) on delete cascade,
  position int not null check (position between 1 and 12),
  title text not null,
  prompt text not null,
  downloaded_at timestamptz,
  unique (set_id, position)
);

create table if not exists code_projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  set_id uuid references prompt_sets(id) on delete set null,
  title text not null,
  files jsonb not null,                       -- [{ "path": "index.html", "content": "..." }, ...]
  created_at timestamptz not null default now()
);

create index if not exists prompt_sets_client_idx on prompt_sets (client_id, created_at desc);
create index if not exists prompt_steps_set_idx on prompt_steps (set_id);
create index if not exists code_projects_client_idx on code_projects (client_id, created_at desc);

alter table prompt_sets enable row level security;
alter table prompt_steps enable row level security;
alter table code_projects enable row level security;
