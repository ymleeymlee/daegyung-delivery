-- 대경배달시스템 마이그레이션 03
-- Supabase SQL Editor에서 실행하세요

-- 라이더에 지점(location) 컬럼 추가: 'gn'(강남) / 'as'(안산)
alter table riders add column if not exists location text not null default 'gn';
alter table riders drop constraint if exists riders_location_check;
alter table riders add constraint riders_location_check
  check (location in ('gn', 'as'));

-- 퀵 라이더 초기 지점 지정 (안산퀵 → as). 나머지는 강남(gn) 기본값.
update riders set location = 'as' where name = '안산퀵';

-- 리포트 조회 성능용 인덱스
create index if not exists deliveries_created_at_idx on deliveries(created_at);
create index if not exists deliveries_assigned_at_idx on deliveries(assigned_at);
