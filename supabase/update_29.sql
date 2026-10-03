-- 수거 완료 후에도 뱃지가 유지되도록 '총 수량' 스냅샷을 별도 컬럼에 저장.
-- 라이더가 "이 배송에 고품이 있었다/있다" 를 시각적으로 알 수 있게 함.

-- 1) 컬럼 추가
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS gopoum_total integer NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS nearby_gopoum_total integer NOT NULL DEFAULT 0;

-- 2) 자기 거래처 총 고품 수량 (archived 제외, 수거 여부 무관)
CREATE OR REPLACE FUNCTION calc_gopoum_total(p_code text, p_branch text)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(COALESCE(gi.quantity, 1)), 0)::integer
  FROM gopoum_items gi
  JOIN gopoum_clients gc ON gc.id = gi.gopoum_client_id
  WHERE gi.archived_at IS NULL
    AND (CASE WHEN gc.client_code ~ '^[0-9]+$' THEN lpad(gc.client_code, 4, '0') ELSE gc.client_code END)
      = (CASE WHEN p_code ~ '^[0-9]+$' THEN lpad(p_code, 4, '0') ELSE p_code END)
    AND gc.branch = p_branch;
$$;

-- 3) 주변(같은 region 다른 거래처) 총 고품 수량
CREATE OR REPLACE FUNCTION calc_nearby_gopoum_total_for(p_client_id uuid, p_branch text)
RETURNS integer LANGUAGE sql STABLE AS $$
  WITH self AS (
    SELECT c.region, c.code AS self_code FROM clients c WHERE c.id = p_client_id
  )
  SELECT COALESCE(SUM(COALESCE(gi.quantity, 1)), 0)::integer
  FROM gopoum_items gi
  JOIN gopoum_clients gc ON gc.id = gi.gopoum_client_id
  JOIN clients c_near ON c_near.branch = gc.branch
    AND (CASE WHEN c_near.code ~ '^[0-9]+$' THEN lpad(c_near.code, 4, '0') ELSE c_near.code END)
     = (CASE WHEN gc.client_code ~ '^[0-9]+$' THEN lpad(gc.client_code, 4, '0') ELSE gc.client_code END)
  CROSS JOIN self
  WHERE gi.archived_at IS NULL
    AND gc.branch = p_branch
    AND c_near.region = self.region
    AND self.region IS NOT NULL
    AND (CASE WHEN c_near.code ~ '^[0-9]+$' THEN lpad(c_near.code, 4, '0') ELSE c_near.code END)
     <> (CASE WHEN self.self_code ~ '^[0-9]+$' THEN lpad(self.self_code, 4, '0') ELSE self.self_code END);
$$;

-- 4) 배송 생성 트리거 확장 — totals 도 세팅
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
      NEW.gopoum_total := calc_gopoum_total(v_code, NEW.branch);
    END IF;
    NEW.nearby_gopoum_count := calc_nearby_gopoum_count_for(NEW.client_id, NEW.branch);
    NEW.nearby_gopoum_total := calc_nearby_gopoum_total_for(NEW.client_id, NEW.branch);
  END IF;
  RETURN NEW;
END;
$$;

-- 5) sync 트리거 확장 — 자기 total + nearby total 모두 유지
CREATE OR REPLACE FUNCTION sync_delivery_gopoum_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code text;
  v_branch text;
  v_remaining integer;
  v_total integer;
  v_cars text;
  v_region text;
BEGIN
  SELECT client_code, branch INTO v_code, v_branch
  FROM gopoum_clients
  WHERE id = COALESCE(NEW.gopoum_client_id, OLD.gopoum_client_id);
  IF v_code IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  v_remaining := calc_gopoum_remaining(v_code, v_branch);
  v_cars := calc_gopoum_cars(v_code, v_branch);
  v_total := calc_gopoum_total(v_code, v_branch);

  -- (a) 자기 거래처 활성 배송의 count/cars/total
  UPDATE deliveries d
  SET gopoum_count = v_remaining,
      gopoum_cars = v_cars,
      gopoum_total = v_total
  FROM clients c
  WHERE d.client_id = c.id
    AND (CASE WHEN c.code ~ '^[0-9]+$' THEN lpad(c.code, 4, '0') ELSE c.code END)
      = (CASE WHEN v_code ~ '^[0-9]+$' THEN lpad(v_code, 4, '0') ELSE v_code END)
    AND d.branch = v_branch
    AND d.status IN ('waiting','assigned')
    AND (COALESCE(d.gopoum_count, -1) <> v_remaining
         OR COALESCE(d.gopoum_cars, '') <> v_cars
         OR COALESCE(d.gopoum_total, -1) <> v_total);

  -- (b) 같은 region 활성 배송의 nearby_count/total
  SELECT c.region INTO v_region
  FROM clients c
  WHERE c.branch = v_branch
    AND (CASE WHEN c.code ~ '^[0-9]+$' THEN lpad(c.code, 4, '0') ELSE c.code END)
      = (CASE WHEN v_code ~ '^[0-9]+$' THEN lpad(v_code, 4, '0') ELSE v_code END)
  LIMIT 1;

  IF v_region IS NOT NULL THEN
    UPDATE deliveries d
    SET nearby_gopoum_count = calc_nearby_gopoum_count_for(d.client_id, d.branch),
        nearby_gopoum_total = calc_nearby_gopoum_total_for(d.client_id, d.branch)
    FROM clients c
    WHERE d.client_id = c.id
      AND c.region = v_region
      AND d.branch = v_branch
      AND d.status IN ('waiting','assigned');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 6) 기존 active 배송 백필
UPDATE deliveries d
SET gopoum_total = calc_gopoum_total(c.code, d.branch),
    nearby_gopoum_total = calc_nearby_gopoum_total_for(d.client_id, d.branch)
FROM clients c
WHERE d.client_id = c.id
  AND d.status IN ('waiting','assigned');
