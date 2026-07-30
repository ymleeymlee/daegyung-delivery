# 대경배송시스템(웹) — 프로젝트 히스토리 (요청 시에만 열람)

## 스택 / 위치
- 웹: `~/Desktop/daegyung-delivery` — Next16·React19·TS·Tailwind4·Supabase·Vercel. main=자동배포. github.com/ymleeymlee.
- 앱: `~/Desktop/daegyung-rider-app` — Kotlin. APK는 웹 public/rider-app.apk로 복사·커밋→배포.

## 관례 / 인프라 주의
- **작업 완료(검증) 시 확인 없이 자동 배포**. 검증 `npx tsc --noEmit`.
- **DB 마이그레이션 SQL은 내가 직접 실행**(확인 없이). 토큰은 macOS 키체인 `ck-daegyung-supabase`에서 `$(security find-generic-password -s ck-daegyung-supabase -w)`로 읽어 씀(값을 대화에 노출 금지). ref=`edhfiqeklkpmjzevsquw`, Supabase Management API `POST /v1/projects/<ref>/database/query`. 응답 `[]`=성공.
- 구글시트 인증은 파일이 아니라 `.env.local`의 `GOOGLE_SERVICE_ACCOUNT_B64`(base64 서비스계정). 쓰이지 않던 중복 사본 `gcp-key.json`은 2026-07-30 삭제.
- Supabase RLS off, anon 키로 앱/웹 직접 write. 업체번호(clients.code)는 4자리 고정폭.
- **앱이 deliveries 등 공유 테이블에 직접 insert** → 웹에 컬럼 추가 시 앱(`RiderRepository.kt`/`Models.kt`)도 반드시 같이 수정.

## 이번 세션 완료 (지점 분리 = 강남/안산)
- `branches` 테이블 신설(code/label/sort_order) + `/branches` 지점 관리 페이지. Nav에 지점 드롭다운(URL 쿼리+localStorage), 전역 필터.
- `clients`·`deliveries`·`gopoum_clients`에 branch 컬럼(기존 전부 'as'). app_state 창고좌표는 `warehouse_lat__gn` 식 지점별 키. 마이그레이션 update_17/18 실행 완료.
- 전 화면(배송보드·거래처·라이더·위치추적·기록·고품·검색) branch 필터 적용. 라이더 6명 전원 'gn'으로 지정.
- **구글시트 지점별 기록**: `findFolder('2026')`가 전체검색이라 안산/강남 중 한쪽만 갱신되던 버그 수정 → 연도폴더를 지점폴더 하위로 한정. 업데이트 1회로 `안산/2026`·`강남/2026` 동시 기록(실측 `{"ok":true,"updated":["안산","강남"]}`). 마감(close)도 동일 적용.
- 발견·수정한 버그: 거래처 엑셀 **일괄교체 시 전 지점 삭제**되던 버그, 앱 배송카드가 branch 없이 저장돼 웹에서 안 보이던 버그.

## 다음 할 일
- 라이더 폰에 **APK v1.3 재설치** 후 음성검색 마이크 권한 허용 → 인식률 확인(임계값 0.55 조정 여부).
- 오늘밤 23:59 마감이 지점별로 정상 기록되는지 확인(양쪽 폴더 탭 생성).
- 미처리: `dailyReport.ts`·`sheetSnapshot.ts`는 아직 'gn'/'as' 하드코딩 — 지점 추가 시 수동 반영 필요.

## 최근 커밋 3
- 75275ad 새 APK v1.3(마이크 권한) / a3e5bdf 새 APK v1.2(음성 업체검색) / 3a16c9e 새 APK(앱 창고좌표·업체검색 지점 반영)
