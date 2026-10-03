-- 업체코드 포맷 불일치 수정: clients.code 는 "413" 처럼 자리수가 부족한 경우가 있고
-- gopoum_clients.client_code 는 "0413" 으로 4자리 정규화돼 있어 정확일치 조인이 실패했다.
-- 두 유틸 함수에서 양쪽 코드를 모두 정규화(숫자면 4자리 zero-pad)해서 비교하도록 수정.

-- calc_gopoum_remaining: 양쪽 정규화 후 비교
CREATE OR REPLACE FUNCTION calc_gopoum_remaining(p_code text, p_branch text)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(GREATEST(
    0,
    COALESCE(gi.quantity, 1) - COALESCE((
      SELECT SUM((c->>'quantity')::int)
      FROM jsonb_array_elements(COALESCE(gi.collectors, '[]'::jsonb)) c
    ), 0)
  )), 0)::integer
  FROM gopoum_items gi
  JOIN gopoum_clients gc ON gc.id = gi.gopoum_client_id
  WHERE gi.archived_at IS NULL
    AND (CASE WHEN gc.client_code ~ '^[0-9]+$' THEN lpad(gc.client_code, 4, '0') ELSE gc.client_code END)
      = (CASE WHEN p_code ~ '^[0-9]+$' THEN lpad(p_code, 4, '0') ELSE p_code END)
    AND gc.branch = p_branch;
$$;

-- calc_gopoum_cars: 동일 정규화
CREATE OR REPLACE FUNCTION calc_gopoum_cars(p_code text, p_branch text)
RETURNS text LANGUAGE sql STABLE AS $$
  WITH remaining AS (
    SELECT COALESCE(NULLIF(TRIM(gi.car_type), ''), '차종모름') AS car
    FROM gopoum_items gi
    JOIN gopoum_clients gc ON gc.id = gi.gopoum_client_id
    WHERE gi.archived_at IS NULL
      AND (CASE WHEN gc.client_code ~ '^[0-9]+$' THEN lpad(gc.client_code, 4, '0') ELSE gc.client_code END)
        = (CASE WHEN p_code ~ '^[0-9]+$' THEN lpad(p_code, 4, '0') ELSE p_code END)
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

-- sync_delivery_gopoum_count 트리거도 양쪽 코드 비교 — gopoum_clients 쪽 코드로 활성 배송 매칭.
-- (NEW/OLD 의 gopoum_client_id 로 code+branch 를 얻은 뒤, 그 code 와 매칭되는 clients 를 거쳐 deliveries 갱신)
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
    AND (CASE WHEN c.code ~ '^[0-9]+$' THEN lpad(c.code, 4, '0') ELSE c.code END)
      = (CASE WHEN v_code ~ '^[0-9]+$' THEN lpad(v_code, 4, '0') ELSE v_code END)
    AND d.branch = v_branch
    AND d.status IN ('waiting','assigned')
    AND (COALESCE(d.gopoum_count, -1) <> v_remaining OR COALESCE(d.gopoum_cars, '') <> v_cars);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 기존 active 배송 백필 재실행
UPDATE deliveries d
SET gopoum_count = calc_gopoum_remaining(c.code, d.branch),
    gopoum_cars  = calc_gopoum_cars(c.code, d.branch)
FROM clients c
WHERE d.client_id = c.id
  AND d.status IN ('waiting','assigned');
