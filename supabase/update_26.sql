-- 배송 row 에 거래처 '남은 고품 차종 목록' 스냅샷 추가.
-- gopoum_count 와 같은 방식으로 트리거가 자동 유지. 라이더 앱이 차종을 보여줄 때 추가 쿼리 없이 사용.

-- 1) 컬럼 추가
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS gopoum_cars text NOT NULL DEFAULT '';

-- 2) '남은 고품' 아이템들의 차종을 unique + comma(' ,') 로 묶어 반환.
--    아이템에 차종이 없으면 '차종모름' 으로 대체. 모두 수거됐으면 '' 반환.
CREATE OR REPLACE FUNCTION calc_gopoum_cars(p_code text, p_branch text)
RETURNS text LANGUAGE sql STABLE AS $$
  WITH remaining AS (
    SELECT COALESCE(NULLIF(TRIM(gi.car_type), ''), '차종모름') AS car
    FROM gopoum_items gi
    JOIN gopoum_clients gc ON gc.id = gi.gopoum_client_id
    WHERE gi.archived_at IS NULL
      AND gc.client_code = p_code
      AND gc.branch = p_branch
      AND GREATEST(
        0,
        COALESCE(gi.quantity, 1) - COALESCE((
          SELECT SUM((c->>'quantity')::int)
          FROM jsonb_array_elements(COALESCE(gi.collectors, '[]'::jsonb)) c
        ), 0)
      ) > 0
  ),
  uniq AS (SELECT DISTINCT car FROM remaining)
  SELECT COALESCE(string_agg(car, ', ' ORDER BY car), '') FROM uniq;
$$;

-- 3) 배송 생성 시 gopoum_cars 도 함께 채움 (기존 트리거 확장)
CREATE OR REPLACE FUNCTION fill_delivery_gopoum_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code text;
BEGIN
  IF NEW.client_id IS NOT NULL AND NEW.branch IS NOT NULL THEN
    SELECT code INTO v_code FROM clients WHERE id = NEW.client_id;
    IF v_code IS NOT NULL THEN
      NEW.gopoum_count := calc_gopoum_remaining(v_code, NEW.branch);
      NEW.gopoum_cars := calc_gopoum_cars(v_code, NEW.branch);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 4) 고품 변경 시 활성 배송들의 gopoum_count + gopoum_cars 모두 갱신 (기존 트리거 확장)
CREATE OR REPLACE FUNCTION sync_delivery_gopoum_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code text;
  v_branch text;
  v_remaining integer;
  v_cars text;
BEGIN
  SELECT client_code, branch INTO v_code, v_branch
  FROM gopoum_clients
  WHERE id = COALESCE(NEW.gopoum_client_id, OLD.gopoum_client_id);
  IF v_code IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  v_remaining := calc_gopoum_remaining(v_code, v_branch);
  v_cars := calc_gopoum_cars(v_code, v_branch);

  UPDATE deliveries d
  SET gopoum_count = v_remaining,
      gopoum_cars = v_cars
  FROM clients c
  WHERE d.client_id = c.id
    AND c.code = v_code
    AND d.branch = v_branch
    AND d.status IN ('waiting','assigned')
    AND (COALESCE(d.gopoum_count, -1) <> v_remaining OR COALESCE(d.gopoum_cars, '') <> v_cars);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5) 기존 active 배송 백필
UPDATE deliveries d
SET gopoum_cars = calc_gopoum_cars(c.code, d.branch)
FROM clients c
WHERE d.client_id = c.id
  AND d.status IN ('waiting','assigned');
