-- 대경배달시스템 Supabase 스키마
-- Supabase SQL Editor에서 실행하세요

-- 거래처
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  created_at timestamptz not null default now()
);

-- 라이더
create table if not exists riders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 배달 카드
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  client_name text not null,
  client_address text not null default '',
  status text not null default 'waiting' check (status in ('waiting', 'assigned', 'completed')),
  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  rider_id uuid references riders(id) on delete set null,
  sort_order integer not null default 0
);

-- 인덱스
create index if not exists deliveries_status_idx on deliveries(status);
create index if not exists deliveries_rider_idx on deliveries(rider_id);

-- Realtime 활성화 (이미 등록된 경우 무시)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'deliveries'
  ) then
    alter publication supabase_realtime add table deliveries;
  end if;
end $$;

-- RLS 비활성화 (내부 직원 전용 시스템)
alter table clients disable row level security;
alter table riders disable row level security;
alter table deliveries disable row level security;

-- 샘플 라이더 데이터
insert into riders (name) values
  ('김민준'),
  ('이서연'),
  ('박지후'),
  ('최수아')
on conflict do nothing;
