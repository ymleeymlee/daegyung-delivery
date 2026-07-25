-- 앱(폰)에서 만든 배송카드가 branch 없이 저장되어 기본값 'as'로 들어간 것을 보정.
-- 범위 한정: 오늘 아직 진행 중인(waiting/assigned) 배송만. completed/과거 기록은 건드리지 않음.
update deliveries d
set branch = r.location
from riders r
where d.rider_id = r.id
  and d.status in ('waiting', 'assigned')
  and d.branch is distinct from r.location;
