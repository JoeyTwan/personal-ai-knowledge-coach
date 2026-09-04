'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: '首页' },
  { href: '/record', label: '记录' },
  { href: '/knowledge', label: '知识库' },
  { href: '/graph', label: '图谱' },
  { href: '/ask', label: '问 AI' },
  { href: '/review', label: '复习' },
  { href: '/profile', label: '我的' },
]

export default function Nav() {
  const pathname = usePathname()
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <header className="sticky top-0 z-20 border-b border-ink/8 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
        <Link href="/" className="text-[15px] font-semibold tracking-tight">
          知教练
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition ${
                isActive(l.href) ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
