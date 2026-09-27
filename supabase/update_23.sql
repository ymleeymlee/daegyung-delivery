-- 고품 업체 중복 병합 + 업체번호 4자리 zero-pad 정규화
-- 원인: 엑셀 파싱 시 숫자 셀이 앞 0 유실("0006"→"6"), 수동 입력은 그대로 → 같은 업체가 두 행으로 분리.
-- 조치: (branch, 정규화코드, name) 같은 그룹 내 최초 생성 업체를 canonical 로, 나머지 duplicate 의
--       gopoum_items 를 canonical 로 이관 후 duplicate 업체 삭제. 마지막으로 남은 canonical 의
--       숫자 코드를 4자리로 zero-pad. FK CASCADE 없이 안전하게 병합됨.

-- 1) 중복→canonical 매핑 산출
CREATE TEMP TABLE dup_map AS
WITH normalized AS (
  SELECT id, branch, client_name, created_at,
    CASE WHEN client_code ~ '^[0-9]+$' THEN LPAD(client_code, 4, '0') ELSE client_code END AS ncode
  FROM gopoum_clients
),
canonical AS (
  SELECT DISTINCT ON (branch, ncode, client_name)
    id, branch, ncode, client_name
  FROM normalized
  ORDER BY branch, ncode, client_name, created_at, id
)
SELECT n.id AS dup_id, c.id AS keep_id
FROM normalized n
JOIN canonical c
  ON n.branch = c.branch AND n.ncode = c.ncode AND n.client_name = c.client_name
WHERE n.id <> c.id;

-- 2) duplicate 아이템을 canonical 로 이관
UPDATE gopoum_items
SET gopoum_client_id = m.keep_id
FROM dup_map m
WHERE gopoum_items.gopoum_client_id = m.dup_id;

-- 3) 비워진 duplicate 업체 삭제
DELETE FROM gopoum_clients WHERE id IN (SELECT dup_id FROM dup_map);

DROP TABLE dup_map;

-- 4) 남은 업체번호 4자리 정규화 (숫자만)
UPDATE gopoum_clients
SET client_code = LPAD(client_code, 4, '0')
WHERE client_code ~ '^[0-9]+$' AND LENGTH(client_code) < 4;
