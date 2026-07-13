-- 위치추적 1단계: 실시간 위치 + 원시 핑 기록
-- (라이더 지급 키오스크폰 앱이 write, 웹 /tracking 이 read)

-- 라이더별 최신 위치 1행 (실시간 지도용 · upsert)
create table if not exists rider_locations (
  rider_id uuid primary key references riders(id) on delete cascade,
  rider_name text not null,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  updated_at timestamptz not null default now()
);
alter table rider_locations disable row level security;

-- 원시 GPS 핑 (기록·동선용 · append, 실시간 구독 안 함, 마감해도 보관)
create table if not exists location_pings (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid references riders(id) on delete set null,
  rider_name text not null,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table location_pings disable row level security;
create index if not exists location_pings_rider_time_idx on location_pings(rider_id, captured_at);

-- 실시간 지도용: rider_locations 만 realtime publication 등록
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='rider_locations') then
    alter publication supabase_realtime add table rider_locations;
  end if;
end $$;

-- 창고 기준 위치 + 지오펜스 반경 (임시: 서울 개포동. 실제 창고 좌표로 값만 바꾸면 됨)
insert into app_state(key, value) values
  ('warehouse_lat','37.4787'),
  ('warehouse_lng','127.0664'),
  ('geofence_radius_m','100')
on conflict (key) do nothing;

-- 배송지 ETA/지연 관련 필드 미리 반영 (phase 2~3에서 채움 · 지금은 nullable)
alter table deliveries add column if not exists dest_lat double precision;            -- 배송지 좌표(지오코딩 캐시)
alter table deliveries add column if not exists dest_lng double precision;
alter table deliveries add column if not exists eta_seconds integer;                   -- 최근 계산 소요(초, 교통반영)
alter table deliveries add column if not exists baseline_arrival_at timestamptz;       -- 배정시 기준 도착시각
