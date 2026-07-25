-- 대경배송시스템 마이그레이션 18
-- 고품(gopoum_clients) 지점(branch) 분리. Supabase SQL Editor에서 실행하세요.

alter table gopoum_clients add column if not exists branch text not null default 'as';
update gopoum_clients set branch = 'as' where branch is null or branch = '';
create index if not exists gopoum_clients_branch_idx on gopoum_clients(branch);
