-- 동선 기록(location_pings)을 DB 트리거로 1분 단위 복사.
-- 앱은 실시간 마커(rider_locations)만 전송하고, 이 트리거가 기기별로 '새로운 분'의 첫 마커를
-- location_pings 로 복사한다 → 동선 전송 요청(하루 ~12만 건, 로그의 ~40%) 제거.
-- store_ping: 앱이 판단한 '궤적 저장 대상' 여부 (본사 반경 안·필터 거부 fix 는 false).
--             구버전 앱은 이 컬럼을 보내지 않으므로 기본값 true.

-- 1) 컬럼 추가
ALTER TABLE rider_locations ADD COLUMN IF NOT EXISTS store_ping boolean NOT NULL DEFAULT true;
ALTER TABLE rider_locations ADD COLUMN IF NOT EXISTS last_ping_minute timestamptz;

-- 2) 트리거 함수: store_ping 이고 이번 분에 아직 복사 안 했으면 location_pings 에 1건 추가
CREATE OR REPLACE FUNCTION copy_location_ping_per_minute()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  m timestamptz := date_trunc('minute', NEW.updated_at);
BEGIN
  IF NEW.store_ping AND NEW.updated_at IS NOT NULL
     AND NEW.last_ping_minute IS DISTINCT FROM m THEN
    INSERT INTO location_pings (device_id, rider_id, rider_name, lat, lng, accuracy, captured_at)
    VALUES (NEW.device_id, NEW.rider_id, NEW.rider_name, NEW.lat, NEW.lng, NEW.accuracy, NEW.updated_at);
    NEW.last_ping_minute := m;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rider_locations_copy_ping ON rider_locations;
CREATE TRIGGER rider_locations_copy_ping
  BEFORE INSERT OR UPDATE ON rider_locations
  FOR EACH ROW EXECUTE FUNCTION copy_location_ping_per_minute();
