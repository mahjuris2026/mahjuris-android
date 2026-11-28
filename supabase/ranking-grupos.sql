-- Mahjuris · ranking, nickname e grupos (versão 2.0)
-- Como usar: no painel do Supabase, abra SQL Editor > New query, cole este arquivo inteiro e clique em Run.
-- Pode rodar de novo sem problema (não apaga dados). Precisa do schema.sql já aplicado antes.
--
-- Planos (decididos em 28/11/2026):
--   Premium        R$ 19,90/ano  -> joga tudo, não cria grupos
--   Premium Plus   R$ 39,90/ano  -> Premium + cria até 5 grupos de até 10 pessoas
--   Plano Turma    R$ 99,90/ano  -> Premium + cria até 20 grupos de até 40 pessoas (docente, cursinho)
-- Quem ENTRA num grupo pode ser Free: o grupo não libera o Premium, só mostra o ranking juntos.

-- 1) Plano de grupos no perfil (quem pode criar grupos). A pessoa só lê; quem grava é você ou o pagamento.
alter table public.profiles add column if not exists plano        text;          -- null, 'plus' ou 'turma'
alter table public.profiles add column if not exists plano_until  timestamptz;   -- vencimento do Plus/Turma; vazio = sem prazo

create or replace function public.plano_limites(p_plano text, out grupos int, out pessoas int) language sql immutable as $$
  select case p_plano when 'turma' then 20 when 'plus' then 5 when 'mestre' then 50 else 0 end,
         case p_plano when 'turma' then 40 when 'plus' then 10 when 'mestre' then 100 else 0 end;
$$;

-- 2) Jogadores: o nickname público. Só o nickname aparece para outras pessoas (nunca o e-mail).
create table if not exists public.players (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null check (nickname ~ '^[A-Za-z0-9_.À-ÿ-]{3,20}$'),
  global      boolean not null default true,        -- aparece no ranking geral
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists players_nickname_unico on public.players (lower(nickname));
alter table public.players enable row level security;   -- sem regras: só as funções abaixo leem e gravam

-- 3) Pontos de cada dia (o app envia os totais do dia). Os pontos são calculados aqui, não no app.
--    10 pontos por par certo, -5 por erro (o dia nunca fica negativo), +20 por fase concluída.
create table if not exists public.daily_scores (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  ms         bigint not null default 0 check (ms between 0 and 86400000),     -- tempo jogando
  study_ms   bigint not null default 0 check (study_ms between 0 and 86400000), -- tempo no cronômetro de estudo
  ok         int not null default 0 check (ok between 0 and 5000),
  err        int not null default 0 check (err between 0 and 5000),
  phases     int not null default 0 check (phases between 0 and 500),
  points     int generated always as (greatest(0, ok*10 - err*5) + phases*20) stored,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists daily_scores_dia on public.daily_scores (day);
alter table public.daily_scores enable row level security;

-- 4) Grupos e membros
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 40),
  owner       uuid not null references auth.users(id) on delete cascade,
  code        text not null unique,
  max_members int not null default 10,
  created_at  timestamptz not null default now()
);
create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

-- ---------- funções que o app chama ----------
create or replace function public.hoje_br() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- dados do próprio jogador + o que o plano permite
create or replace function public.rank_me() returns json language plpgsql stable security definer set search_path = public as $$
declare pl record; pr record; lim record; ativo boolean;
begin
  if auth.uid() is null then raise exception 'sem login'; end if;
  select * into pl from players where id = auth.uid();
  select plano, plano_until, premium_source into pr from profiles where id = auth.uid();
  ativo := pr.plano is not null and (pr.plano_until is null or pr.plano_until > now());
  select * into lim from plano_limites(case when pr.premium_source = 'mestre' then 'mestre' when ativo then pr.plano else null end);
  return json_build_object('nickname', pl.nickname, 'global', coalesce(pl.global, true),
    'plano', case when ativo then pr.plano end, 'plano_until', pr.plano_until,
    'grupos_max', lim.grupos, 'pessoas_max', lim.pessoas,
    'grupos_meus', (select count(*) from groups where owner = auth.uid()));
end $$;

