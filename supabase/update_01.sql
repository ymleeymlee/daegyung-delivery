-- 대경배달시스템 마이그레이션 01
-- Supabase SQL Editor에서 실행하세요

-- 1. deliveries status에 'cancelled' 추가
alter table deliveries drop constraint if exists deliveries_status_check;
alter table deliveries add constraint deliveries_status_check
  check (status in ('waiting', 'assigned', 'completed', 'cancelled'));

-- 2. riders 테이블에 is_quick 컬럼 추가
alter table riders add column if not exists is_quick boolean not null default false;

-- 3. 안산퀵 · 파워퀵 라이더 추가
insert into riders (name, is_quick) values
  ('안산퀵', true),
  ('파워퀵', true);
