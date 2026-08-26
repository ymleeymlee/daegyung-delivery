# 대경배송시스템(웹) — 프로젝트 히스토리 (요청 시 열람)

## 스택 / 위치
- 웹: `~/Desktop/daegyung-delivery` — Next16·React19·TS·Tailwind4·Supabase·Vercel(main 자동배포, Hobby=크론 하루 1회).
- 앱: `~/Desktop/daegyung-rider-app` — Kotlin. APK는 웹 public/rider-app.apk로 복사·커밋→배포.

## 관례 / 인프라
- 작업 완료(검증) 시 자동 배포. 검증 `npx tsc --noEmit`.
- Supabase Management API로 SQL 직접 실행. 토큰 `security find-generic-password -s ck-daegyung-supabase -w`. ref=`edhfiqeklkpmjzevsquw`. 응답 `[]`=성공.
- RLS off, anon 키로 앱/웹 직접 write. 지점: gn(강남)·as(안산).

## 라이더 관리 흐름 대개편 (v1.9~)
- `/riders` 페이지 삭제. 배송보드 카드가 곧 라이더 관리 UI(이름·전화·기기ID + 삭제 버튼 + 미접속 회색).
- 소스: `rider_devices` (name/phone/branch/connected/last_connected_at/today_first_connected_at/app_version). deliveries.rider_id FK 유지 위해 riders auto-upsert(phone 유니크 partial index).
- 배송보드: 카드에 이름(큰 폰트) · 전화(nnn-nnnn-nnnn 포맷) · 기기ID · 출근시간(오늘 첫 접속) · 미접속/배정불가 뱃지 · 진행중/완료 divider 분리.
- 시트 스냅샷(close/update-sheets/dailyReport): 오늘 출근한 라이더(`today_first_connected_at`) + 최소 앱 버전 이상 기기만 표시. 미지정 pings 제외.

## 서버사이드 버전 게이트 (v1.9.9~)
- `app_state.min_app_version` (현재 "1.10.0"). 앱이 upsert 시 실은 `rider_devices.app_version`과 비교.
- 미달 기기는 배송보드·tracking에서 아예 숨김. tracking은 추가로 connected=true만 표시.

## 다음 할 일
- 어제(08-25) 22:00 마감 크론 skip 이력. 잔재 2건 삭제 여부 결정. Vercel Cron Jobs 실행 로그 확인(사용자).
- branches close_time 임시값 원복(gn 18:30, as 18:00). 지금 둘 다 23:59.

## 최근 커밋 3
- 0e99cfe 새 APK v1.10.0
- 133859e 새 APK v1.9.9 + 미달 버전 앱은 배송보드·tracking 에서 아예 숨김
- f8bf124 새 APK v1.9.8 + tracking 에서 connected=false 숨김
