import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 公网访问保护：配了 SITE_USER / SITE_PASS 才生效
// 本地开发不配这两个变量，因此不受影响
export function middleware(req: NextRequest) {
  const user = process.env.SITE_USER
  const pass = process.env.SITE_PASS
  if (!user || !pass) return NextResponse.next()

  const header = req.headers.get('authorization') ?? ''
  if (header.startsWith('Basic ')) {
    let decoded = ''
    try {
      decoded = atob(header.slice(6))
    } catch {
      decoded = ''
    }
    const sep = decoded.indexOf(':')
    if (sep > -1 && decoded.slice(0, sep) === user && decoded.slice(sep + 1) === pass) {
      return NextResponse.next()
    }
  }

  return new NextResponse('请先登录后访问', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Knowledge Base", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
