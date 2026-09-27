-- 라이더별 오늘 총 이동거리(m) 서버 집계 함수.
-- 배송현황(DeliveryBoard) 30초 폴링이 4700+ 핑 원본을 다 내려받던 것을 대체.
-- 5m 이하 지터는 스킵하고 prev 좌표를 유지(기존 클라이언트 로직과 동일).
CREATE OR REPLACE FUNCTION today_distance_by_device(p_branch text)
RETURNS TABLE(device_id text, distance_m numeric)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r RECORD;
  prev_lat DOUBLE PRECISION;
  prev_lng DOUBLE PRECISION;
  prev_dev TEXT := NULL;
  total DOUBLE PRECISION := 0;
  d DOUBLE PRECISION;
BEGIN
  FOR r IN
    SELECT p.device_id AS did, p.lat, p.lng
    FROM location_pings p
    JOIN rider_devices dd USING(device_id)
    WHERE dd.branch = p_branch
      AND p.captured_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
    ORDER BY p.device_id, p.captured_at
  LOOP
    IF r.did IS DISTINCT FROM prev_dev THEN
      IF prev_dev IS NOT NULL THEN
        device_id := prev_dev; distance_m := total; RETURN NEXT;
      END IF;
      prev_dev := r.did; prev_lat := r.lat; prev_lng := r.lng; total := 0;
    ELSE
      d := 2 * 6371000 * asin(least(1, sqrt(
        sin(radians((r.lat - prev_lat) / 2)) ^ 2 +
        cos(radians(prev_lat)) * cos(radians(r.lat)) * sin(radians((r.lng - prev_lng) / 2)) ^ 2)));
      IF d >= 5 THEN
        total := total + d;
        prev_lat := r.lat; prev_lng := r.lng;
      END IF;
    END IF;
  END LOOP;
  IF prev_dev IS NOT NULL THEN
    device_id := prev_dev; distance_m := total; RETURN NEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION today_distance_by_device(text) TO anon, authenticated;
