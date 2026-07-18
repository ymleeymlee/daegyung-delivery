# 대경배송시스템 — 프로젝트 히스토리 (요청 시에만 열람)

## 스택 / 위치
- 웹: `~/Desktop/daegyung-delivery` — Next.js16·React19·TS·Tailwind4·Supabase·Vercel. main=운영 자동배포, github.com/ymleeymlee/daegyung-delivery.
- 앱: `~/Desktop/daegyung-rider-app` — Kotlin·Compose. APK는 웹 `/rider-app`(public/rider-app.apk)에서 다운로드.

## 도메인
- 페이지: 배송보드(/)·고품(/gopoum)·실시간위치(/tracking)·라이더관리(/riders). 마감 시 Google Sheets 기록 후 DB 정리.
- 위치추적: 기기(device_id) 기반. 앱이 rider_locations upsert·location_pings insert. /riders에서 device_id↔rider 매핑.
- 시트: 마감 시 `위치-MM` 문서의 `MM-DD` 탭에 저장. buildLocationGrid가 라이더당 분당 1행으로 다운샘플.

## 관례
- 커밋/푸시 바로 main. Supabase DDL은 관리 API로 실행(PAT=accesstoken.md, gitignore). anon key는 공유 백엔드용(RLS off).
- 검증 `npx tsc --noEmit`. (Next16는 `next lint` 제거됨)

## 이번 세션 완료
- /tracking 동선 정제: location_pings 서버 1000행 상한 → range 페이지네이션 전량 수집(오후 동선 누락 해결). 정확도>40·스파이크(>33m/s) 제외 + 갭(>60s) 선끊기(renderPingsAsPath 다중 세그먼트). 이용문 실데이터로 7170m 텔레포트 제거 확인.
- 용량계산: Supabase 최악 15명 ~104MB/일(매일 삭제→안전), 시트는 분당1행이라 월문서가 셀한도(1000만)의 ~12%만 사용 → 문제없음.
- 데모: 가짜경로 주입(device_id `DEMO_FAKE_ROUTE`, 🧪가짜경로데모) — 필터 시연용.

## 다음 할 일 / 미해결
- 마감 시 location_pings 삭제 DELETE→TRUNCATE(공간 즉시 반환).
- 고품 스냅샷 불일치: 웹 배송보드는 "카드 생성시점 이전 고품만" 표시(DeliveryBoard.tsx:163), 앱은 현재 전량 → 통일 여부 결정.
- location-archive(과거일자) 경로도 1000행 상한·필터 동일 점검. 데모경로·PAT 재발급 정리.

## 최근 커밋 3
40b4424 동선 렌더 정제(페이지네이션+스파이크/갭 필터) / 2ec94ae 고품 디버그 제거 클린 APK 재배포 / a412c7c 고품 진단 디버그 APK 재배포
