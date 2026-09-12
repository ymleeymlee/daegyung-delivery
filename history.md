# 대경배송시스템(웹) — 프로젝트 히스토리 (요청 시 열람)

## 스택 / 위치
- 웹: `~/Desktop/daegyung-delivery` — Next16·React19·TS·Tailwind4·Supabase·Vercel(Hobby=크론 1개/일).
- 앱: `~/Desktop/daegyung-rider-app` — Kotlin. `./gradlew :app:deployApk` 로 APK + rider-app.json 을 이 폴더 public/ 로 자동 복사.

## 관례 / 인프라
- 검증 `npx tsc --noEmit`. main 푸시 시 Vercel 자동 배포. RLS off, anon 키. 지점: as·gn.
- Supabase Management API: `security find-generic-password -s ck-daegyung-supabase -w`. ref=`edhfiqeklkpmjzevsquw`.
- 시트: 지점/카테고리/YY-MM 스프레드시트, 탭 MM-DD. 서비스계정 → OAuth 위임(custom.my.car.official@gmail.com).

## 자동 수행 매트릭스 (app_state.auto_actions)
- 6항목(sheet_update/location_share_off/delivery_create_block/delivery_reset/gopoum_reset/location_log_purge) × 2트리거(close/midnight).
- 마감 트리거 = `business_close_time`(전역). 지점별 open/close 제거됨(레거시).
- `today_first_connected_at` 초기화는 `delivery_reset` 에만 (마감/자정 로그아웃 자체는 유지 → 카드에 출근시간·색상 남음).

## 인앱 자동 업데이트 (v1.10.4~)
- 배포: `cd daegyung-rider-app && ./gradlew :app:deployApk` → APK 교체 + public/rider-app.json 갱신 → 웹 커밋·push.
- Nav 가 /rider-app.json 을 읽어 `latest_app_version`/`latest_app_apk_url` 을 Supabase 에 자동 upsert (수동 입력 없음).
- 앱 실행 시 최신 버전 팝업 → [지금 업데이트] → DownloadManager + FileProvider 로 설치. `min_app_version` 은 강제 게이팅(별개).

## 최근 UI/기능 개편
- 배송현황 완료 카드: `returned_at` 완료된 것만 완료섹션, `arrived_at` 오름차순(아래로 쌓임). 라이더 이름 옆 무지개 15색 뱃지(오늘 출근 순).
- 실시간 위치: 아래 뾰족한 핀 마커 · 라이더별 색상 통일(마커·동선·시작·5분마킹). 라이더 클릭 → 마지막 회차만 자동 표시. isLive="오늘"만으로 판정.
- 마감 상태: 패널 헤더 "운행마감", 🚚 배송출발 뱃지·진행중 라벨·토스트 숨김.
- 설정: 배송지 도착 반경 슬라이더(10~200m, 기본 50), 영업시간 저장 시 지금이 영업중이면 closed_until 자동 해제 + [자동마감 해제] 버튼.

## 다음 할 일
- 실제 배포 후 라이더 폰 10대 v1.10.5 부트스트랩(한번만 수동 설치) → 이후 자동 업데이트 자동화.
- Vercel Hobby 크론 하루 1회 제한 이슈 원인 파악(로그는 유료).
- location_pings 대량 삭제(마감 시) 성능 확인.

## 최근 커밋 3
- 4ef95fa 앱 배포 자동화: /rider-app.json → Supabase 자동 동기화
- 02a03d0 APK v1.10.5 교체 (전역 영업시간만 신뢰)
- 0c3d41f settings: 영업시간 변경 시 closed_until 자동 해제 + [자동마감 해제] 버튼
