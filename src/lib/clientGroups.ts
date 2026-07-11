import { Client } from '@/types'

// 업체번호가 같은 거래처들을 하나로 묶은 그룹
export interface Group {
  key: string
  code: string
  rep: Client        // 대표 거래처
  members: Client[]
}

// 검색 결과를 업체번호 기준으로 그룹핑 (업체번호 없으면 개별)
export function groupByCode(list: Client[]): Group[] {
  const byCode = new Map<string, Client[]>()
  const singles: Client[] = []
  for (const c of list) {
    const code = (c.code ?? '').trim()
    if (code) {
      if (!byCode.has(code)) byCode.set(code, [])
      byCode.get(code)!.push(c)
    } else {
      singles.push(c)
    }
  }
  const groups: Group[] = []
  for (const [code, members] of byCode) {
    const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    groups.push({ key: code, code, rep: sorted[0], members: sorted })
  }
  for (const s of singles) groups.push({ key: s.id, code: '', rep: s, members: [s] })
  return groups
}

// 그룹 표시명: "경기모터스 외 3" (묶인 게 있으면), 아니면 상호명 그대로
export function groupLabel(g: Group): string {
  return g.members.length > 1 ? `${g.rep.name} 외 ${g.members.length - 1}` : g.rep.name
}
