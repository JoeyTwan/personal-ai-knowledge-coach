'use client'

import type { KeyboardEvent } from 'react'
import AutoTextarea from './AutoTextarea'

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder?: string
  loading?: boolean
  maxRows?: number
  hint?: string
}

// 全站统一的对话输入条：胶囊外形 + 圆形上箭头按钮
// 「记录」与「问 AI」共用同一实现，保证两处样式永远一致
export default function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  loading = false,
  maxRows = 6,
  hint,
}: Props) {
  const canSend = value.trim().length > 0 && !loading

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) onSubmit()
    }
  }

  return (
    <div>
      <div className="composer">
        <AutoTextarea
          className="composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxRows={maxRows}
        />
        <button
          type="button"
          className="composer-send"
          onClick={onSubmit}
          disabled={!canSend}
          aria-label="发送"
          title="发送"
        >
          {loading ? <Spinner /> : <ArrowUp />}
        </button>
      </div>
      {hint && <p className="mt-2 text-center text-[11px] text-faint">{hint}</p>}
    </div>
  )
}

function ArrowUp() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="M5.5 11.5 12 5l6.5 6.5" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}
