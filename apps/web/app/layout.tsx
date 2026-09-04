import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'

export const metadata: Metadata = {
  title: '知教练 · 个人 AI 知识教练',
  description:
    '一个长期理解你、组织你的知识、检测真实掌握程度并帮助你持续成长的私人 AI 知识教练。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="min-h-screen">
          <Nav />
          <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">{children}</main>
        </div>
      </body>
    </html>
  )
}