create or replace function public.set_player(p_nickname text, p_global boolean default true) returns json language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_nickname, ''));
begin
  if auth.uid() is null then raise exception 'sem login'; end if;
  if n !~ '^[A-Za-z0-9_.À-ÿ-]{3,20}$' then raise exception 'nickname_invalido'; end if;
  if exists (select 1 from players where lower(nickname) = lower(n) and id <> auth.uid()) then raise exception 'nickname_em_uso'; end if;
  insert into players (id, nickname, global) values (auth.uid(), n, coalesce(p_global, true))
  on conflict (id) do update set nickname = excluded.nickname, global = excluded.global, updated_at = now();
  return rank_me();
end $$;

-- o app envia os últimos dias: [{"day":"2026-11-28","ms":..,"study_ms":..,"ok":..,"err":..,"phases":..}, ...]
create or replace function public.post_days(p_days json) returns int language plpgsql security definer set search_path = public as $$
declare r json; n int := 0; d date;
begin
  if auth.uid() is null then raise exception 'sem login'; end if;
  if not exists (select 1 from players where id = auth.uid()) then return 0; end if;
  for r in select * from json_array_elements(p_days) loop
    begin d := (r->>'day')::date; exception when others then continue; end;
    if d < hoje_br() - 40 or d > hoje_br() + 1 then continue; end if;
    insert into daily_scores (user_id, day, ms, study_ms, ok, err, phases)
    values (auth.uid(), d,
      least(86400000, greatest(0, coalesce((r->>'ms')::bigint, 0))),
      least(86400000, greatest(0, coalesce((r->>'study_ms')::bigint, 0))),
      least(5000, greatest(0, coalesce((r->>'ok')::int, 0))),
      least(5000, greatest(0, coalesce((r->>'err')::int, 0))),
      least(500, greatest(0, coalesce((r->>'phases')::int, 0))))
    on conflict (user_id, day) do update set ms = excluded.ms, study_ms = excluded.study_ms, ok = excluded.ok,
      err = excluded.err, phases = excluded.phases, updated_at = now();
    n := n + 1;
    exit when n >= 60;
  end loop;
  return n;
end $$;

-- ranking: p_period 'hoje' | 'semana' | 'mes' | 'sempre'; p_group = null (geral) ou o id do grupo; p_order 'pontos' | 'tempo'
create or replace function public.ranking(p_period text default 'semana', p_group uuid default null, p_order text default 'pontos', p_limit int default 100)
returns table (pos bigint, nickname text, points bigint, ms bigint, dias bigint, me boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare desde date := case p_period when 'hoje' then hoje_br() when 'semana' then hoje_br() - 6 when 'mes' then hoje_br() - 29 else date '2000-01-01' end;
begin
  if auth.uid() is null then raise exception 'sem login'; end if;
  if p_group is not null and not exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()) then raise exception 'fora_do_grupo'; end if;
  return query
  with quem as (
    select p.id, p.nickname from players p
    where (p_group is null and (p.global or p.id = auth.uid()))
       or (p_group is not null and exists (select 1 from group_members m where m.group_id = p_group and m.user_id = p.id))
  ), tot as (
    select q.id, q.nickname, coalesce(sum(s.points), 0)::bigint pts, coalesce(sum(s.ms), 0)::bigint tms, count(s.day) filter (where s.ms > 0 or s.ok > 0)::bigint nd
    from quem q left join daily_scores s on s.user_id = q.id and s.day >= desde
    group by q.id, q.nickname
  ), ord as (
    select t.*, rank() over (order by case when p_order = 'tempo' then t.tms else t.pts end desc) rk from tot t
    where p_group is not null or t.pts > 0 or t.id = auth.uid()
  )
  select o.rk, o.nickname, o.pts, o.tms, o.nd, o.id = auth.uid() from ord o
  where o.rk <= least(greatest(coalesce(p_limit, 100), 1), 200) or o.id = auth.uid()
  order by o.rk, o.nickname;
end $$;

create or replace function public.my_groups() returns table (id uuid, name text, code text, owner boolean, members bigint, max_members int)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.code, g.owner = auth.uid(), (select count(*) from group_members x where x.group_id = g.id), g.max_members
  from groups g join group_members m on m.group_id = g.id and m.user_id = auth.uid()
  order by g.created_at;
$$;

