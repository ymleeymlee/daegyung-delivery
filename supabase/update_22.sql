-- 고품 아이템에 차종 컬럼 추가. 선택 입력, null 이면 UI 에서 '차종모름' 표기.
ALTER TABLE gopoum_items
  ADD COLUMN IF NOT EXISTS car_type text;
