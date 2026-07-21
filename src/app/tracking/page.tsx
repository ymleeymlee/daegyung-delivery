'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Script from 'next/script'
import { supabase } from '@/lib/supabase'
import { fetchAppState, isClosedNow, type AppState } from '@/lib/appState'
import type { RiderLocation, DeliveryTrip } from '@/types'
import type { ArchiveResponse } from '@/app/api/location-archive/route'

interface Ping { lat: number; lng: number; captured_at: string; accuracy?: number | null }

// 동선 렌더 필터 (앱 LocationService 와 동일 기준)
const PATH_MAX_ACCURACY_M = 40      // 오차반경 이보다 크면 신뢰불가 → 점 제외
const PATH_MAX_SPEED_MPS = 33.3     // 직전 점 대비 순간속도 이보다 크면(≈120km/h) 스파이크 → 점 제외
const PATH_MAX_GAP_S = 60           // 시간갭 이보다 크면 추적끊김 → 선 끊기(직선 연결 방지)
const SAME_SPOT_M = 10             // 5분 마킹: 직전 마크와 이 거리 이내면 정지로 보고 라벨 안 겹침(최초 시각만)

// 두 좌표 간 거리(m) — Haversine
function distMeters(a: Ping, b: Ping): number {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const la1 = a.lat * rad, la2 = b.lat * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
}

/**
 * raw pings → 그릴 수 있는 궤적 세그먼트들로 정제.
 *  1) accuracy > 40m 점 제외
 *  2) 직전 채택점 대비 속도 > 33m/s(텔레포트 스파이크) 점 제외
 *  3) 시간갭 > 60s(추적끊김) 지점에서 선을 끊어 별도 세그먼트로 분리(갭 가로지르는 직선 방지)
 * 반환: 세그먼트 배열(각 세그먼트는 시간순 Ping 배열) + 채택된 전체 점(마커/바운즈용)
 */
function cleanPathSegments(pts: Ping[]): { segments: Ping[][]; kept: Ping[] } {
  const segments: Ping[][] = []
  const kept: Ping[] = []
  let cur: Ping[] = []
  for (const p of pts) {
    if (p.accuracy != null && p.accuracy > PATH_MAX_ACCURACY_M) continue  // ① 정확도 게이트
    if (cur.length === 0) { cur = [p]; kept.push(p); continue }
    const prev = cur[cur.length - 1]
    const dt = (new Date(p.captured_at).getTime() - new Date(prev.captured_at).getTime()) / 1000
    const dist = distMeters(prev, p)
    const speed = dt > 0 ? dist / dt : 0
    if (dt > PATH_MAX_GAP_S) {              // ③ 갭 → 선 끊기
      if (cur.length >= 1) segments.push(cur)
      cur = [p]; kept.push(p)
    } else if (speed > PATH_MAX_SPEED_MPS) { // ② 스파이크 → 점 폐기(prev 유지)
      continue
    } else {
      cur.push(p); kept.push(p)
    }
  }
  if (cur.length >= 1) segments.push(cur)
  return { segments, kept }
}

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY

