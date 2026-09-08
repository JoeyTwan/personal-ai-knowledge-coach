import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'

export const metadata: Metadata = {
  title: '人生知识库 · 个人 AI 知识教练',
  description:
    '一个长期理解你、组织你的知识、检测真实掌握程度并帮助你持续成长的私人 AI 知识教练。',
}

// 在首帧渲染前读取主题偏好，避免明暗闪烁
const themeInit = `(function(){try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <div className="min-h-screen">
          <Nav />
          <main className="mx-auto max-w-3xl px-5 pb-28 pt-10">{children}</main>
        </div>
      </body>
    </html>
  )
}