create or replace function public.group_people(p_group uuid) returns table (nickname text, owner boolean, me boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not exists (select 1 from group_members where group_id = p_group and user_id = auth.uid()) then raise exception 'fora_do_grupo'; end if;
  return query select p.nickname, g.owner = m.user_id, m.user_id = auth.uid()
    from group_members m join groups g on g.id = m.group_id left join players p on p.id = m.user_id
    where m.group_id = p_group order by (g.owner = m.user_id) desc, lower(p.nickname);
end $$;

create or replace function public.create_group(p_name text) returns json language plpgsql security definer set search_path = public as $$
declare me json := rank_me(); g groups; c text; tries int := 0;
begin
  if (me->>'nickname') is null then raise exception 'sem_nickname'; end if;
  if coalesce((me->>'grupos_max')::int, 0) = 0 then raise exception 'plano_sem_grupos'; end if;
  if (me->>'grupos_meus')::int >= (me->>'grupos_max')::int then raise exception 'limite_grupos'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 40 then raise exception 'nome_invalido'; end if;
  loop
    c := upper(substr(translate(replace(gen_random_uuid()::text, '-', ''), '01', ''), 1, 6));
    exit when length(c) = 6 and not exists (select 1 from groups where code = c);
    tries := tries + 1; if tries > 20 then raise exception 'tente_de_novo'; end if;
  end loop;
  insert into groups (name, owner, code, max_members) values (btrim(p_name), auth.uid(), c, (me->>'pessoas_max')::int) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return json_build_object('id', g.id, 'name', g.name, 'code', g.code);
end $$;

create or replace function public.join_group(p_code text) returns json language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'sem login'; end if;
  if not exists (select 1 from players where id = auth.uid()) then raise exception 'sem_nickname'; end if;
  select * into g from groups where code = upper(btrim(coalesce(p_code, '')));
  if g.id is null then raise exception 'codigo_invalido'; end if;
  if exists (select 1 from group_members where group_id = g.id and user_id = auth.uid()) then
    return json_build_object('id', g.id, 'name', g.name, 'ja', true); end if;
  if (select count(*) from group_members where group_id = g.id) >= g.max_members then raise exception 'grupo_cheio'; end if;
  if (select count(*) from group_members where user_id = auth.uid()) >= 30 then raise exception 'muitos_grupos'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return json_build_object('id', g.id, 'name', g.name);
end $$;

create or replace function public.leave_group(p_group uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from groups where id = p_group and owner = auth.uid()) then raise exception 'dono_nao_sai'; end if;
  delete from group_members where group_id = p_group and user_id = auth.uid();
end $$;

create or replace function public.delete_group(p_group uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from groups where id = p_group and owner = auth.uid();
  if not found then raise exception 'so_o_dono'; end if;
end $$;

create or replace function public.remove_member(p_group uuid, p_nickname text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from groups where id = p_group and owner = auth.uid()) then raise exception 'so_o_dono'; end if;
  delete from group_members m using players p
  where m.group_id = p_group and p.id = m.user_id and lower(p.nickname) = lower(p_nickname) and m.user_id <> auth.uid();
end $$;

create or replace function public.new_group_code(p_group uuid) returns text language plpgsql security definer set search_path = public as $$
declare c text; tries int := 0;
begin
  if not exists (select 1 from groups where id = p_group and owner = auth.uid()) then raise exception 'so_o_dono'; end if;
  loop
    c := upper(substr(translate(replace(gen_random_uuid()::text, '-', ''), '01', ''), 1, 6));
    exit when length(c) = 6 and not exists (select 1 from groups where code = c);
    tries := tries + 1; if tries > 20 then raise exception 'tente_de_novo'; end if;
  end loop;
  update groups set code = c where id = p_group; return c;
end $$;

-- 5) Permissões: só as funções. As tabelas novas ficam fechadas para acesso direto.
do $$ declare f text; begin
  foreach f in array array['rank_me()','set_player(text, boolean)','post_days(json)','ranking(text, uuid, text, int)','my_groups()',
    'group_people(uuid)','create_group(text)','join_group(text)','leave_group(uuid)','delete_group(uuid)','remove_member(uuid, text)','new_group_code(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Para liberar um plano à mão (troque o e-mail):
--   update public.profiles set plano = 'plus',  plano_until = now() + interval '1 year' where email = 'pessoa@exemplo.com';
--   update public.profiles set plano = 'turma', plano_until = now() + interval '1 year' where email = 'professor@exemplo.com';
-- Para tirar:  update public.profiles set plano = null where email = 'pessoa@exemplo.com';
