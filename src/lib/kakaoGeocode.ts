// 카카오 주소→좌표 지오코딩 (브라우저 전용).
// 업체 등록/수정 시, 그리고 기존 업체 좌표 일괄 백필에 사용.
// REST 키가 아니라 JS 키(NEXT_PUBLIC_KAKAO_MAP_KEY)만 있으므로 서버가 아닌 브라우저에서만 동작한다.

/* eslint-disable @typescript-eslint/no-explicit-any */
let sdkPromise: Promise<void> | null = null

// 카카오 지도 SDK(services 라이브러리 포함)를 1회 로드. 이미 있으면 즉시 resolve.
function loadKakaoSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('브라우저 전용'))
  if ((window as any).kakao?.maps?.services) return Promise.resolve()
  if (sdkPromise) return sdkPromise
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY
  if (!key) return Promise.reject(new Error('NEXT_PUBLIC_KAKAO_MAP_KEY 미설정'))
  sdkPromise = new Promise<void>((resolve, reject) => {
    const finish = () => (window as any).kakao.maps.load(() => resolve())
    const existing = document.getElementById('kakao-sdk') as HTMLScriptElement | null
    if (existing) {
      if ((window as any).kakao?.maps) finish()
      else {
        existing.addEventListener('load', finish)
        existing.addEventListener('error', () => reject(new Error('카카오 SDK 로드 실패')))
      }
      return
    }
    const s = document.createElement('script')
    s.id = 'kakao-sdk'
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false&libraries=services`
    s.async = true
    s.onload = finish
    s.onerror = () => reject(new Error('카카오 SDK 로드 실패'))
    document.head.appendChild(s)
  })
  return sdkPromise
}

/** 주소 → {lat,lng}. 실패(빈 주소/미검색)면 null. */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const q = (address ?? '').trim()
  if (!q) return null
  await loadKakaoSdk()
  const kakao = (window as any).kakao
  return new Promise(resolve => {
    const geocoder = new kakao.maps.services.Geocoder()
    // 카카오 좌표: x=경도(lng), y=위도(lat)
    geocoder.addressSearch(q, (result: any, status: any) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) })
      } else {
        resolve(null)
      }
    })
  })
}
