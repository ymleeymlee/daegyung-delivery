import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { generateDailyReports, dateStampUnderscore } from '@/lib/dailyReport'
import { fromCron } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!fromCron(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const files = await generateDailyReports()

    if (files.length === 0) {
      return NextResponse.json({ ok: true, sent: false, reason: '당일 배송 내역 없음' })
    }

    const apiKey = process.env.RESEND_API_KEY
    const adminEmail = process.env.ADMIN_EMAIL
    const fromEmail = process.env.REPORT_FROM_EMAIL || 'onboarding@resend.dev'

    if (!apiKey || !adminEmail) {
      return NextResponse.json(
        { ok: false, error: 'RESEND_API_KEY 또는 ADMIN_EMAIL 미설정' },
        { status: 500 }
      )
    }

    const resend = new Resend(apiKey)
    const stamp = dateStampUnderscore()
    const summary = files.map(f => `${f.location.toUpperCase()} ${f.total}건`).join(', ')

    const { error } = await resend.emails.send({
      from: fromEmail,
      to: adminEmail,
      subject: `[대경배송] ${stamp} 배송 내역 (${summary})`,
      text: `${stamp} 배송 내역입니다.\n\n${files
        .map(f => `· ${f.filename}: 총 ${f.total}군데`)
        .join('\n')}`,
      attachments: files.map(f => ({
        filename: f.filename,
        content: f.buffer.toString('base64'),
      })),
    })

    if (error) {
      return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      files: files.map(f => ({ filename: f.filename, total: f.total })),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
