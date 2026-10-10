-- 뱃지 분자를 '이 배송카드가 수거한 양' 으로 변경하기 위한 컬럼/함수/트리거 확장.
-- X = gopoum_mine_count (이 delivery_id 로 수거된 양)
-- Y = X + gopoum_count (내 수거 + 남음)

-- 1) 컬럼 추가
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS gopoum_mine_count integer NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS nearby_gopoum_mine_count integer NOT NULL DEFAULT 0;

-- 2) 이 배송카드로 자기 거래처 품목에서 수거한 양
CREATE OR REPLACE FUNCTION calc_gopoum_mine_for(p_delivery_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(COALESCE((
    SELECT SUM((c->>'quantity')::int)
    FROM jsonb_array_elements(COALESCE(gi.collectors, '[]'::jsonb)) c
    WHERE c->>'delivery_id' = p_delivery_id::text
  ), 0)), 0)::integer
  FROM gopoum_items gi
  JOIN gopoum_clients gc ON gc.id = gi.gopoum_client_id
  JOIN deliveries d ON d.id = p_delivery_id
  JOIN clients c_self ON c_self.id = d.client_id
  WHERE gi.archived_at IS NULL
    AND gc.branch = d.branch
    AND (CASE WHEN gc.client_code ~ '^[0-9]+$' THEN lpad(gc.client_code, 4, '0') ELSE gc.client_code END)
      = (CASE WHEN c_self.code ~ '^[0-9]+$' THEN lpad(c_self.code, 4, '0') ELSE c_self.code END);
$$;

-- 3) 이 배송카드로 주변(다른 거래처) 품목에서 수거한 양
CREATE OR REPLACE FUNCTION calc_nearby_gopoum_mine_for(p_delivery_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  WITH self AS (
    SELECT c.region, c.code AS self_code, d.branch
    FROM deliveries d
    JOIN clients c ON c.id = d.client_id
    WHERE d.id = p_delivery_id
  )
  SELECT COALESCE(SUM(COALESCE((
    SELECT SUM((c->>'quantity')::int)
    FROM jsonb_array_elements(COALESCE(gi.collectors, '[]'::jsonb)) c
    WHERE c->>'delivery_id' = p_delivery_id::text
  ), 0)), 0)::integer
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
     <> (CASE WHEN self.self_code ~ '^[0-9]+$' THEN lpad(self.self_code, 4, '0') ELSE self.self_code END);
$$;

-- 4) 신규 배송은 당연히 아직 수거 없음 — fill 트리거는 기본 0 그대로 두면 됨 (명시 세팅 불필요).

-- 5) sync 트리거 확장: 자기 거래처 활성 배송 + 같은 region 활성 배송의 mine_count 모두 재계산
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

  -- (a) 자기 거래처 활성 배송 — count/cars/total + mine_count 재계산
  UPDATE deliveries d
  SET gopoum_count = v_remaining,
      gopoum_cars = v_cars,
      gopoum_total = v_total,
      gopoum_mine_count = calc_gopoum_mine_for(d.id)
  FROM clients c
  WHERE d.client_id = c.id
    AND (CASE WHEN c.code ~ '^[0-9]+$' THEN lpad(c.code, 4, '0') ELSE c.code END)
      = (CASE WHEN v_code ~ '^[0-9]+$' THEN lpad(v_code, 4, '0') ELSE v_code END)
    AND d.branch = v_branch
    AND d.status IN ('waiting','assigned');

  -- (b) 같은 region 활성 배송 — nearby_count/total + nearby_mine_count 재계산
  SELECT c.region INTO v_region
  FROM clients c
  WHERE c.branch = v_branch
    AND (CASE WHEN c.code ~ '^[0-9]+$' THEN lpad(c.code, 4, '0') ELSE c.code END)
      = (CASE WHEN v_code ~ '^[0-9]+$' THEN lpad(v_code, 4, '0') ELSE v_code END)
  LIMIT 1;

  IF v_region IS NOT NULL THEN
    UPDATE deliveries d
    SET nearby_gopoum_count = calc_nearby_gopoum_count_for(d.client_id, d.branch),
        nearby_gopoum_total = calc_nearby_gopoum_total_for(d.client_id, d.branch),
        nearby_gopoum_mine_count = calc_nearby_gopoum_mine_for(d.id)
    FROM clients c
    WHERE d.client_id = c.id
      AND c.region = v_region
      AND d.branch = v_branch
      AND d.status IN ('waiting','assigned');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 6) 기존 활성 배송 백필
UPDATE deliveries d
SET gopoum_mine_count = calc_gopoum_mine_for(d.id),
    nearby_gopoum_mine_count = calc_nearby_gopoum_mine_for(d.id)
WHERE d.status IN ('waiting','assigned');
