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
--   dhenors_feedback_log  registro do "Fale conosco" (só hashes; sem acesso público)
--
-- Proteções extras (mais abaixo): aparelho desconectado não volta a
-- "revoked = false" sozinho; cada conta tem cota de espaço (dados e
-- anexos); colunas livres têm tamanho máximo; no máximo 20 aparelhos e
-- 10 inscrições de push por conta.
-- Cadastro aberto com confirmação por e-mail (Authentication → Sign In /
-- Providers → "Allow new users to sign up" e "Confirm email"): veja docs/NUVEM.md.
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

-- Vale para INSERT e também para UPDATE (as regras de acesso permitem
-- alterar linhas): na alteração conta só a diferença entre a linha nova
-- e a antiga, e diminuir de tamanho é sempre permitido.
create or replace function public.dhenors_check_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  used  bigint;
  delta bigint;
begin
  delta := pg_column_size(to_jsonb(new));
  if tg_op = 'UPDATE' then
    delta := delta - pg_column_size(to_jsonb(old));
    if delta <= 0 then return new; end if; -- ficou menor (ou igual): sempre pode
  end if;
  select coalesce((select sum(pg_column_size(data)) from public.dhenors_chunks where user_id = new.user_id), 0)
       + coalesce((select sum(pg_column_size(manifest)) from public.dhenors_versions where user_id = new.user_id), 0)
    into used;
  if used + delta > public.dhenors_quota_bytes() then
    raise exception 'dhenors_quota: limite de espaço desta conta atingido' using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists dhenors_chunks_quota on public.dhenors_chunks;
create trigger dhenors_chunks_quota before insert or update on public.dhenors_chunks
  for each row execute function public.dhenors_check_quota();
drop trigger if exists dhenors_versions_quota on public.dhenors_versions;
create trigger dhenors_versions_quota before insert or update on public.dhenors_versions
  for each row execute function public.dhenors_check_quota();

-- ---------- Tamanho das colunas livres (aparelhos e push) ----------
-- "not valid": vale para linhas novas e alteradas, sem falhar por causa
-- de linhas antigas que já existam (rodar de novo não perde nada).
alter table public.dhenors_devices drop constraint if exists dhenors_devices_sizes;
alter table public.dhenors_devices add constraint dhenors_devices_sizes check (
  length(device_id) between 1 and 64
  and (name is null or length(name) <= 80)
  and (app_version is null or length(app_version) <= 32)
) not valid;
alter table public.dhenors_push drop constraint if exists dhenors_push_sizes;
alter table public.dhenors_push add constraint dhenors_push_sizes check (
  length(device_id) between 1 and 64
  and octet_length(subscription::text) <= 4096
  and octet_length(schedule::text) <= 4096
) not valid;

-- ---------- Quantidade de linhas por pessoa ----------
-- No máximo 20 aparelhos e 10 inscrições de push por conta. A linha do
-- próprio aparelho não conta (o app grava com "upsert", que dispara o
-- gatilho de INSERT mesmo quando a linha já existe). Aparelhos
-- desconectados ocupam vaga até serem removidos da lista em Ajustes.
create or replace function public.dhenors_check_rows()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n   int;
  lim int;
begin
  lim := case tg_table_name when 'dhenors_devices' then 20 else 10 end;
  execute format('select count(*) from public.%I where user_id = $1 and device_id <> $2', tg_table_name)
    into n using new.user_id, new.device_id;
  if n >= lim then
    raise exception 'dhenors_limit: limite de % linhas por conta em %', lim, tg_table_name using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists dhenors_devices_rows on public.dhenors_devices;
create trigger dhenors_devices_rows before insert on public.dhenors_devices
  for each row execute function public.dhenors_check_rows();
drop trigger if exists dhenors_push_rows on public.dhenors_push;
create trigger dhenors_push_rows before insert on public.dhenors_push
  for each row execute function public.dhenors_check_rows();

-- ---------- Registro do "Fale conosco" (limite de envios) ----------
-- Usado só pela Edge Function send-feedback, com a chave service_role,
-- para limitar envios (por hora no total, por e-mail e por IP). Guarda
-- só hashes SHA-256 — nunca o IP ou o e-mail em claro — e a função
-- apaga registros com mais de 1 dia. RLS ligado e NENHUMA política:
-- ninguém de fora (anon/authenticated) lê ou grava.
create table if not exists public.dhenors_feedback_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  ip_hash    text,
  email_hash text
);
create index if not exists dhenors_feedback_log_at on public.dhenors_feedback_log (at);
alter table public.dhenors_feedback_log enable row level security;
revoke all on public.dhenors_feedback_log from anon, authenticated;

