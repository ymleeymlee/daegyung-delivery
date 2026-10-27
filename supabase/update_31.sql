-- 고품 마감 이력 정리 (1회). 자정 정리가 이제 수거완료 품목을 시트 저장 후 삭제하므로
-- 그동안 archived_at 만 찍혀 누적된 이력(1000행 조회 한도 초과 원인)을 제거한다.
-- 백업: ~/daegyung-backups/gopoum_items_archived_2026-10-27.json (804건)

-- 1) 마감(archived) 품목 삭제
DELETE FROM gopoum_items WHERE archived_at IS NOT NULL;

-- 2) 품목이 하나도 없는 고품 업체 삭제
DELETE FROM gopoum_clients c
WHERE NOT EXISTS (SELECT 1 FROM gopoum_items i WHERE i.gopoum_client_id = c.id);
