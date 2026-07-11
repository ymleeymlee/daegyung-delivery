-- 고품 품목에 수량(quantity)과 비고(note) 추가
alter table gopoum_items add column if not exists quantity integer not null default 1;
alter table gopoum_items add column if not exists note text;
