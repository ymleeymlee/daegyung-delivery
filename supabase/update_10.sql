-- 고품 품목: 배송자별 수거량 기록 (부분·다중 수거)
-- collectors = [{ delivery_id, rider_name, quantity, picked_at }, ...]
alter table gopoum_items add column if not exists collectors jsonb not null default '[]'::jsonb;
