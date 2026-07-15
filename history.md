# 대경배송시스템 — 프로젝트 히스토리 (요청 시에만 열람)

## 스택 / 위치
- 웹: `~/Desktop/daegyung-delivery` — Next.js16(App Router,Turbopack)·React19·TS·Tailwind4·Supabase·Vercel. main=운영, daegyung-delivery.vercel.app, github.com/ymleeymlee/daegyung-delivery. (Next16 브레이킹多 → `node_modules/next/dist/docs` 참고)
- 앱: `~/Desktop/daegyung-rider-app` — Kotlin·Compose·supabase-kt. 라이더 위치추적 생산자(키오스크폰). APK는 웹 `/rider-app`에서 다운로드 배포.
- 안드로이드 툴체인(Homebrew 불가→홈 직접설치): `JAVA_HOME=~/android-tools/jdk17/Contents/Home`, SDK `~/android-tools/sdk`. 빌드 `./gradlew :app:assembleDebug`.

## 도메인
- 페이지: 배송보드(/)·고품(/gopoum)·실시간위치(/tracking). 마감 시 Google Sheets(배송-MM/고품-MM/위치-MM) 기록 후 DB 정리. 서비스계정은 파일 생성 불가→시트 문서는 사람이 미리 생성.
- DB(Supabase, RLS 전부 off·anon key 직접): clients·riders(location gn/as, is_quick)·deliveries·gopoum_clients/items·app_state·rider_locations·location_pings·delivery_trips. 실시간: deliveries·gopoum_*·app_state·rider_locations·delivery_trips.
- 위치추적: 앱이 5초마다 rider_locations upsert + location_pings insert(GPS지터 스냅). 지오펜스(app_state warehouse_lat/lng/geofence_radius_m)로 본사이탈=배송출발/복귀=배송완료 → 폰 알람 + delivery_trips + 웹 토스트/배송중뱃지. /tracking: 라이더→배송(trip)→5분마크 동선, 날짜선택 시 위치-MM 시트 아카이브 조회, 본사위치 지도클릭 설정·반경 10~300m 슬라이더.

## 관례
- 커밋/푸시 묻지 말고 바로 main. `find .git -name '*.lock' -delete` 후 add/commit/push, 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 검증 `npx tsc --noEmit`. 마이그레이션 SQL·위치-MM 시트생성은 사용자가 직접(자동 불가).

## 이번 세션 완료
안드로이드 앱 신규제작+에뮬검증 / /tracking(로딩배너버그·본사클릭설정·반경300m·동선·아카이브·회차5분마크) / 지오펜스 알람(폰+웹토스트) / 마감시 위치-MM기록+DB초기화 / GPS지터억제 / 재설치후 서비스재시작 / 앱 진단패널+테스트알람버튼.

## 다음 할 일 / 미해결
- 사용자: Supabase에 `update_12.sql`·`update_13.sql` 실행, Google Drive에 `위치-MM` 시트 생성, 폰에 최신 APK 재설치.
- 알람 미수신 디버깅: 앱 진단패널(거리/정확도/상태)로 확인. 반경 < GPS정확도면 INSIDE 인식 안됨 → 반경 키우기.
- 미완: ETA(카카오모빌리티 REST키 발급됨), 이메일리포트(Resend) 미설정.

## 최근 커밋 3
2ae65c3 GPS지터억제+APK재설치후 서비스재시작+웹 배송출발/완료 토스트 / 71c3230 배송회차(trip)표시+5분마크+반경300m / 5a68358 rider-app APK 지오펜스 알람 반영
