-- 거래처 그룹(행정동) 컬럼 추가. 좌표(lat,lng) 기반 카카오 coord2RegionCode 로 채움.
-- 예) 상록구 부곡동 → region='부곡동'.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS region text;
