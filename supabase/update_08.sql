-- 마감/테스트용 상태 관리
alter table gopoum_items add column if not exists archived_at timestamptz;

create table if not exists app_state (
  key text primary key,
  value text
);
alter table app_state disable row level security;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='app_state') then
    alter publication supabase_realtime add table app_state;
  end if;
end $$;

insert into app_state(key, value) values ('date_offset','0'), ('closed_until','')
on conflict (key) do nothing;
