-- 대경배달시스템 마이그레이션 02
-- Supabase SQL Editor에서 실행하세요

-- clients 테이블에 업체번호(code) 컬럼 추가
alter table clients add column if not exists code text not null default '';

-- 업체번호 조회용 인덱스
create index if not exists clients_code_idx on clients(code);
