import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '대경배달시스템',
  description: '배달 배차 관리 시스템',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="min-h-screen bg-slate-100">
        <nav className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6 shadow-sm">
          <span className="text-lg font-bold text-slate-800">대경배달시스템</span>
          <a href="/" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">배달 보드</a>
          <a href="/clients" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">거래처 관리</a>
        </nav>
        {children}
      </body>
    </html>
  )
}
