-- 지점 분리 후 옛 전역 창고 좌표 키 제거 (앱/웹 모두 지점별 키만 사용).
DELETE FROM app_state WHERE key IN ('warehouse_lat', 'warehouse_lng', 'geofence_radius_m');
