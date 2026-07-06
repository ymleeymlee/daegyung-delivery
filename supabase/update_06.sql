-- 고품 아이템 단위 추적 테이블
create table if not exists gopoum_items (
  id uuid primary key default gen_random_uuid(),
  gopoum_client_id uuid not null references gopoum_clients(id) on delete cascade,
  description text not null,
  rider_name text,
  delivery_id uuid references deliveries(id) on delete set null,
  picked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists gopoum_items_client_idx on gopoum_items(gopoum_client_id);
create index if not exists gopoum_items_delivery_idx on gopoum_items(delivery_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'gopoum_items'
  ) then
    alter publication supabase_realtime add table gopoum_items;
  end if;
end $$;

alter table gopoum_items disable row level security;
