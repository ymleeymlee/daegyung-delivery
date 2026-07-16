# 대경배송시스템 — 프로젝트 히스토리 (요청 시에만 열람)

## 스택 / 위치
- 웹: `~/Desktop/daegyung-delivery` — Next.js16(App Router,Turbopack)·React19·TS·Tailwind4·Supabase·Vercel. main=운영, daegyung-delivery.vercel.app, github.com/ymleeymlee/daegyung-delivery. (Next16 브레이킹多 → `node_modules/next/dist/docs` 참고)
- 앱: `~/Desktop/daegyung-rider-app` — Kotlin·Compose·supabase-kt. 라이더 위치추적 생산자(키오스크폰). APK는 웹 `/rider-app`에서 다운로드 배포.
- 안드로이드 툴체인(홈 직접설치): `JAVA_HOME=~/android-tools/jdk17/Contents/Home`, SDK `~/android-tools/sdk`. 빌드 `./gradlew :app:assembleDebug`.

## 도메인
- 페이지: 배송보드(/)·고품(/gopoum)·실시간위치(/tracking). 마감 시 Google Sheets(배송/고품/위치-MM) 기록 후 DB 정리. 리포트는 이메일 아닌 **Google Sheets 방식으로 운영**(이메일 cron 제거됨).
- DB(Supabase, RLS off·anon key): clients·riders·deliveries·gopoum_*·app_state·rider_locations·location_pings·delivery_trips.
- 위치추적: 앱이 5초마다 rider_locations upsert + location_pings insert. 지오펜스(app_state)로 본사이탈=배송출발/복귀=완료 → 폰 알람 + delivery_trips + 웹 토스트. /tracking: 동선·5분마크·아카이브·본사위치 지도설정·반경 10~300m.

## 관례
- 커밋/푸시 묻지 말고 바로 main. gh CLI(`/tmp` 휘발성) credential 깨지면 `git config --global --unset-all credential.https://github.com.helper` 후 osxkeychain으로 push.
- 검증 `npx tsc --noEmit`. Supabase DDL은 관리 API(`api.supabase.com/v1/projects/edhfiqeklkpmjzevsquw/database/query` + PAT)로 실행 가능.

## 이번 세션 완료
- 최신 APK(진단패널판) → `public/rider-app.apk` 배포 + Vercel 반영 확인(200/20MB).
- Supabase `update_12.sql`·`update_13.sql` 실행 완료 → rider_locations/location_pings/delivery_trips 테이블 생성 확인.
- 이메일 리포트 불필요 판단 → `/api/daily-report` cron 제거(Google Sheets로 운영).
- Google `위치-MM` 시트 생성 완료(사용자).

## 다음 할 일 / 미해결
- 폰에 최신 APK 재설치(`/rider-app`에서 다운로드).
- 실기기 알람 미수신 디버깅: 진단패널 거리/정확도 확인, 반경 < GPS정확도면 INSIDE 인식X → 반경 키우기.
- 미완: ETA(카카오모빌리티 REST키 발급됨, deliveries.dest_lat/lng/eta_seconds 필드 준비됨). 목적지 설정 방식 미정.

## 최근 커밋 3
14d7f89 이메일 리포트 cron 제거(Sheets 운영) / b27ac09 라이더앱 최신 APK 배포(진단패널+테스트알람) / 2494898 vim 스왑파일 제거 + *.swp gitignore
