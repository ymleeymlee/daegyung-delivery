# 대경배송시스템(웹) — 프로젝트 히스토리 (요청 시 열람)

## 스택 / 위치
- 웹: `~/Desktop/daegyung-delivery` — Next16·React19·TS·Tailwind4·Supabase·Vercel(main 자동배포, Hobby=크론 하루 1개).
- 앱: `~/Desktop/daegyung-rider-app` — Kotlin. APK는 웹 public/rider-app.apk로 복사·커밋→배포.

## 관례 / 인프라
- 검증 `npx tsc --noEmit`. main 푸시 시 Vercel 자동 배포.
- Supabase Management API: 토큰 `security find-generic-password -s ck-daegyung-supabase -w`. ref=`edhfiqeklkpmjzevsquw`. 응답 `[]`=성공.
- Vercel API: 토큰 `security find-generic-password -s ck-vercel -w` (env 등록·배포 상태 조회 가능).
- RLS off, anon 키로 앱/웹 직접 write. 지점: as(안산)·gn(강남).

## 시트 저장 구조 (2026-09-07 개편)
- 지점/카테고리/YY-MM 스프레드시트, 탭은 MM-DD. 예: `안산/배송/26-09` 파일의 `09-08` 탭.
- 서비스계정 → **OAuth 위임** 으로 전환 (custom.my.car.official@gmail.com 계정의 15GB 사용). 서비스계정은 Drive 저장 용량 0 이라 파일 생성 시 quota 초과.
- Vercel env: `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`/`_REFRESH_TOKEN`. `GOOGLE_SERVICE_ACCOUNT_B64` 은 롤백 대비로 남김.
- 자동 파일/폴더 생성: `googleSheets.ts`의 `findDoc(..., {autoCreate:true})`.

## 자동 수행 시스템 (2026-09-08 신규)
- app_state.auto_actions JSON — 6개 항목(sheet_update/location_share_off/delivery_create_block/delivery_reset/gopoum_reset/location_log_purge) × 2트리거(close/midnight) 매트릭스.
- 트리거: (1) 마감 = `business_close_time` 기준. 크론 22:00 KST + 클라이언트 트리거 `/api/close-check` (Nav 마다 호출, 서버가 `last_close_reset_date` 로 하루 1회만 실행). (2) 00시 = `/api/midnight-check` (Nav 마다 호출, `last_midnight_reset_date` idempotency).
- 전역 영업시간: `business_open_time`/`business_close_time` (기본 08:00/18:00). 지점별 open/close 제거됨.

## 설정 페이지 (`/settings`)
- 톱니 아이콘 진입, 관리자 비밀번호 게이트(app_state.admin_password, 기본 1234). 나가면 잠금 초기화.
- 카드: 시트 업데이트 / 영업 시간(전역) / 지점 관리(코드·이름·정렬만, 시간 열 제거) / 자동 수행 매트릭스 / 비밀번호 변경.

## 다음 할 일
- 이용문 폰 등 v1.9.7 이전 앱 웹 표시 문제(app_version=null) 재확인.
- tracking 페이지 지점 변경 시 Chrome 렌더러 크래시("This page couldn't load") — 채널명/맵/오버레이 정리 3건 적용했지만 여전히 재현. DevTools 콘솔 로그 필요.
- 이번 달 자동 생성된 시트(안산·강남 × 배송·고품·위치 × 26-09) 실제 파일 확인.

## 최근 커밋 3
- 9975032 UI: 본사 버튼 원복 + 품목 표기 '총/타' → '잔여 N'
- 53f4114 tracking: 본사 버튼에 주소 표시 + '위치 변경' → '설정' 팝업 개편
- 164d8f5 설정 영업시간: uncontrolled → controlled input (저장/표시 유실 수정)
