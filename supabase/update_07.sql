-- 고품 아이템 마감(아카이브) 컬럼
-- 마감 시 수거된 아이템은 archived_at이 설정되어 고품 현황에서 사라지고 고품 내역에 남는다.
alter table gopoum_items add column if not exists archived_at timestamptz;
create index if not exists gopoum_items_archived_idx on gopoum_items(archived_at);