-- ---------- Tempo real: avisa os aparelhos quando o estado muda ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dhenors_state') then
    alter publication supabase_realtime add table public.dhenors_state;
  end if;
exception when undefined_object then
  raise notice 'Publicação supabase_realtime não existe; o app continua com a consulta periódica.';
end $$;

-- ---------- Anexos (fotos de comprovantes, boletos) — Storage ----------
-- Bucket PRIVADO "dhenors-files". Cada arquivo chega já cifrado pelo
-- aparelho (chave própria, guardada no estado cifrado): o servidor só
-- vê bytes ilegíveis. Caminho: <id do usuário>/<id do anexo>. Cada
-- pessoa só lê, grava e apaga a própria pasta. Limites: 10 MB por
-- arquivo e 100 MB por conta (mude em dhenors_files_quota_bytes()).
insert into storage.buckets (id, name, public, file_size_limit)
values ('dhenors-files', 'dhenors-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public.dhenors_files_quota_bytes() returns bigint
language sql immutable as $$ select 100::bigint * 1024 * 1024 $$;

-- Cota da pasta: soma metadata->>'size' dos arquivos da pessoa (sem
-- contar o próprio arquivo, quando é substituição) + o tamanho do novo.
-- "security definer" porque é chamada de dentro das regras de acesso de
-- storage.objects. O Storage confere a regra antes do envio (ainda sem
-- o tamanho: só recusa se a pasta JÁ estiver cheia) e de novo ao gravar
-- os metadados (com o tamanho real). Assim, a pasta passa de 100 MB no
-- máximo pelo último arquivo (até 10 MB).
create or replace function public.dhenors_files_quota_ok(obj_name text, new_meta jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  owner_dir text := (storage.foldername(obj_name))[1];
  used      bigint;
  new_size  bigint := case when jsonb_typeof(new_meta -> 'size') = 'number'
                           then (new_meta ->> 'size')::numeric::bigint else 0 end;
begin
  select coalesce(sum(case when jsonb_typeof(o.metadata -> 'size') = 'number'
                           then (o.metadata ->> 'size')::numeric::bigint else 0 end), 0)
    into used
    from storage.objects o
   where o.bucket_id = 'dhenors-files'
     and (storage.foldername(o.name))[1] = owner_dir
     and o.name <> obj_name;
  return used + greatest(new_size, 0) <= public.dhenors_files_quota_bytes();
end $$;
revoke all on function public.dhenors_files_quota_ok(text, jsonb) from public, anon;
grant execute on function public.dhenors_files_quota_ok(text, jsonb) to authenticated;

drop policy if exists "dhenors_files_select" on storage.objects;
drop policy if exists "dhenors_files_insert" on storage.objects;
drop policy if exists "dhenors_files_update" on storage.objects;
drop policy if exists "dhenors_files_delete" on storage.objects;
create policy "dhenors_files_select" on storage.objects for select to authenticated
  using (bucket_id = 'dhenors-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dhenors_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'dhenors-files' and (storage.foldername(name))[1] = auth.uid()::text
              and public.dhenors_files_quota_ok(name, metadata));
create policy "dhenors_files_update" on storage.objects for update to authenticated
  using (bucket_id = 'dhenors-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'dhenors-files' and (storage.foldername(name))[1] = auth.uid()::text
              and public.dhenors_files_quota_ok(name, metadata));
create policy "dhenors_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'dhenors-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- A API do Supabase passa a enxergar as tabelas novas na hora ----------
notify pgrst, 'reload schema';

-- ---------- (Opcional) Lembretes por push todo dia às 8h (horário de Brasília) ----------
-- Requer a Edge Function "daily-reminders" publicada (supabase/functions)
-- e as extensões pg_cron e pg_net ligadas em Database → Extensions.
-- NÃO cole a chave service_role em texto no comando do cron: ela ficaria
-- legível em cron.job para quem consulta o banco. Guarde-a uma vez no
-- Vault do Supabase e leia de vault.decrypted_secrets na hora da chamada.
-- Troque SEU-PROJETO e CHAVE-SERVICE (Project Settings → API → service_role).
--
-- 1) Uma vez (ou pelo painel: Project Settings → Vault):
-- select vault.create_secret('CHAVE-SERVICE', 'dhenors_service_role');
--
-- 2) O agendamento:
-- select cron.schedule('dhenors-lembretes', '0 11 * * *', $$
--   select net.http_post(
--     url := 'https://SEU-PROJETO.supabase.co/functions/v1/daily-reminders',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || (
--       select decrypted_secret from vault.decrypted_secrets where name = 'dhenors_service_role'
--     ))
--   );
-- $$);
--
-- Já tinha agendado com a chave em texto? Troque: select cron.unschedule('dhenors-lembretes');
-- e rode os passos 1 e 2.
