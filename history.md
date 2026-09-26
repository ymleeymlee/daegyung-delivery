# 대경배송시스템(웹) — 프로젝트 히스토리 (요청 시 열람)

## 스택 / 위치
- 웹: `~/Desktop/daegyung-delivery` — Next16·React19·TS·Tailwind4·Supabase·Vercel(Hobby=크론 1개/일).
- 앱: `~/Desktop/daegyung-rider-app` — Kotlin. `./gradlew :app:deployApk` 로 APK + rider-app.json 을 이 폴더 public/ 로 자동 복사.

## 관례 / 인프라
- 검증 `npx tsc --noEmit`. main 푸시 시 Vercel 자동 배포. RLS off, anon 키. 지점: as·gn.
- Supabase Management API: `security find-generic-password -s ck-daegyung-supabase -w`. ref=`edhfiqeklkpmjzevsquw`.
- Vercel 크론: 매일 00:05 KST `/api/midnight-check` (하나). 마감(close)은 웹 열림 시 매분 `/api/close-check` 로 처리.

## 시트 정책 (2026-09-26 개편)
- 루트 폴더 `대경배달기록/` (관리자 수동 생성) 안에 파일 나열.
- 파일: `{branchCode}_{cat}_{year}` — cat = dlv/rec/pos/und (배송·고품·위치·지하위치).
- 탭: `MM_DD` (일별). 지하위치만 탭 `all` 하나에 년도 내 누적 (업체번호 upsert).
- 지점별 병렬 저장 (`Promise.allSettled`) — Vercel 60s timeout 방지.
- OAuth: `dk_web` 웹 클라이언트(프로덕션 게시)로 refresh_token 만료 없음.

## 자동수행 매트릭스 (auto_actions)
- 8항목 × 2트리거(close/midnight). 매트릭스 헤더에 안내:
  - 마감: '마감시간에 웹이 열려있어야만 진행'
  - 다음날: '운영과 상관없이 항상 진행'
- 신규: `finalize_pending`(진행중 배송 완료 처리), `app_auto_logout`(라이더 앱 자동 퇴근, close/midnight 트리거로 앱이 폴링 판정).

## 배송현황 UI 최신
- 배송카드: 시각 4단계(카드생성/배송출발/배송완료/본사복귀) 가로 2줄 표시. '진행중' 애니메이션 화살표 버튼(팝업 없음). 시각 클릭 시 취소 팝업.
- 메모 인라인 편집(uncontrolled input, IME 안전). 노란 박스 pill.
- 완료(returned_at 있음) 카드만 접힘 기본, 나머지는 항상 확장.
- 라이더 헤더: [총배송 · 현재배송중] / [총거리(nn m, 30초 폴링 haversine)].
- 구버전 폰 = UI 상 미접속 취급, 배지 '구버전'.
- 거래처 관리: 주소 옆 카카오맵 링크 좌표 표시.

## 다음 할 일
- 안산 라이더 폰들 v2.0.13 수동 부트스트랩 (현재 v1.10.2, min_app_version=2.0.7 미달).
- 지하위치 시트 데이터 축적 후 반복 업체는 클라이언트 좌표를 지상 입구로 재세팅.
- 라이더 앱 지하 자동완료(신호 소실 후 이탈 감지) 구현 검토.

## 최근 커밋 3
- 82e5af9 시트 정책 개편: 대경배달기록/{code}_{cat}_{year} + 지점별 병렬 저장
- 9be7049 라이더 카드 헤더: 총거리와 현재 배송중 위치 스왑
- b88e525 거래처 좌표 표시 + 지하위치 시트 자동 갱신 + 배송현황 총 거리
