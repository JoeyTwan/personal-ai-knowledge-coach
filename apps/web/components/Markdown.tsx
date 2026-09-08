import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 统一的 Markdown 渲染组件，自动适配明暗主题（样式见 globals.css 的 .prose）
export default function Markdown({ content }: { content: string }) {
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
