'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Script from 'next/script'
import { supabase } from '@/lib/supabase'
import type { RiderLocation } from '@/types'

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY

// Kakao Maps SDK는 타입이 없어 window.kakao 를 any 로 선언
declare global {
  interface Window { kakao: any } // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Warehouse { lat: number; lng: number; radius: number }

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

  const [sdkReady, setSdkReady] = useState(false)
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null)
  const [locations, setLocations] = useState<RiderLocation[]>([])
  const [, forceTick] = useState(0) // "n초 전" 갱신용

  // 창고 설정 + 초기 위치 로드 + 실시간 구독
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
    const kakao = window.kakao
    const center = new kakao.maps.LatLng(warehouse.lat, warehouse.lng)
    const map = new kakao.maps.Map(containerRef.current, { center, level: 5 })
    mapRef.current = map
    // 창고 마커 + 지오펜스 반경 원
    new kakao.maps.Circle({
      center, radius: warehouse.radius,
      strokeWeight: 2, strokeColor: '#2563eb', strokeOpacity: 0.7, strokeStyle: 'solid',
      fillColor: '#3b82f6', fillOpacity: 0.08,
    }).setMap(map)
    const wh = new kakao.maps.CustomOverlay({
      position: center, yAnchor: 1.4,
      content: '<div style="background:#2563eb;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9999px;white-space:nowrap;">창고</div>',
    })
    wh.setMap(map)
  }, [sdkReady, warehouse])

  // 위치 변동 시 라이더 마커 갱신
  const syncMarkers = useCallback(() => {
    const kakao = window.kakao
    const map = mapRef.current
    if (!kakao || !map) return
    const seen = new Set<string>()
    for (const l of locations) {
      seen.add(l.rider_id)
      const pos = new kakao.maps.LatLng(l.lat, l.lng)
      const existing = markersRef.current.get(l.rider_id)
      if (existing) {
        existing.setPosition(pos)
      } else {
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
  }, [locations])

  useEffect(() => { syncMarkers() }, [syncMarkers, sdkReady])

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

  return (
    <>
      <Script
        src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false`}
        strategy="afterInteractive"
        onLoad={() => window.kakao.maps.load(() => setSdkReady(true))}
      />
      <div className="relative h-[calc(100vh-56px)]">
        <div ref={containerRef} className="w-full h-full" />
        {/* 좌상단 라이더 목록 패널 */}
        <div className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur rounded-xl shadow-lg border border-slate-200 w-56 max-h-[70vh] overflow-y-auto">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">운행 중</span>
            <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">{locations.length}</span>
          </div>
          {locations.length === 0 ? (
            <p className="px-4 py-4 text-xs text-slate-400 italic text-center">위치 전송 중인 라이더 없음</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...locations].sort((a, b) => a.rider_name.localeCompare(b.rider_name, 'ko')).map(l => (
                <li key={l.rider_id}
                  className="px-4 py-2 hover:bg-slate-50 cursor-pointer"
                  onClick={() => { const k = window.kakao; if (k && mapRef.current) mapRef.current.panTo(new k.maps.LatLng(l.lat, l.lng)) }}>
                  <div className="text-sm font-medium text-slate-800">{l.rider_name}</div>
                  <div className="text-xs text-slate-400">{fmtAgo(l.updated_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
