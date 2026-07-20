-- 시간 용어 통일: 배송출발/배송완료/본사복귀
-- deliveries.departed_at: 배송출발(본사 이탈) 시각. 앱이 지오펜스 이탈 시 그 라이더의 진행 배송들에 기록.
-- deliveries.returned_at: 본사복귀(본사 도착) 시각. 앱이 지오펜스 진입 시 그 라이더의 완료 배송들에 기록.
-- (배정=assigned_at, 배송완료=arrived_at 는 기존 컬럼 재사용)
alter table deliveries add column if not exists departed_at timestamptz;
alter table deliveries add column if not exists returned_at timestamptz;
