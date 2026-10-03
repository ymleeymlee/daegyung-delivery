-- 라이더 앱 egress 절감: 배송 row 에 '이 거래처의 남은 고품 수량' 스냅샷을 직접 두어
-- 라이더 앱이 매 10초마다 전체 gopoum 테이블을 조회하던 폴링을 제거한다.
-- 트리거가 자동 유지하므로 웹/앱 모두 특별한 처리 없이 'deliveries.gopoum_count' 를 그냥 읽으면 된다.

-- 1) 컬럼 추가 (기본 0)
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS gopoum_count integer NOT NULL DEFAULT 0;

-- 2) 거래처 코드+지점 기준 '남은 고품 수량' 계산 유틸.
--    gopoum_items 는 branch 를 직접 안 가짐 — gopoum_clients 를 거쳐 code+branch 로 조회.
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
    AND gc.client_code = p_code
    AND gc.branch = p_branch;
$$;

-- 3) 배송 생성 시: 초기 gopoum_count 를 채운다.
CREATE OR REPLACE FUNCTION fill_delivery_gopoum_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code text;
BEGIN
  IF NEW.client_id IS NOT NULL AND NEW.branch IS NOT NULL THEN
    SELECT code INTO v_code FROM clients WHERE id = NEW.client_id;
    IF v_code IS NOT NULL THEN
      NEW.gopoum_count := calc_gopoum_remaining(v_code, NEW.branch);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deliveries_fill_gopoum_count ON deliveries;
CREATE TRIGGER deliveries_fill_gopoum_count
BEFORE INSERT ON deliveries
FOR EACH ROW EXECUTE FUNCTION fill_delivery_gopoum_count();

-- 4) 고품 변경 시: 그 거래처(code+branch) 의 활성 배송들 gopoum_count 를 재계산해 UPDATE.
CREATE OR REPLACE FUNCTION sync_delivery_gopoum_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_code text;
  v_branch text;
  v_remaining integer;
BEGIN
  -- 삭제면 OLD, 그 외는 NEW 의 gopoum_client_id 로 code+branch 조회
  SELECT client_code, branch INTO v_code, v_branch
  FROM gopoum_clients
  WHERE id = COALESCE(NEW.gopoum_client_id, OLD.gopoum_client_id);
  IF v_code IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  v_remaining := calc_gopoum_remaining(v_code, v_branch);

  UPDATE deliveries d
  SET gopoum_count = v_remaining
  FROM clients c
  WHERE d.client_id = c.id
    AND c.code = v_code
    AND d.branch = v_branch
    AND d.status IN ('waiting','assigned')
    AND COALESCE(d.gopoum_count, -1) <> v_remaining; -- no-op 쓰기 방지

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS gopoum_items_sync_delivery ON gopoum_items;
CREATE TRIGGER gopoum_items_sync_delivery
AFTER INSERT OR UPDATE OR DELETE ON gopoum_items
FOR EACH ROW EXECUTE FUNCTION sync_delivery_gopoum_count();

-- 5) 기존 활성 배송(waiting/assigned) 백필
UPDATE deliveries d
SET gopoum_count = calc_gopoum_remaining(c.code, d.branch)
FROM clients c
WHERE d.client_id = c.id
  AND d.status IN ('waiting','assigned');
