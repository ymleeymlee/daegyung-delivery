-- 배송지 도착 감지/완료 시각 + 업체 좌표 사전 지오코딩
-- deliveries.arrived_at: 라이더가 배송지 반경 진입한 시각(카드에 "도착" 표시). 이탈 시 status=completed.
alter table deliveries add column if not exists arrived_at timestamptz;

-- clients.lat/lng: 업체 등록 시 웹에서 카카오로 1회 지오코딩해 보관. 배송 생성 시 dest_lat/lng 로 복사.
alter table clients add column if not exists lat double precision;
alter table clients add column if not exists lng double precision;
