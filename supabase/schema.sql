-- =============================================================
-- Dhenors — tabela da nuvem (Supabase / PostgreSQL)
-- Rode UMA vez em: Supabase → SQL Editor → New query → Run.
--
-- Cada usuário tem UMA linha com o estado do app inteiro, já
-- CRIPTOGRAFADO no aparelho (o servidor nunca vê os números).
-- `version` evita que um aparelho apague o que outro salvou.
-- =============================================================

create table if not exists public.dhenors_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null,           -- envelope { enc, salt, iv, data }
  version    bigint      not null default 1, -- aumenta a cada gravação
  device     text,                           -- último aparelho que salvou
  updated_at timestamptz not null default now()
);

alter table public.dhenors_state enable row level security;

-- Cada pessoa só enxerga e altera a PRÓPRIA linha
drop policy if exists "dono le"      on public.dhenors_state;
drop policy if exists "dono cria"    on public.dhenors_state;
drop policy if exists "dono altera"  on public.dhenors_state;
drop policy if exists "dono apaga"   on public.dhenors_state;

create policy "dono le"     on public.dhenors_state for select using (auth.uid() = user_id);
create policy "dono cria"   on public.dhenors_state for insert with check (auth.uid() = user_id);
create policy "dono altera" on public.dhenors_state for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "dono apaga"  on public.dhenors_state for delete using (auth.uid() = user_id);

-- Limite de tamanho (5 MB) para evitar abuso
alter table public.dhenors_state drop constraint if exists dhenors_state_size;
alter table public.dhenors_state add constraint dhenors_state_size check (pg_column_size(data) < 5 * 1024 * 1024);
