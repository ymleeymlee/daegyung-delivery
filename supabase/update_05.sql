-- gopoum_clients에 started_at 컬럼 추가 (수량이 1 이상이 된 시각)
alter table gopoum_clients add column if not exists started_at timestamptz;

-- 기존 데이터: total_quantity > 0인 행은 created_at을 started_at으로 초기화
update gopoum_clients set started_at = created_at where total_quantity > 0 and started_at is null;
