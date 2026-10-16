-- =============================================================
-- Dhenors — tabelas da nuvem (Supabase / PostgreSQL)
-- Rode em: Supabase → SQL Editor → New query → Run.
-- Pode rodar de novo sem perder dados (tudo é "if not exists").
--
-- Tudo o que tem valores vai CRIPTOGRAFADO pelo aparelho: o
-- servidor só vê envelopes ilegíveis { enc, salt, iv, data }.
--
--   dhenors_state     1 linha por pessoa: índice cifrado + version
--   dhenors_chunks    partes cifradas do estado (uma por coleção/ano)
--   dhenors_versions  histórico (últimos 30 índices) para restaurar
--   dhenors_devices   aparelhos conectados (desconectar remotamente)
--   dhenors_push      inscrição de notificações (sem valores)
--
-- Proteções extras (mais abaixo): aparelho desconectado não volta a
-- "revoked = false" sozinho, e cada conta tem uma cota de espaço.
-- Depois de criar a SUA conta, desligue o cadastro aberto (Authentication
-- → Sign In / Providers → "Allow new users to sign up"): veja docs/NUVEM.md.
-- =============================================================

-- ---------- Estado (índice) ----------
create table if not exists public.dhenors_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null,           -- envelope cifrado (índice em partes ou estado inteiro, formato antigo)
  version    bigint      not null default 1, -- aumenta a cada gravação
  device     text,                           -- último aparelho que salvou
  updated_at timestamptz not null default now()
);

-- ---------- Partes do estado ----------
create table if not exists public.dhenors_chunks (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  name       text        not null,           -- ex.: "expenses:2026"
  rev        text        not null,           -- id único desta gravação
  data       jsonb       not null,           -- envelope cifrado
  created_at timestamptz not null default now(),
  primary key (user_id, rev)
);
create index if not exists dhenors_chunks_user_name on public.dhenors_chunks (user_id, name);

-- ---------- Histórico de versões ----------
create table if not exists public.dhenors_versions (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  version    bigint      not null,
  manifest   jsonb       not null,           -- índice cifrado daquela versão
  device     text,
  created_at timestamptz not null default now(),
  primary key (user_id, version)
);

-- ---------- Aparelhos ----------
create table if not exists public.dhenors_devices (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  device_id   text        not null,
  name        text,
  app_version text,
  last_seen   timestamptz not null default now(),
  revoked     boolean     not null default false,
  primary key (user_id, device_id)
);

-- ---------- Notificações push (sem valores, só quantidades) ----------
create table if not exists public.dhenors_push (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  device_id    text        not null,
  subscription jsonb       not null,         -- endpoint + chaves do navegador
  schedule     jsonb       not null default '{}'::jsonb, -- { "2026-10-16": 2 } = 2 contas nesse dia
  weekly       boolean     not null default true,        -- resumo de domingo
  updated_at   timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- ---------- Segurança: cada pessoa só vê e altera as PRÓPRIAS linhas ----------
do $$
declare t text;
begin
  foreach t in array array['dhenors_state', 'dhenors_chunks', 'dhenors_versions', 'dhenors_devices', 'dhenors_push'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "dono le" on public.%I', t);
    execute format('drop policy if exists "dono cria" on public.%I', t);
    execute format('drop policy if exists "dono altera" on public.%I', t);
    execute format('drop policy if exists "dono apaga" on public.%I', t);
    execute format('create policy "dono le" on public.%I for select using (auth.uid() = user_id)', t);
    execute format('create policy "dono cria" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "dono altera" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format('create policy "dono apaga" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- ---------- Limites de tamanho (evita abuso) ----------
alter table public.dhenors_state drop constraint if exists dhenors_state_size;
alter table public.dhenors_state add constraint dhenors_state_size check (pg_column_size(data) < 5 * 1024 * 1024);
alter table public.dhenors_chunks drop constraint if exists dhenors_chunks_size;
alter table public.dhenors_chunks add constraint dhenors_chunks_size check (pg_column_size(data) < 5 * 1024 * 1024);
alter table public.dhenors_versions drop constraint if exists dhenors_versions_size;
alter table public.dhenors_versions add constraint dhenors_versions_size check (pg_column_size(manifest) < 512 * 1024);

-- ---------- Aparelho desconectado não se "reconecta" sozinho ----------
-- Pelas regras acima, o próprio aparelho poderia trocar revoked de
-- true para false. Este gatilho recusa isso. Para voltar, a pessoa
-- entra de novo com e-mail e senha: o app apaga a linha marcada e
-- cria outra (apagar continua permitido para o dono).
create or replace function public.dhenors_devices_keep_revoked()
returns trigger language plpgsql as $$
begin
  if old.revoked and not new.revoked then
    raise exception 'dhenors_revoked: aparelho desconectado' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists dhenors_devices_keep_revoked on public.dhenors_devices;
create trigger dhenors_devices_keep_revoked before update on public.dhenors_devices
  for each row execute function public.dhenors_devices_keep_revoked();

-- ---------- Cota por pessoa (evita que alguém encha o projeto) ----------
-- Soma partes + histórico de cada conta. O plano gratuito do Supabase
-- tem 500 MB no total; 50 MB por conta é muito mais do que anos de uso.
-- Mude o número em dhenors_quota_bytes() se precisar.
create or replace function public.dhenors_quota_bytes() returns bigint
language sql immutable as $$ select 50::bigint * 1024 * 1024 $$;

create or replace function public.dhenors_check_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare used bigint;
begin
  select coalesce((select sum(pg_column_size(data)) from public.dhenors_chunks where user_id = new.user_id), 0)
       + coalesce((select sum(pg_column_size(manifest)) from public.dhenors_versions where user_id = new.user_id), 0)
    into used;
  if used + pg_column_size(to_jsonb(new)) > public.dhenors_quota_bytes() then
    raise exception 'dhenors_quota: limite de espaço desta conta atingido' using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists dhenors_chunks_quota on public.dhenors_chunks;
create trigger dhenors_chunks_quota before insert on public.dhenors_chunks
  for each row execute function public.dhenors_check_quota();
drop trigger if exists dhenors_versions_quota on public.dhenors_versions;
create trigger dhenors_versions_quota before insert on public.dhenors_versions
  for each row execute function public.dhenors_check_quota();

-- ---------- Tempo real: avisa os aparelhos quando o estado muda ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dhenors_state') then
    alter publication supabase_realtime add table public.dhenors_state;
  end if;
exception when undefined_object then
  raise notice 'Publicação supabase_realtime não existe; o app continua com a consulta periódica.';
end $$;

-- ---------- A API do Supabase passa a enxergar as tabelas novas na hora ----------
notify pgrst, 'reload schema';

-- ---------- (Opcional) Lembretes por push todo dia às 8h (horário de Brasília) ----------
-- Requer a Edge Function "daily-reminders" publicada (supabase/functions)
-- e as extensões pg_cron e pg_net ligadas em Database → Extensions.
-- Troque SEU-PROJETO e a CHAVE-SERVICE (Project Settings → API → service_role).
--
-- select cron.schedule('dhenors-lembretes', '0 11 * * *', $$
--   select net.http_post(
--     url := 'https://SEU-PROJETO.supabase.co/functions/v1/daily-reminders',
--     headers := jsonb_build_object('Authorization', 'Bearer CHAVE-SERVICE')
--   );
-- $$);
