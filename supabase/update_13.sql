-- 위치추적 2단계: 배송 회차(trip) — 본사 이탈~복귀 구간
-- 앱(대경 라이더)이 지오펜스 전이 시 write:
--   INSIDE  → OUTSIDE : insert (started_at=now, ended_at=null)
--   OUTSIDE → INSIDE  : update ended_at=now where rider_id=? and ended_at is null
-- 웹 /tracking 은 라이더 클릭 시 오늘의 trip 목록 로드, trip 클릭 시 그 시간대 동선 필터.

create table if not exists delivery_trips (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid references riders(id) on delete cascade,
  rider_name text not null,
  started_at timestamptz not null,           -- 본사 이탈 시각
  ended_at timestamptz,                      -- 본사 복귀 시각 (null = 진행 중)
  created_at timestamptz not null default now()
);
alter table delivery_trips disable row level security;

-- 라이더별 최신순 조회 최적화
create index if not exists delivery_trips_rider_time_idx
  on delivery_trips(rider_id, started_at desc);

-- "이 라이더의 진행 중 trip" 빠른 검색 (앱이 복귀 시 이걸로 update)
create index if not exists delivery_trips_open_idx
  on delivery_trips(rider_id) where ended_at is null;

-- 웹 /tracking 이 배송 출발/완료를 실시간 알림용으로 구독
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='delivery_trips') then
    alter publication supabase_realtime add table delivery_trips;
  end if;
end $$;
