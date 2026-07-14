'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Script from 'next/script'
import { supabase } from '@/lib/supabase'
import type { RiderLocation } from '@/types'
import type { ArchiveResponse } from '@/app/api/location-archive/route'

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
  const pathRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any 실시간 모드의 단일 라이더 궤적
  const pathStartMarkerRef = useRef<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
  const archiveLayersRef = useRef<any[]>([]) // eslint-disable-line @typescript-eslint/no-explicit-any 아카이브 폴리라인/라벨 전부
  const pickModeRef = useRef(false)

  const [sdkReady, setSdkReady] = useState(false)
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null)
  const [locations, setLocations] = useState<RiderLocation[]>([])
  const [, forceTick] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [statusMsg, setStatusMsg] = useState('')
  const [pickMode, setPickMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pathRiderId, setPathRiderId] = useState<string | null>(null)
  const [pathLoading, setPathLoading] = useState(false)
  const [pathPointCount, setPathPointCount] = useState(0)

  // 날짜 선택 (기본=오늘). today=실시간, 과거=아카이브
  const [viewDate, setViewDate] = useState<string>(todayKst())
  const [archive, setArchive] = useState<ArchiveResponse | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)

  const isLive = viewDate === todayKst()

  useEffect(() => { pickModeRef.current = pickMode }, [pickMode])

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
            const old = payload.old as { rider_id: string }
            return prev.filter(l => l.rider_id !== old.rider_id)
          }
          const row = payload.new as RiderLocation
          const idx = prev.findIndex(l => l.rider_id === row.rider_id)
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

      kakao.maps.event.addListener(map, 'click', (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!pickModeRef.current) return
        const latlng = e.latLng
        void saveWarehouse(latlng.getLat(), latlng.getLng())
      })

      setStatus('ready'); setStatusMsg('')
    } catch (e) {
      setStatus('error'); setStatusMsg('지도 생성 실패: ' + String(e))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady, warehouse])

  // === 실시간 라이더 궤적 (오늘 클릭한 라이더 1명) ===
  const showPath = useCallback(async (riderId: string | null) => {
    const kakao = window.kakao
    const map = mapRef.current
    if (!kakao || !map) return
    pathRef.current?.setMap(null); pathRef.current = null
    pathStartMarkerRef.current?.setMap(null); pathStartMarkerRef.current = null
    setPathPointCount(0)
    if (!riderId) return
    setPathLoading(true)
    try {
      const startISO = new Date(`${todayKst()}T00:00:00+09:00`).toISOString()
      const { data, error } = await supabase
        .from('location_pings')
        .select('lat,lng,captured_at')
        .eq('rider_id', riderId)
        .gte('captured_at', startISO)
        .order('captured_at', { ascending: true })
        .limit(20000)
      if (error) throw error
      const pts = (data ?? []) as { lat: number; lng: number; captured_at: string }[]
      if (pts.length < 2) { setPathPointCount(pts.length); return }
      const path = pts.map(p => new kakao.maps.LatLng(p.lat, p.lng))
      pathRef.current = new kakao.maps.Polyline({
        path, strokeWeight: 4, strokeColor: '#7c3aed', strokeOpacity: 0.85, strokeStyle: 'solid',
      })
      pathRef.current.setMap(map)
      pathStartMarkerRef.current = new kakao.maps.CustomOverlay({
        position: path[0], yAnchor: 1.2,
        content: '<div style="background:#22c55e;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:9999px;white-space:nowrap;">시작</div>',
      })
      pathStartMarkerRef.current.setMap(map)
      const bounds = new kakao.maps.LatLngBounds()
      for (const p of path) bounds.extend(p)
      map.setBounds(bounds)
      setPathPointCount(pts.length)
    } catch (e) {
      alert('동선 불러오기 실패: ' + String(e))
    } finally {
      setPathLoading(false)
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
      seen.add(l.rider_id)
      const pos = new kakao.maps.LatLng(l.lat, l.lng)
      const existing = markersRef.current.get(l.rider_id)
      if (existing) existing.setPosition(pos)
      else {
        const overlay = new kakao.maps.CustomOverlay({
          position: pos, yAnchor: 1.2,
          content: `<div style="background:#ef4444;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:9999px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3);">${l.rider_name}</div>`,
        })
        overlay.setMap(map)
        markersRef.current.set(l.rider_id, overlay)
      }
    }
    for (const [id, overlay] of markersRef.current) {
      if (!seen.has(id)) { overlay.setMap(null); markersRef.current.delete(id) }
    }
  }, [locations, isLive])

  useEffect(() => { syncMarkers() }, [syncMarkers, sdkReady])

  // === 아카이브 모드 진입 시 시트에서 로드 ===
  useEffect(() => {
    if (isLive) {
      setArchive(null)
      return
    }
    let active = true
    setArchiveLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/location-archive?date=${viewDate}`)
        if (!res.ok) throw new Error(await res.text())
        const json = await res.json() as ArchiveResponse
        if (active) setArchive(json)
      } catch (e) {
        if (active) { setArchive({ date: viewDate, found: false, riders: [], totalPoints: 0 }); alert('아카이브 로드 실패: ' + String(e)) }
      } finally {
        if (active) setArchiveLoading(false)
      }
    })()
    return () => { active = false }
  }, [viewDate, isLive])

  // 모드 전환 시 실시간 단일 경로/시작 라벨 제거
  useEffect(() => {
    if (!isLive) {
      pathRef.current?.setMap(null); pathRef.current = null
      pathStartMarkerRef.current?.setMap(null); pathStartMarkerRef.current = null
      setPathRiderId(null); setPathPointCount(0)
    }
  }, [isLive])

  // === 아카이브 폴리라인 렌더링 ===
  useEffect(() => {
    const kakao = window.kakao
    const map = mapRef.current
    if (!kakao || !map) return
    // 이전 아카이브 레이어 제거
    for (const layer of archiveLayersRef.current) layer.setMap(null)
    archiveLayersRef.current = []
    if (!archive || !archive.found || archive.riders.length === 0) return

    const bounds = new kakao.maps.LatLngBounds()
    archive.riders.forEach((r, idx) => {
      if (r.points.length === 0) return
      const color = PATH_PALETTE[idx % PATH_PALETTE.length]
      const path = r.points.map(p => new kakao.maps.LatLng(p.lat, p.lng))
      for (const p of path) bounds.extend(p)
      if (path.length >= 2) {
        const poly = new kakao.maps.Polyline({
          path, strokeWeight: 4, strokeColor: color, strokeOpacity: 0.85, strokeStyle: 'solid',
        })
        poly.setMap(map)
        archiveLayersRef.current.push(poly)
      }
      // 시작점 라벨 (라이더 색)
      const startLabel = new kakao.maps.CustomOverlay({
        position: path[0], yAnchor: 1.2,
        content: `<div style="background:${color};color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:9999px;white-space:nowrap;">${r.rider_name}</div>`,
      })
      startLabel.setMap(map)
      archiveLayersRef.current.push(startLabel)
    })
    if (archive.totalPoints > 0) map.setBounds(bounds)
  }, [archive])

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
        src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false`}
        strategy="afterInteractive"
        onReady={readySignal}
        onLoad={readySignal}
        onError={() => { setStatus('error'); setStatusMsg('카카오 SDK 스크립트 로드 실패 — 도메인 등록/키를 확인하세요.') }}
      />
      <div className="relative h-[calc(100vh-56px)]">
        <div
          ref={containerRef}
          className="w-full h-full bg-slate-200"
          style={pickMode ? { cursor: 'crosshair' } : undefined}
        />
        {/* 지도 로드 상태/에러 배너 */}
        {status !== 'ready' && statusMsg && (
          <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl shadow text-sm ${status === 'error' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-white/95 border border-slate-200 text-slate-600'}`}>
            {status === 'error' ? '⚠ ' : ''}{statusMsg}
          </div>
        )}
        {/* 픽 모드 안내 배너 */}
        {pickMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl shadow text-sm bg-blue-600 text-white flex items-center gap-3">
            지도를 클릭하여 본사 위치를 지정하세요
            <button onClick={() => setPickMode(false)} className="text-xs bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded">취소</button>
          </div>
        )}
        {/* 우상단: 날짜 + 본사 위치 버튼 */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
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
            {!isLive && (
              <button
                onClick={() => setViewDate(todayKst())}
                className="text-xs text-blue-600 hover:underline"
                title="실시간(오늘)로 돌아가기"
              >
                오늘 →
              </button>
            )}
          </div>
          <button
            onClick={() => setPickMode(v => !v)}
            disabled={saving || status !== 'ready'}
            className={`px-3 py-2 rounded-xl shadow text-sm font-semibold transition-colors ${
              pickMode ? 'bg-slate-600 text-white hover:bg-slate-700'
                       : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title="본사(배송 출발) 위치를 지도에서 지정"
          >
            {saving ? '저장 중…' : pickMode ? '취소' : '📍 본사 위치 변경'}
          </button>
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
              <p className="px-4 py-4 text-xs text-slate-400 italic text-center">위치 전송 중인 라이더 없음</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...locations].sort((a, b) => a.rider_name.localeCompare(b.rider_name, 'ko')).map(l => {
                  const isActive = pathRiderId === l.rider_id
                  return (
                    <li key={l.rider_id}
                      className={`px-4 py-2 cursor-pointer transition-colors ${isActive ? 'bg-purple-50 hover:bg-purple-100' : 'hover:bg-slate-50'}`}
                      onClick={() => {
                        const next = isActive ? null : l.rider_id
                        setPathRiderId(next)
                        if (next) void showPath(next)
                        else {
                          void showPath(null)
                          const k = window.kakao
                          if (k && mapRef.current) mapRef.current.panTo(new k.maps.LatLng(l.lat, l.lng))
                        }
                      }}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-slate-800">{l.rider_name}</div>
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

          {isLive && pathRiderId && (
            <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500 text-center">
              오늘 00시 이후 동선 · 클릭 시 해제
            </div>
          )}
        </div>
      </div>
    </>
  )
}
