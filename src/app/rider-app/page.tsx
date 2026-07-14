export const metadata = { title: '대경 라이더 앱 다운로드' }

export default function RiderAppPage() {
  return (
    <div className="max-w-md mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">대경 라이더 앱</h1>
      <p className="text-sm text-slate-500 mb-8">
        라이더 지급 폰에 설치하여 실시간 위치를 전송합니다.
      </p>

      <a
        href="/rider-app.apk"
        download="daegyung-rider.apk"
        className="block w-full text-center bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold py-4 rounded-2xl shadow transition-colors"
      >
        📱 APK 다운로드 (19MB)
      </a>

      <div className="mt-8 bg-slate-50 border border-slate-200 rounded-2xl p-5 text-sm text-slate-700 leading-relaxed space-y-3">
        <h2 className="font-semibold text-slate-800">설치 방법</h2>
        <ol className="list-decimal ml-5 space-y-2">
          <li>위 버튼을 눌러 APK 다운로드.</li>
          <li>다운로드 완료 알림을 탭하거나 <b>파일 앱 → 다운로드</b>에서 APK 실행.</li>
          <li>&quot;출처를 알 수 없는 앱&quot; 경고가 뜨면 <b>설정 → 이 출처 허용</b> → 뒤로 돌아와 <b>설치</b>.</li>
          <li>앱 실행 시 <b>위치 권한 &quot;항상 허용&quot;</b>, 알림 권한 <b>허용</b> 선택.</li>
          <li>라이더 목록에서 본인 이름 탭 → 위치 전송이 시작됩니다.</li>
        </ol>
      </div>

      <div className="mt-4 text-xs text-slate-400 leading-relaxed">
        Android 8 이상 (API 26+) · 배터리 절약 예외 설정을 권장합니다.
        설치 후 화면이 꺼져도 배송 중에는 위치가 계속 전송됩니다.
      </div>
    </div>
  )
}
