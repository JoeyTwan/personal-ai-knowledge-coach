'use client'

import { useEffect, useState } from 'react'
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

// 手机端底部导航：只放最高频的五个入口（手机以查询和随手问为主）
const mobileLinks = [
  { href: '/', label: '首页', icon: HomeIcon },
  { href: '/ask', label: '问 AI', icon: ChatIcon },
  { href: '/record', label: '记录', icon: PlusIcon },
  { href: '/knowledge', label: '知识库', icon: BookIcon },
  { href: '/profile', label: '我的', icon: UserIcon },
]

export default function Nav() {
  const pathname = usePathname()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme')
    setTheme(t === 'light' ? 'light' : 'dark')
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem('theme', next)
    } catch {
      /* 隐私模式忽略 */
    }
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-ink/8 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-5 py-3">
          <Link href="/" className="h-serif text-[16px] font-semibold tracking-tight">
            人生知识库
          </Link>
          <div className="flex items-center gap-1">
            <nav className="hidden items-center gap-1 overflow-x-auto sm:flex">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                    isActive(l.href) ? 'bg-ink text-canvas' : 'text-muted hover:text-ink'
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <button
              onClick={toggleTheme}
              aria-label="切换明暗主题"
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink"
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/8 bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
        <div className="mx-auto flex max-w-3xl items-stretch">
          {mobileLinks.map((l) => {
            const active = isActive(l.href)
            const Icon = l.icon
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-label={l.label}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors ${
                  active ? 'text-gold' : 'text-muted'
                }`}
              >
                <Icon />
                <span className="text-[11px]">{l.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}

function HomeIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 10.8 12 3.8l8.5 7" />
      <path d="M5.8 9.8V20h12.4V9.8" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.2v7.6M8.2 12h7.6" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.2A2.2 2.2 0 0 1 6.2 3H20v15H6.2A2.2 2.2 0 0 0 4 20.2z" />
      <path d="M4 20.2A2.2 2.2 0 0 1 6.2 18H20v3z" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  )
}
