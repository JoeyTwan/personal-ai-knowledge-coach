'use client'

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  maxRows?: number
}

// 自适应高度输入框：内容增多自动长高，达到 maxRows 后内部滚动
export default function AutoTextarea({ maxRows = 6, onChange, ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 26
    const maxHeight = maxRows * lineHeight
    const h = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${h}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }

  useLayoutEffect(() => {
    resize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value, props.defaultValue])

  return (
    <textarea
      ref={ref}
      rows={1}
      {...props}
      onChange={(e) => {
        resize()
        onChange?.(e)
      }}
    />
  )
}
