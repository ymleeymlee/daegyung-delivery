-- 고품관리 테이블

-- 고품 있는 업체 등록
create table if not exists gopoum_clients (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  client_code text not null default '',
  client_name text not null,
  total_quantity int not null default 0,
  created_at timestamptz not null default now()
);

-- 고품 수거 기록
create table if not exists gopoum_pickups (
  id uuid primary key default gen_random_uuid(),
  gopoum_client_id uuid not null references gopoum_clients(id) on delete cascade,
  delivery_id uuid references deliveries(id) on delete set null,
  rider_name text not null,
  quantity int not null,
  picked_at timestamptz not null default now()
);

create index if not exists gopoum_pickups_client_idx on gopoum_pickups(gopoum_client_id);

-- Realtime 활성화
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'gopoum_clients'
  ) then
    alter publication supabase_realtime add table gopoum_clients;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'gopoum_pickups'
  ) then
    alter publication supabase_realtime add table gopoum_pickups;
  end if;
end $$;

-- RLS 비활성 (내부 직원 전용)
alter table gopoum_clients disable row level security;
alter table gopoum_pickups disable row level security;
