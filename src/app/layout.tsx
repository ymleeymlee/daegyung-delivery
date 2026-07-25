import type { Metadata } from 'next'
import { Suspense } from 'react'
import './globals.css'
import Nav from '@/components/Nav'
import { BranchProvider } from '@/lib/branch'

export const metadata: Metadata = {
  title: '대경배송시스템',
  description: '배송 배차 관리 시스템',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="min-h-screen bg-slate-100">
        <Suspense fallback={null}>
          <BranchProvider>
            <Nav />
            {children}
          </BranchProvider>
        </Suspense>
      </body>
    </html>
  )
}
