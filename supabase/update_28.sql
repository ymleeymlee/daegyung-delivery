-- 주변 고품: 같은 region(법정동) + branch 안의 다른 거래처들의 활성 고품 품목.
-- 라이더가 자기 배송 거점으로 가는 길에 함께 수거할 수 있도록 뱃지와 수거 UI 를 제공한다.

-- 1) 컬럼 추가
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS nearby_gopoum_count integer NOT NULL DEFAULT 0;

-- 2) 특정 (client_id, branch) 에 해당하는 '주변' 고품의 남은 수량 합 계산.
--    같은 region/branch 의 다른 거래처(코드 다름)들의 활성 품목 remaining 합산.
CREATE OR REPLACE FUNCTION calc_nearby_gopoum_count_for(p_client_id uuid, p_branch text)
RETURNS integer LANGUAGE sql STABLE AS $$
  WITH self AS (
    SELECT c.region, c.code AS self_code
    FROM clients c
    WHERE c.id = p_client_id
  )
  SELECT COALESCE(SUM(GREATEST(
    0,
    COALESCE(gi.quantity, 1) - COALESCE((
      SELECT SUM((c->>'quantity')::int)
      FROM jsonb_array_elements(COALESCE(gi.collectors, '[]'::jsonb)) c
    ), 0)
  )), 0)::integer
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

-- 3) 배송 생성 시 nearby_gopoum_count 도 함께 채움 (기존 트리거 확장)
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
    NEW.nearby_gopoum_count := calc_nearby_gopoum_count_for(NEW.client_id, NEW.branch);
  END IF;
  RETURN NEW;
END;
$$;

-- 4) 고품 변경 시: 자기 거래처의 활성 배송(gopoum_count/cars) + 같은 region 의 모든 활성 배송(nearby_gopoum_count) 갱신.
CREATE OR REPLACE FUNCTION sync_delivery_gopoum_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code text;
  v_branch text;
  v_remaining integer;
  v_cars text;
  v_region text;
BEGIN
  SELECT client_code, branch INTO v_code, v_branch
  FROM gopoum_clients
  WHERE id = COALESCE(NEW.gopoum_client_id, OLD.gopoum_client_id);
  IF v_code IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  v_remaining := calc_gopoum_remaining(v_code, v_branch);
  v_cars := calc_gopoum_cars(v_code, v_branch);

  -- (a) 자기 거래처 활성 배송의 gopoum_count/cars
  UPDATE deliveries d
  SET gopoum_count = v_remaining,
      gopoum_cars = v_cars
  FROM clients c
  WHERE d.client_id = c.id
    AND (CASE WHEN c.code ~ '^[0-9]+$' THEN lpad(c.code, 4, '0') ELSE c.code END)
      = (CASE WHEN v_code ~ '^[0-9]+$' THEN lpad(v_code, 4, '0') ELSE v_code END)
    AND d.branch = v_branch
    AND d.status IN ('waiting','assigned')
    AND (COALESCE(d.gopoum_count, -1) <> v_remaining OR COALESCE(d.gopoum_cars, '') <> v_cars);

  -- (b) 같은 region 의 모든 활성 배송의 nearby_gopoum_count
  SELECT c.region INTO v_region
  FROM clients c
  WHERE c.branch = v_branch
    AND (CASE WHEN c.code ~ '^[0-9]+$' THEN lpad(c.code, 4, '0') ELSE c.code END)
      = (CASE WHEN v_code ~ '^[0-9]+$' THEN lpad(v_code, 4, '0') ELSE v_code END)
  LIMIT 1;

  IF v_region IS NOT NULL THEN
    UPDATE deliveries d
    SET nearby_gopoum_count = calc_nearby_gopoum_count_for(d.client_id, d.branch)
    FROM clients c
    WHERE d.client_id = c.id
      AND c.region = v_region
      AND d.branch = v_branch
      AND d.status IN ('waiting','assigned');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5) 주변 고품 품목 조회 RPC — client 정보 포함, 거래처명·생성시간 정렬.
CREATE OR REPLACE FUNCTION nearby_gopoum_items_for_delivery(p_delivery_id uuid)
RETURNS TABLE (
  id uuid,
  description text,
  car_type text,
  note text,
  quantity integer,
  collectors jsonb,
  created_at timestamptz,
  gopoum_client_id uuid,
  client_code text,
  client_name text
) LANGUAGE sql STABLE AS $$
  WITH self AS (
    SELECT c.region, c.code AS self_code, d.branch
    FROM deliveries d
    JOIN clients c ON c.id = d.client_id
    WHERE d.id = p_delivery_id
  )
  SELECT gi.id, gi.description, gi.car_type, gi.note, gi.quantity, gi.collectors, gi.created_at, gi.gopoum_client_id,
         gc.client_code, gc.client_name
  FROM gopoum_items gi
  JOIN gopoum_clients gc ON gc.id = gi.gopoum_client_id
  JOIN clients c_near ON c_near.branch = gc.branch
    AND (CASE WHEN c_near.code ~ '^[0-9]+$' THEN lpad(c_near.code, 4, '0') ELSE c_near.code END)
     = (CASE WHEN gc.client_code ~ '^[0-9]+$' THEN lpad(gc.client_code, 4, '0') ELSE gc.client_code END)
  CROSS JOIN self
  WHERE gi.archived_at IS NULL
    AND gc.branch = self.branch
    AND c_near.region = self.region
    AND self.region IS NOT NULL
    AND (CASE WHEN c_near.code ~ '^[0-9]+$' THEN lpad(c_near.code, 4, '0') ELSE c_near.code END)
     <> (CASE WHEN self.self_code ~ '^[0-9]+$' THEN lpad(self.self_code, 4, '0') ELSE self.self_code END)
  ORDER BY gc.client_name, gi.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION nearby_gopoum_items_for_delivery(uuid) TO anon, authenticated;

-- 6) 기존 active 배송 백필
UPDATE deliveries d
SET nearby_gopoum_count = calc_nearby_gopoum_count_for(d.client_id, d.branch)
WHERE d.status IN ('waiting','assigned');
