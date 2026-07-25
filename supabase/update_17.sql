-- 대경배달시스템 마이그레이션 17
-- 지점(branch) 다중화: branches 테이블 신설 + riders/clients/deliveries 지점 분리 + app_state 지점별 창고좌표
-- Supabase SQL Editor에서 실행하세요

-- 1) branches 테이블 신설 (하드코딩 enum 탈피, 나중에 지점 추가 가능)
create table if not exists branches (
  code text primary key,
  label text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table branches disable row level security;
insert into branches(code, label, sort_order) values
  ('as','안산',1), ('gn','강남',2)
on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='branches') then
    alter publication supabase_realtime add table branches;
  end if;
end $$;

-- 2) riders.location 하드코딩 제약 제거 (branches 테이블로 대체)
alter table riders drop constraint if exists riders_location_check;
alter table riders alter column location set default 'as';

-- 3) clients에 branch 컬럼 추가, 기존 전부 'as'로 채움
alter table clients add column if not exists branch text not null default 'as';
update clients set branch = 'as' where branch is null or branch = '';
create index if not exists clients_branch_idx on clients(branch);

-- 4) deliveries에도 branch 컬럼 추가 (대기열 포함 전부 지점별 완전분리), 기존 전부 'as'
alter table deliveries add column if not exists branch text not null default 'as';
update deliveries set branch = 'as' where branch is null or branch = '';
create index if not exists deliveries_branch_idx on deliveries(branch);

-- 5) app_state 창고좌표/지오펜스만 branch 접미사 키로 이관
--    (date_offset, closed_until 은 전역 그대로 유지, branch화 안 함)
--    구 전역 키(warehouse_lat 등)는 삭제하지 않고 남겨둠(하위호환/롤백 대비)
insert into app_state(key, value)
select 'warehouse_lat__as', coalesce((select value from app_state where key='warehouse_lat'),'37.4787')
on conflict (key) do nothing;
insert into app_state(key, value)
select 'warehouse_lng__as', coalesce((select value from app_state where key='warehouse_lng'),'127.0664')
on conflict (key) do nothing;
insert into app_state(key, value)
select 'geofence_radius_m__as', coalesce((select value from app_state where key='geofence_radius_m'),'100')
on conflict (key) do nothing;
insert into app_state(key, value) values
  ('warehouse_lat__gn','37.4787'),
  ('warehouse_lng__gn','127.0664'),
  ('geofence_radius_m__gn','100')
on conflict (key) do nothing;