// Kakao Maps SDK는 타입이 없어 window.kakao 를 any 로 선언
declare global {
  interface Window { kakao: any } // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Warehouse { lat: number; lng: number; radius: number }

// 아카이브 모드에서 여러 라이더 경로 색상 팔레트 (순환 사용)
const PATH_PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#f97316', '#a855f7', '#0ea5e9', '#ec4899', '#84cc16']

function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function fmtAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}초 전`
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  return `${Math.floor(s / 3600)}시간 전`
}

export default function TrackingPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map()) // eslint-disable-line @typescript-eslint/no-explicit-any
  const warehouseCircleRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const warehouseLabelRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const pathRef = useRef<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any 단일 라이더 궤적(스파이크/갭으로 끊긴 다중 세그먼트)
  const pathStartMarkerRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const fiveMinMarksRef = useRef<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any 트립 선택 시 5분 간격 라벨
  const archiveLayersRef = useRef<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any 아카이브 폴리라인/라벨 전부
  const dayPingsRef = useRef<Ping[]>([]) // 선택된 라이더의 오늘 pings 캐시 (트립 필터에 사용)

  const [sdkReady, setSdkReady] = useState(false)
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null)
  const [locations, setLocations] = useState<RiderLocation[]>([])
  const [, forceTick] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [statusMsg, setStatusMsg] = useState('')
  const [pickMode, setPickMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addressInput, setAddressInput] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [pathDeviceId, setPathDeviceId] = useState<string | null>(null)
  const [pathLoading, setPathLoading] = useState(false)
  const [pathPointCount, setPathPointCount] = useState(0)
  const [radiusInput, setRadiusInput] = useState(100)
  const [trips, setTrips] = useState<DeliveryTrip[]>([])
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  // 현재 진행 중인 배송(device_id) 집합 — "본사 출발" 인디케이터용
  const [activeTripDeviceIds, setActiveTripDeviceIds] = useState<Set<string>>(new Set())
  // device_id → 라이더 이름 매핑 (웹 /riders 에서 지정). 미지정이면 짧은 기기ID 표시.
  const [deviceMap, setDeviceMap] = useState<Map<string, string>>(new Map())
  // 배송 출발/완료 토스트 알림
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'start' | 'end' }[]>([])

  // 날짜 선택 (기본=오늘). today=실시간, 과거=아카이브
  const [viewDate, setViewDate] = useState<string>(todayKst())
  const [archive, setArchive] = useState<ArchiveResponse | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [appState, setAppState] = useState<AppState>({ offset: 0, closedUntil: null })
  // 아카이브: 그 날짜의 배송출발~본사복귀 구간(delivery_trips, device 기준). 동선 구간분리에 사용.
  const [archiveTripsRaw, setArchiveTripsRaw] = useState<{ deviceId: string; start: number; end: number }[]>([])

  // 마감된 날은 오늘이라도 라이브가 아니라 아카이브(시트)에서 로드
  // (마감 시 location_pings 가 비워지므로 Supabase 라이브로는 오늘 동선이 안 보임)
  const isLive = viewDate === todayKst() && !isClosedNow(appState)

  // device_id → 표시 이름. 매핑되면 라이더 이름, 아니면 "미지정 (앞8자)".
  const nameOf = useCallback((deviceId: string) =>
    deviceMap.get(deviceId) ?? `미지정 (${deviceId.slice(0, 8)})`, [deviceMap])
  // 최신 resolver 참조 (구독 재등록 없이 이름 해석용)
  const nameOfRef = useRef(nameOf)
  useEffect(() => { nameOfRef.current = nameOf }, [nameOf])

  // 기기↔라이더 매핑 로드 + 실시간 반영 (/riders 에서 지정하면 지도 이름이 바로 갱신)
  useEffect(() => {
    let active = true
    const load = async () => {
      const [{ data: devs }, { data: riders }] = await Promise.all([
        supabase.from('rider_devices').select('device_id,rider_id'),
        supabase.from('riders').select('id,name'),
      ])
      if (!active) return
      const rn = new Map<string, string>((riders ?? []).map((r: { id: string; name: string }) => [r.id, r.name]))
      const m = new Map<string, string>()
      for (const d of (devs ?? []) as { device_id: string; rider_id: string | null }[]) {
        if (d.rider_id && rn.has(d.rider_id)) m.set(d.device_id, rn.get(d.rider_id)!)
      }
      setDeviceMap(m)
    }
    void load()
    const ch = supabase
      .channel('rider-devices-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_devices' }, () => void load())
      .subscribe()
    return () => { active = false; supabase.removeChannel(ch) }
  }, [])

  // 마감 상태 로드 + 실시간 반영 (마감되면 오늘도 아카이브 모드로 전환)
  useEffect(() => {
    let active = true
    const load = async () => { const s = await fetchAppState(); if (active) setAppState(s) }
    void load()
    const ch = supabase
      .channel('tracking-appstate')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, () => void load())
      .subscribe()
    return () => { active = false; supabase.removeChannel(ch) }
  }, [])

  // 이미 로드된 SDK 재사용 (다른 탭에서 돌아왔을 때 onLoad 재발화 안 되는 문제 대응)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.kakao?.maps) {
      try { window.kakao.maps.load(() => setSdkReady(true)) } catch { /* noop */ }
    }
  }, [])

  useEffect(() => {
    if (sdkReady) { setStatusMsg(''); return }
    const t = setTimeout(() => {
      if (!mapRef.current) {
        setStatusMsg('지도 로딩이 지연됩니다. 카카오 개발자 콘솔의 JavaScript SDK 도메인 등록/반영을 확인하세요.')
      }
    }, 7000)
    return () => clearTimeout(t)
  }, [sdkReady])

  // 창고 설정 + 초기 위치 로드 + 실시간 구독 (실시간은 항상 유지, 아카이브 모드에선 렌더만 숨김)
  useEffect(() => {
    let active = true
    ;(async () => {
      const [{ data: cfg }, { data: locs }] = await Promise.all([
        supabase.from('app_state').select('*').in('key', ['warehouse_lat', 'warehouse_lng', 'geofence_radius_m']),
        supabase.from('rider_locations').select('*'),
      ])
      if (!active) return
      const m: Record<string, string> = {}
      for (const r of (cfg ?? []) as { key: string; value: string }[]) m[r.key] = r.value
      setWarehouse({
        lat: parseFloat(m.warehouse_lat || '37.4787'),
        lng: parseFloat(m.warehouse_lng || '127.0664'),
        radius: parseFloat(m.geofence_radius_m || '100'),
      })
      setLocations((locs ?? []) as RiderLocation[])
    })()

    const ch = supabase
      .channel('rider-locations-tracking')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_locations' }, payload => {
        setLocations(prev => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { device_id: string }
            return prev.filter(l => l.device_id !== old.device_id)
          }
          const row = payload.new as RiderLocation
          const idx = prev.findIndex(l => l.device_id === row.device_id)
          if (idx === -1) return [...prev, row]
          const next = prev.slice()
          next[idx] = row
          return next
        })
      })
      .subscribe()

    const tick = setInterval(() => forceTick(t => t + 1), 15000)
    return () => { active = false; supabase.removeChannel(ch); clearInterval(tick) }
  }, [])

  // 진행 중 trip 초기 로드 + delivery_trips 실시간 구독 → 토스트 + 배송중 인디케이터
  useEffect(() => {
    let active = true
    ;(async () => {
      const startISO = new Date(`${todayKst()}T00:00:00+09:00`).toISOString()
      const { data } = await supabase.from('delivery_trips')
        .select('device_id,started_at,ended_at')
        .is('ended_at', null)
        .gte('started_at', startISO)
      if (!active) return
      setActiveTripDeviceIds(new Set(
        ((data ?? []) as { device_id: string | null }[]).map(r => r.device_id).filter((x): x is string => !!x)
      ))
    })()

    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const pushToast = (text: string, kind: 'start' | 'end') => {
      const id = Date.now() + Math.random()
      setToasts(t => [...t, { id, text, kind }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000)
    }

    const ch = supabase
      .channel('delivery-trips-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_trips' }, payload => {
        const t = payload.new as DeliveryTrip
        if (!t.device_id) return
        setActiveTripDeviceIds(s => new Set(s).add(t.device_id!))
        pushToast(`🚚 ${nameOfRef.current(t.device_id)} 배송출발 · ${timeFmt.format(new Date(t.started_at))}`, 'start')
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'delivery_trips' }, payload => {
        const t = payload.new as DeliveryTrip
        if (!t.ended_at || !t.device_id) return
        setActiveTripDeviceIds(s => { const n = new Set(s); n.delete(t.device_id!); return n })
        const dur = Math.round((new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 60000)
        pushToast(`🏁 ${nameOfRef.current(t.device_id)} 본사복귀 · ${dur}분`, 'end')
      })
      .subscribe()
    return () => { active = false; supabase.removeChannel(ch) }
  }, [])

  // SDK + 창고 준비되면 지도 1회 생성
  useEffect(() => {
    if (!sdkReady || !warehouse || !containerRef.current || mapRef.current) return
    try {
      const kakao = window.kakao
      const center = new kakao.maps.LatLng(warehouse.lat, warehouse.lng)
      const map = new kakao.maps.Map(containerRef.current, { center, level: 5 })
      mapRef.current = map
      setTimeout(() => { try { map.relayout(); map.setCenter(center) } catch { /* noop */ } }, 200)

      warehouseCircleRef.current = new kakao.maps.Circle({
        center, radius: warehouse.radius,
        strokeWeight: 2, strokeColor: '#2563eb', strokeOpacity: 0.7, strokeStyle: 'solid',
        fillColor: '#3b82f6', fillOpacity: 0.08,
      })
      warehouseCircleRef.current.setMap(map)

      warehouseLabelRef.current = new kakao.maps.CustomOverlay({
        position: center, yAnchor: 1.4,
        content: '<div style="background:#2563eb;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9999px;white-space:nowrap;">본사</div>',
      })
      warehouseLabelRef.current.setMap(map)

      setStatus('ready'); setStatusMsg('')
    } catch (e) {
      setStatus('error'); setStatusMsg('지도 생성 실패: ' + String(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady, warehouse])

  // 지도 위의 모든 라이더 오버레이(폴리라인·시작·5분 마크) 제거
  const clearRiderOverlays = useCallback(() => {
    for (const pl of pathRef.current) pl.setMap(null); pathRef.current = []
    pathStartMarkerRef.current?.setMap(null); pathStartMarkerRef.current = null
    for (const m of fiveMinMarksRef.current) m.setMap(null)
    fiveMinMarksRef.current = []
  }, [])

  // 주어진 pings 로 폴리라인 렌더링 (+ withFiveMinMarks 옵션)
  const renderPingsAsPath = useCallback((pts: Ping[], opts: { withFiveMinMarks: boolean; fit: boolean }) => {
    const kakao = window.kakao
    const map = mapRef.current
    if (!kakao || !map) return
    clearRiderOverlays()
    if (pts.length < 1) return
    // 스파이크(텔레포트)·저정확도 점 제거 + 추적끊김 구간에서 선 끊기
    const { segments, kept } = cleanPathSegments(pts)
    if (kept.length < 1) return
    // 끊긴 구간마다 별도 폴리라인 (갭·스파이크를 직선으로 잇지 않음)
    for (const seg of segments) {
      if (seg.length < 2) continue
      const pl = new kakao.maps.Polyline({
        path: seg.map(p => new kakao.maps.LatLng(p.lat, p.lng)),
        strokeWeight: 4, strokeColor: '#7c3aed', strokeOpacity: 0.85, strokeStyle: 'solid',
      })
      pl.setMap(map)
      pathRef.current.push(pl)
    }
    pathStartMarkerRef.current = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(kept[0].lat, kept[0].lng), yAnchor: 1.2, zIndex: 4,
      content: '<div style="background:#22c55e;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:9999px;white-space:nowrap;">시작</div>',
    })
    pathStartMarkerRef.current.setMap(map)

    if (opts.withFiveMinMarks) {
      // 첫 ping 시각을 5분 경계로 내림 후, 5분 지날 때마다 가장 가까운 이후 ping 위치에 라벨
      const timeFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
      })
      const first = new Date(kept[0].captured_at)
      first.setSeconds(0, 0)
      first.setMinutes(Math.floor(first.getMinutes() / 5) * 5)
      let nextMark = first.getTime()
      const STEP = 5 * 60 * 1000
      // 정지 중엔 같은 좌표에 5분 라벨이 겹겹이 쌓임 → 직전 마크와 SAME_SPOT_M 이내면 건너뛰어
      // 그 위치의 최초(가장 이른 5분) 시각 하나만 남긴다. 이동하면(>SAME_SPOT_M) 다시 5분 단위로 찍음.
      let lastMark: Ping | null = null
      for (const p of kept) {
        const t = new Date(p.captured_at).getTime()
        while (t >= nextMark) {
          if (!lastMark || distMeters(lastMark, p) > SAME_SPOT_M) {
            const overlay = new kakao.maps.CustomOverlay({
              position: new kakao.maps.LatLng(p.lat, p.lng), yAnchor: 0.5, zIndex: 3,
              content: `<div style="background:#fff;border:2px solid #7c3aed;color:#7c3aed;font-size:10px;font-weight:700;padding:1px 6px;border-radius:9999px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25);">${timeFmt.format(new Date(nextMark))}</div>`,
            })
            overlay.setMap(map)
            fiveMinMarksRef.current.push(overlay)
            lastMark = p
          }
          nextMark += STEP
        }
      }
    }

    if (opts.fit) {
      const bounds = new kakao.maps.LatLngBounds()
      for (const p of kept) bounds.extend(new kakao.maps.LatLng(p.lat, p.lng))
      map.setBounds(bounds)
    }
  }, [clearRiderOverlays])

  // === 기기 선택: 오늘 pings + 오늘 trips 병렬 로드 후 전체 폴리라인 표시 ===
  const showPath = useCallback(async (deviceId: string | null) => {
    setSelectedTripId(null)
    setTrips([])
    dayPingsRef.current = []
    clearRiderOverlays()
    setPathPointCount(0)
    if (!deviceId) return
    setPathLoading(true)
    try {
      const startISO = new Date(`${todayKst()}T00:00:00+09:00`).toISOString()
      // location_pings 는 서버가 1000행씩만 반환(db-max-rows) → 페이지네이션으로 오늘 전량 수집.
      // (안 하면 오전 1000개만 그려지고 오후 동선이 통째로 누락됨)
      const PAGE = 1000
      const ptsPromise = (async () => {
        const all: Ping[] = []
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase.from('location_pings')
            .select('lat,lng,captured_at,accuracy')
            .eq('device_id', deviceId)
            .gte('captured_at', startISO)
            .order('captured_at', { ascending: true })
            .range(from, from + PAGE - 1)
          if (error) throw error
          const chunk = (data ?? []) as Ping[]
          all.push(...chunk)
          if (chunk.length < PAGE) break
        }
        return all
      })()
      const tripsPromise = supabase.from('delivery_trips')
        .select('*')
        .eq('device_id', deviceId)
        .gte('started_at', startISO)
        .order('started_at', { ascending: true })
      const [pts, tripsRes] = await Promise.all([ptsPromise, tripsPromise])
      if (tripsRes.error && tripsRes.error.code !== '42P01') throw tripsRes.error  // 42P01 = 테이블 없음(마이그레이션 미적용)
      dayPingsRef.current = pts
      setTrips((tripsRes.data ?? []) as DeliveryTrip[])
      setPathPointCount(pts.length)
      renderPingsAsPath(pts, { withFiveMinMarks: false, fit: true })
    } catch (e) {
      alert('동선 불러오기 실패: ' + String(e))
    } finally {
      setPathLoading(false)
    }
  }, [clearRiderOverlays, renderPingsAsPath])

  // === 트립 선택: 캐시된 pings 를 시작~종료 시각으로 필터 후 폴리라인 + 5분 마크 ===
  const showTrip = useCallback((tripId: string | null) => {
    setSelectedTripId(tripId)
    if (!tripId) {
      // 트립 해제 → 전체 오늘 궤적으로 복귀
      renderPingsAsPath(dayPingsRef.current, { withFiveMinMarks: false, fit: true })
      return
    }
    const trip = trips.find(t => t.id === tripId)
    if (!trip) return
    const startMs = new Date(trip.started_at).getTime()
    const endMs = trip.ended_at ? new Date(trip.ended_at).getTime() : Date.now()
    const filtered = dayPingsRef.current.filter(p => {
      const t = new Date(p.captured_at).getTime()
      return t >= startMs && t <= endMs
    })
    renderPingsAsPath(filtered, { withFiveMinMarks: true, fit: true })
  }, [trips, renderPingsAsPath])

  // 창고 초기 로드 시 슬라이더 값 동기화
  useEffect(() => {
    if (warehouse) setRadiusInput(warehouse.radius)
  }, [warehouse?.radius])

  // 드래그 중: 지도 원 크기만 실시간 반영 (저장 X)
  const previewRadius = useCallback((r: number) => {
    setRadiusInput(r)
    try { warehouseCircleRef.current?.setRadius(r) } catch { /* noop */ }
  }, [])

  // 드래그 종료(마우스업/터치엔드/키업) 시 저장
  const saveRadius = useCallback(async (r: number) => {
    try {
      const { error } = await supabase.from('app_state').upsert({ key: 'geofence_radius_m', value: String(r) })
      if (error) throw error
      setWarehouse(w => (w ? { ...w, radius: r } : w))
    } catch (e) {
      alert('반경 저장 실패: ' + String(e))
    }
  }, [])

  const saveWarehouse = useCallback(async (lat: number, lng: number) => {
    setSaving(true)
    try {
      const { error } = await supabase.from('app_state').upsert([
        { key: 'warehouse_lat', value: String(lat) },
        { key: 'warehouse_lng', value: String(lng) },
      ])
      if (error) throw error
      const kakao = window.kakao
      const pos = new kakao.maps.LatLng(lat, lng)
      warehouseCircleRef.current?.setPosition(pos)
      warehouseLabelRef.current?.setPosition(pos)
      mapRef.current?.panTo(pos)
      setWarehouse(w => (w ? { ...w, lat, lng } : { lat, lng, radius: 100 }))
      setPickMode(false)
    } catch (e) {
      alert('본사 위치 저장 실패: ' + String(e))
    } finally {
      setSaving(false)
    }
  }, [])

  // 주소 문자열 → 좌표 변환(카카오 지오코더) 후 본사 위치 저장
  const searchAddress = useCallback(() => {
    const q = addressInput.trim()
    if (!q) return
    const kakao = window.kakao
    if (!kakao?.maps?.services) { alert('주소 검색 모듈이 아직 로드되지 않았습니다. 잠시 후 다시 시도하세요.'); return }
    setGeocoding(true)
    const geocoder = new kakao.maps.services.Geocoder()
    geocoder.addressSearch(q, (result: any, statusCode: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      setGeocoding(false)
      if (statusCode === kakao.maps.services.Status.OK && result[0]) {
        // 카카오 좌표: x=경도(lng), y=위도(lat)
        void saveWarehouse(parseFloat(result[0].y), parseFloat(result[0].x))
        setAddressInput('')
      } else {
        alert('주소를 찾을 수 없습니다. 도로명 또는 지번 주소를 정확히 입력하세요.')
      }
    })
  }, [addressInput, saveWarehouse])

  // 실시간 라이더 마커 동기화 (아카이브 모드에서는 모두 숨김)
  const syncMarkers = useCallback(() => {
    const kakao = window.kakao
    const map = mapRef.current
    if (!kakao || !map) return
    if (!isLive) {
      // 아카이브 모드: 실시간 마커 전부 제거
      for (const [, overlay] of markersRef.current) overlay.setMap(null)
      markersRef.current.clear()
      return
    }
    const seen = new Set<string>()
    for (const l of locations) {
      seen.add(l.device_id)
      const pos = new kakao.maps.LatLng(l.lat, l.lng)
      const html = `<div style="background:#f97316;color:#fff;font-size:15px;font-weight:800;padding:5px 12px;border-radius:9999px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3);">${nameOf(l.device_id)}</div>`
      const existing = markersRef.current.get(l.device_id)
      if (existing) { existing.setPosition(pos); existing.setContent(html) }
      else {
        const overlay = new kakao.maps.CustomOverlay({ position: pos, yAnchor: 1.2, content: html })
        overlay.setMap(map)
        markersRef.current.set(l.device_id, overlay)
      }
    }
    for (const [id, overlay] of markersRef.current) {
      if (!seen.has(id)) { overlay.setMap(null); markersRef.current.delete(id) }
    }
  }, [locations, isLive, nameOf])

  useEffect(() => { syncMarkers() }, [syncMarkers, sdkReady])

  // === 아카이브 모드 진입 시 시트(동선) + 그 날짜 trip 구간 로드 ===
  useEffect(() => {
    if (isLive) {
      setArchive(null)
      setArchiveTripsRaw([])
      return
    }
    let active = true
    setArchiveLoading(true)
    const dayStartMs = new Date(`${viewDate}T00:00:00+09:00`).getTime()
    const dayStartISO = new Date(dayStartMs).toISOString()
    const dayEndISO = new Date(dayStartMs + 86400000).toISOString()
    ;(async () => {
      try {
        const [res, tripsRes] = await Promise.all([
          fetch(`/api/location-archive?date=${viewDate}`),
          supabase.from('delivery_trips')
            .select('device_id,started_at,ended_at')
            .gte('started_at', dayStartISO)
            .lt('started_at', dayEndISO),
        ])
        if (!res.ok) throw new Error(await res.text())
        const json = await res.json() as ArchiveResponse
        if (!active) return
        setArchive(json)
        // trip 구간 (배송출발=started_at ~ 본사복귀=ended_at, 미복귀면 그날 끝까지)
        const trips = (tripsRes.data ?? []) as { device_id: string | null; started_at: string; ended_at: string | null }[]
        setArchiveTripsRaw(trips
          .filter(t => t.device_id)
          .map(t => ({
            deviceId: t.device_id!,
            start: new Date(t.started_at).getTime(),
            end: t.ended_at ? new Date(t.ended_at).getTime() : dayStartMs + 86400000,
          })))
      } catch (e) {
        if (active) { setArchive({ date: viewDate, found: false, riders: [], totalPoints: 0 }); setArchiveTripsRaw([]); alert('아카이브 로드 실패: ' + String(e)) }
      } finally {
        if (active) setArchiveLoading(false)
      }
    })()
    return () => { active = false }
  }, [viewDate, isLive])

  // 모드 전환 시 실시간 단일 경로/시작 라벨 제거
  useEffect(() => {
    if (!isLive) {
      for (const pl of pathRef.current) pl.setMap(null); pathRef.current = []
      pathStartMarkerRef.current?.setMap(null); pathStartMarkerRef.current = null
      setPathDeviceId(null); setPathPointCount(0)
    }
  }, [isLive])

  // === 아카이브 폴리라인 렌더링 (배송출발~본사복귀 구간별 분리 + 5분 마킹) ===
  useEffect(() => {
    const kakao = window.kakao
    const map = mapRef.current
    if (!kakao || !map) return
    // 이전 아카이브 레이어 제거
    for (const layer of archiveLayersRef.current) layer.setMap(null)
    archiveLayersRef.current = []
    if (!archive || !archive.found || archive.riders.length === 0) return

    // 기기→라이더 이름별 trip 시간범위 (동선을 배송출발~본사복귀 구간으로 나누기 위함)
    const tripsByName = new Map<string, { start: number; end: number }[]>()
    for (const t of archiveTripsRaw) {
      const name = deviceMap.get(t.deviceId) ?? `미지정 (${t.deviceId.slice(0, 8)})`
      if (!tripsByName.has(name)) tripsByName.set(name, [])
      tripsByName.get(name)!.push({ start: t.start, end: t.end })
    }
    const timeFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const STEP = 5 * 60 * 1000

    const bounds = new kakao.maps.LatLngBounds()
    archive.riders.forEach((r, idx) => {
      if (r.points.length === 0) return
      const color = PATH_PALETTE[idx % PATH_PALETTE.length]
      const pts = [...r.points].sort((a, b) => a.captured_at.localeCompare(b.captured_at))
      for (const p of pts) bounds.extend(new kakao.maps.LatLng(p.lat, p.lng))
      // trip 있으면 배송출발~본사복귀 구간별로, 없으면 전체를 한 구간으로
      const ranges = tripsByName.get(r.rider_name)
      const segments: { lat: number; lng: number; captured_at: string }[][] =
        ranges && ranges.length
          ? ranges
              .map(rg => pts.filter(p => {
                const t = new Date(p.captured_at).getTime()
                return t >= rg.start && t <= rg.end
              }))
              .filter(s => s.length > 0)
          : [pts]

      for (const seg of segments) {
        if (seg.length >= 2) {
          const poly = new kakao.maps.Polyline({
            path: seg.map(p => new kakao.maps.LatLng(p.lat, p.lng)),
            strokeWeight: 4, strokeColor: color, strokeOpacity: 0.85, strokeStyle: 'solid',
          })
          poly.setMap(map)
          archiveLayersRef.current.push(poly)
        }
        // 5분 단위 시각 마킹 (구간 첫 시각을 5분 경계로 내림 후 5분마다)
        if (seg.length > 0 && seg[0].captured_at) {
          const first = new Date(seg[0].captured_at)
          if (!Number.isNaN(first.getTime())) {
            first.setSeconds(0, 0)
            first.setMinutes(Math.floor(first.getMinutes() / 5) * 5)
            let nextMark = first.getTime()
            // 정지 구간 라벨 겹침 방지: 직전 마크와 SAME_SPOT_M 이내면 최초 시각 하나만 남김(이동하면 다시 5분 단위).
            let lastMark: Ping | null = null
            for (const p of seg) {
              const t = new Date(p.captured_at).getTime()
              while (t >= nextMark) {
                if (!lastMark || distMeters(lastMark, p) > SAME_SPOT_M) {
                  const overlay = new kakao.maps.CustomOverlay({
                    position: new kakao.maps.LatLng(p.lat, p.lng), yAnchor: 0.5, zIndex: 3,
                    content: `<div style="background:#fff;border:2px solid ${color};color:${color};font-size:10px;font-weight:700;padding:1px 6px;border-radius:9999px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25);">${timeFmt.format(new Date(nextMark))}</div>`,
                  })
                  overlay.setMap(map)
                  archiveLayersRef.current.push(overlay)
                  lastMark = p
                }
                nextMark += STEP
              }
            }
          }
        }
      }

      // 시작점 라벨 (라이더 색)
      const startLabel = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(pts[0].lat, pts[0].lng), yAnchor: 1.2,
        content: `<div style="background:${color};color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:9999px;white-space:nowrap;">${r.rider_name}</div>`,
      })
      startLabel.setMap(map)
      archiveLayersRef.current.push(startLabel)
    })
    if (archive.totalPoints > 0) map.setBounds(bounds)
  }, [archive, archiveTripsRaw, deviceMap])

  // 아카이브 라이더 이름별 색상 (패널에도 표시)
  const archiveColorOf = useMemo(() => {
    const m = new Map<string, string>()
    archive?.riders.forEach((r, i) => m.set(r.rider_name, PATH_PALETTE[i % PATH_PALETTE.length]))
    return m
  }, [archive])

  if (!KAKAO_KEY) {
    return (
      <div className="p-8 max-w-xl mx-auto text-sm text-slate-600 leading-relaxed">
        <h1 className="text-lg font-bold text-slate-800 mb-3">실시간 위치</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="font-semibold text-amber-800 mb-2">카카오 지도 키가 설정되지 않았습니다.</p>
          <ol className="list-decimal ml-5 space-y-1 text-slate-700">
            <li>developers.kakao.com 에서 앱 생성 → <b>JavaScript 키</b> 발급</li>
            <li>앱 설정 → 플랫폼 → Web 에 도메인 등록(<code>http://localhost:3000</code>, 배포 도메인)</li>
            <li><code>.env.local</code> 과 Vercel 환경변수에 <code>NEXT_PUBLIC_KAKAO_MAP_KEY=발급키</code> 추가 후 재배포</li>
          </ol>
        </div>
      </div>
    )
  }

  const readySignal = () => { try { window.kakao.maps.load(() => setSdkReady(true)) } catch (e) { setStatus('error'); setStatusMsg('SDK 초기화 실패: ' + String(e)) } }

  return (
    <>
      <Script
        src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`}
        strategy="afterInteractive"
        onReady={readySignal}
        onLoad={readySignal}
        onError={() => { setStatus('error'); setStatusMsg('카카오 SDK 스크립트 로드 실패 — 도메인 등록/키를 확인하세요.') }}
      />
      <div className="relative h-[calc(100vh-56px)]">
        <div
          ref={containerRef}
          className="w-full h-full bg-slate-200"
        />
        {/* 배송 출발/완료 토스트 (우측 중앙, 스택형, 6초 후 자동 사라짐) */}
        <div className="absolute top-20 right-3 z-40 flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <div key={t.id}
              className={`pointer-events-auto px-4 py-2 rounded-xl shadow-lg text-sm font-semibold text-white animate-pulse ${
                t.kind === 'start' ? 'bg-red-500' : 'bg-emerald-500'
              }`}
              style={{ animation: 'none' }}
            >
              {t.text}
            </div>
          ))}
        </div>
        {/* 지도 로드 상태/에러 배너 */}
        {status !== 'ready' && statusMsg && (
          <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl shadow text-sm ${status === 'error' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-white/95 border border-slate-200 text-slate-600'}`}>
            {status === 'error' ? '⚠ ' : ''}{statusMsg}
          </div>
        )}
        {/* 우상단: 날짜 + 본사 위치 버튼 */}
        <div className="absolute top-3 right-3 z-10 flex items-start gap-2">
          <div className="bg-white rounded-xl shadow border border-slate-200 px-3 py-2 flex items-center gap-2">
            <input
              type="date"
              value={viewDate}
              max={todayKst()}
              onChange={e => setViewDate(e.target.value || todayKst())}
              className="text-sm text-slate-700 bg-transparent outline-none"
            />
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isLive ? 'bg-red-100 text-red-600' : 'bg-slate-200 text-slate-600'}`}>
              {isLive ? '실시간' : '아카이브'}
            </span>
            {viewDate !== todayKst() && (
              <button
                onClick={() => setViewDate(todayKst())}
                className="text-xs text-blue-600 hover:underline"
                title="실시간(오늘)로 돌아가기"
              >
                오늘 →
              </button>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => setPickMode(v => !v)}
              disabled={saving || status !== 'ready'}
              className={`px-3 py-2 rounded-xl shadow text-sm font-semibold transition-colors ${
                pickMode ? 'bg-slate-600 text-white hover:bg-slate-700'
                         : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title="본사(배송 출발) 위치를 주소로 변경"
            >
              {saving ? '저장 중…' : pickMode ? '닫기' : '📍 본사 위치 변경'}
            </button>
            {pickMode && (
              <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-slate-200 p-3 flex flex-col gap-3">
                {/* 주소 입력 */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">본사 주소</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={addressInput}
                      onChange={e => setAddressInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') searchAddress() }}
                      placeholder="예) 성남시 분당구 판교역로 235"
                      className="flex-1 min-w-0 text-sm text-slate-700 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={searchAddress}
                      disabled={geocoding || saving || !addressInput.trim()}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {geocoding ? '검색 중…' : '검색'}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">도로명 또는 지번 주소를 입력하고 검색하면 본사 위치가 변경됩니다.</p>
                </div>
                {/* 반경 조절 */}
                <div className="border-t border-slate-100 pt-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-600">지오펜스 반경</label>
                    <span className="text-xs font-mono text-slate-700">{radiusInput}m</span>
                  </div>
                  <input
                    type="range" min={10} max={300} step={10}
                    value={radiusInput}
                    onChange={e => previewRadius(parseInt(e.target.value))}
                    onMouseUp={e => saveRadius(parseInt((e.target as HTMLInputElement).value))}
                    onTouchEnd={e => saveRadius(parseInt((e.target as HTMLInputElement).value))}
                    onKeyUp={e => saveRadius(parseInt((e.target as HTMLInputElement).value))}
                    disabled={status !== 'ready'}
                    className="w-full accent-blue-600 disabled:opacity-40"
                    title="본사 지오펜스 반경 (10~300m)"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        {/* 좌상단 패널 — 실시간/아카이브 두 모드 */}
        <div className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur rounded-xl shadow-lg border border-slate-200 w-64 max-h-[70vh] overflow-y-auto">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              {isLive ? '운행 중' : `${viewDate} 동선`}
            </span>
            <span className={`${isLive ? 'bg-red-100 text-red-600' : 'bg-purple-100 text-purple-600'} text-xs font-bold px-2 py-0.5 rounded-full`}>
              {isLive ? locations.length : (archive?.riders.length ?? 0)}
            </span>
          </div>

          {isLive ? (
            // 실시간 목록
            locations.length === 0 ? (
              <p className="px-4 py-4 text-xs text-slate-400 italic text-center">위치 전송 중인 기기 없음</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...locations].sort((a, b) => nameOf(a.device_id).localeCompare(nameOf(b.device_id), 'ko')).map(l => {
                  const isActive = pathDeviceId === l.device_id
                  const unassigned = !deviceMap.has(l.device_id)
                  return (
                    <li key={l.device_id} className="transition-colors">
                      <div
                        className={`px-4 py-2 cursor-pointer ${isActive ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-slate-50'}`}
                        onClick={() => {
                          const next = isActive ? null : l.device_id
                          setPathDeviceId(next)
                          if (next) void showPath(next)
                          else {
                            void showPath(null)
                            const k = window.kakao
                            if (k && mapRef.current) mapRef.current.panTo(new k.maps.LatLng(l.lat, l.lng))
                          }
                        }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-slate-800">{nameOf(l.device_id)}</span>
                            {unassigned && (
                              <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full leading-none">
                                미지정
                              </span>
                            )}
                            {activeTripDeviceIds.has(l.device_id) && (
                              <span className="text-[10px] font-bold bg-orange-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                                🚚 배송출발
                              </span>
                            )}
                          </div>
                          {isActive && <span className="text-[10px] font-bold text-purple-600">🛤️ 동선</span>}
                        </div>
                        <div className="text-xs text-slate-400">
                          {fmtAgo(l.updated_at)}
                          {isActive && (
                            pathLoading ? <span className="ml-2 text-purple-500">불러오는 중…</span>
                              : pathPointCount > 0 ? <span className="ml-2 text-purple-500">{pathPointCount.toLocaleString()}개 지점</span>
                              : <span className="ml-2 text-slate-400">기록 없음</span>
                          )}
                        </div>
                      </div>
                      {/* 라이더 활성 시: 오늘 배송(trip) 목록 */}
                      {isActive && trips.length > 0 && (
                        <ul className="bg-slate-50/60 divide-y divide-slate-100/70 border-t border-slate-100">
                          {trips.map((t, i) => {
                            const isSelTrip = selectedTripId === t.id
                            const startFmt = new Intl.DateTimeFormat('en-GB', {
                              timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
                            }).format(new Date(t.started_at))
                            const endFmt = t.ended_at
                              ? new Intl.DateTimeFormat('en-GB', {
                                  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
                                }).format(new Date(t.ended_at))
                              : null
                            const durMin = t.ended_at
                              ? Math.round((new Date(t.ended_at).getTime() - new Date(t.started_at).getTime()) / 60000)
                              : Math.round((Date.now() - new Date(t.started_at).getTime()) / 60000)
                            return (
                              <li key={t.id}
                                className={`pl-6 pr-4 py-1.5 text-xs cursor-pointer flex items-center justify-between ${
                                  isSelTrip ? 'bg-purple-100 text-purple-800' : 'text-slate-600 hover:bg-slate-100'
                                }`}
                                onClick={e => { e.stopPropagation(); showTrip(isSelTrip ? null : t.id) }}
                              >
                                <span className="flex items-center gap-1.5">
                                  <span className="font-semibold text-slate-700">{i + 1}회</span>
                                  <span>{startFmt}~{endFmt ?? '진행중'}</span>
                                </span>
                                <span className="text-[10px] text-slate-400">{durMin}분</span>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {isActive && trips.length === 0 && !pathLoading && (
                        <div className="pl-6 pr-4 py-1.5 text-[11px] text-slate-400 bg-slate-50/60 border-t border-slate-100">
                          완료된 배송 없음
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )
          ) : (
            // 아카이브 목록
            archiveLoading ? (
              <p className="px-4 py-4 text-xs text-slate-400 italic text-center">시트에서 불러오는 중…</p>
            ) : !archive?.found ? (
              <p className="px-4 py-4 text-xs text-slate-400 italic text-center leading-relaxed">
                이 날짜에 저장된 기록이 없습니다.<br />
                <span className="text-slate-300">(마감이 실행됐고 위치-MM 시트에 탭이 있어야 함)</span>
              </p>
            ) : archive.riders.length === 0 ? (
              <p className="px-4 py-4 text-xs text-slate-400 italic text-center">기록된 라이더 없음</p>
            ) : (
              <>
                <ul className="divide-y divide-slate-100">
                  {archive.riders.map(r => {
                    const color = archiveColorOf.get(r.rider_name) ?? '#6b7280'
                    return (
                      <li key={r.rider_name}
                        className="px-4 py-2 hover:bg-slate-50 cursor-pointer"
                        onClick={() => {
                          const k = window.kakao
                          if (!k || !mapRef.current || r.points.length === 0) return
                          const b = new k.maps.LatLngBounds()
                          for (const p of r.points) b.extend(new k.maps.LatLng(p.lat, p.lng))
                          mapRef.current.setBounds(b)
                        }}>
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <div className="text-sm font-medium text-slate-800 flex-1">{r.rider_name}</div>
                          <span className="text-xs text-slate-400">{r.points.length.toLocaleString()}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500 text-center">
                  총 {archive.totalPoints.toLocaleString()}개 지점 · 클릭 시 확대
                </div>
              </>
            )
          )}

          {isLive && pathDeviceId && (
            <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500 text-center leading-relaxed">
              {selectedTripId
                ? '이 배송 구간 · 5분 간격 시각 표시 · 배송 클릭 시 해제'
                : '오늘 00시 이후 전체 동선 · 배송 클릭 시 그 구간만'}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
