-- 위치추적 3단계: 기기(device_id) 기반으로 전환
-- 앱은 더 이상 라이더를 선택하지 않고, ANDROID_ID(device_id)로 위치를 write 한다.
-- 웹 /riders 에서 device_id ↔ rider 매핑을 관리하고, /tracking 은 매핑된 라이더 이름을 표시한다.
-- (마감 상태는 기존 app_state.closed_until 을 그대로 사용 — 앱이 이 값을 읽어 추적 시작/정지)

-- 1) 기기 ↔ 라이더 매핑
create table if not exists rider_devices (
  device_id    text primary key,
  rider_id     uuid references riders(id) on delete set null,
  label        text,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);
alter table rider_devices disable row level security;

-- 2) rider_locations: device_id 를 새 기본키로 (앱이 device_id 기준 upsert)
--    실시간 테이블(마감마다 비워짐)이라 기존 행 삭제 후 재구성해도 안전.
--    퍼블리케이션이 delete 를 publish 하므로 재구성 동안 잠시 퍼블리케이션에서 제거.
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='rider_locations') then
    alter publication supabase_realtime drop table rider_locations;
  end if;
end $$;
delete from rider_locations;
alter table rider_locations drop constraint if exists rider_locations_pkey;
alter table rider_locations add column if not exists device_id text;
alter table rider_locations alter column rider_id   drop not null;
alter table rider_locations alter column rider_name drop not null;
delete from rider_locations where device_id is null;
alter table rider_locations add constraint rider_locations_pkey primary key (device_id);
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='rider_locations') then
    alter publication supabase_realtime add table rider_locations;
  end if;
end $$;

-- 3) location_pings: device_id 추가, rider_* nullable (앱이 라이더를 모름)
alter table location_pings add column if not exists device_id text;
alter table location_pings alter column rider_name drop not null;
create index if not exists location_pings_device_time_idx on location_pings(device_id, captured_at);

-- 4) delivery_trips: device_id 추가, rider_* nullable, device 기준 인덱스
alter table delivery_trips add column if not exists device_id text;
alter table delivery_trips alter column rider_name drop not null;
create index if not exists delivery_trips_device_time_idx  on delivery_trips(device_id, started_at desc);
create index if not exists delivery_trips_device_open_idx  on delivery_trips(device_id) where ended_at is null;

-- 5) 웹 /riders·/tracking 이 기기↔라이더 매핑 변경을 실시간 반영
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='rider_devices') then
    alter publication supabase_realtime add table rider_devices;
  end if;
end $$;
