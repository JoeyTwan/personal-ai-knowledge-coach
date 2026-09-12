'use client'

import type { KeyboardEvent } from 'react'
import AutoTextarea from './AutoTextarea'

// 卡片式作答：一次只答一件事，点一下就往前挪一步。
// 设计原则：能点选解决的绝不让用户打字；要打字时给句式脚手架；
// 每个点选题都挂着一个「说不好」的出口，用户永远不会被卡死。

export type AskType = 'judge' | 'scenario' | 'choose' | 'contrast' | 'fill' | 'say'

export interface AskOption {
  label: string
  text: string
}

export interface AskCard {
  id: string
  type: AskType
  question?: string
  statement?: string
  options?: AskOption[]
  unsure?: boolean
  scaffold?: string
  placeholder?: string
}

export interface CardAnswer {
  cardId: string
  choice?: string
  text?: string
}

// 说不好这个出口的哨兵值，后端会把它翻成人话
export const UNSURE = '__unsure__'

const CHOICE_TYPES: AskType[] = ['judge', 'scenario', 'choose', 'contrast']

const TYPE_LABEL: Record<AskType, string> = {
  judge: '判一下',
  scenario: '选场景',
  choose: '选一个',
  contrast: '辨一辨',
  fill: '填一个空',
  say: '说一句',
}

export type GroupState = 'answering' | 'grading' | 'graded'

interface Props {
  cards: AskCard[]
  state: GroupState
  answers: Record<string, CardAnswer>
  // 判定结果，用来标注哪些卡答对了、哪些答错了
  verdict?: string
  wrongCards?: string[]
  progress?: string
  onChange: (cardId: string, patch: Partial<CardAnswer>) => void
  onSubmit: () => void
}

export default function AskCards({
  cards,
  state,
  answers,
  verdict,
  wrongCards = [],
  progress,
  onChange,
  onSubmit,
}: Props) {
  if (cards.length === 0) return null

  const editable = state === 'answering'
  const isAnswered = (card: AskCard) => {
    const a = answers[card.id]
    return !!(a && (a.choice || (a.text ?? '').trim()))
  }
  const canSubmit = editable && cards.every(isAnswered)
  // 只有一张点选题时，点一下就交，不让人再多按一次
  const tapToSubmit = cards.length === 1 && CHOICE_TYPES.includes(cards[0].type)

  // 全对时所有卡都算对；答错时只标 AI 指出的那几张，其余保持中性，不猜
  const markOf = (card: AskCard): 'right' | 'wrong' | 'none' => {
    if (state !== 'graded') return 'none'
    if (verdict === 'next' || verdict === 'pass') return 'right'
    if (verdict === 'retry' && wrongCards.includes(card.id)) return 'wrong'
    return 'none'
  }

  function pick(card: AskCard, choice: string) {
    if (!editable) return
    onChange(card.id, { choice })
    if (tapToSubmit) onSubmit()
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSubmit) onSubmit()
    }
  }

  return (
    <div className="card border-gold/30">
      {progress && <p className="text-[12px] text-gold">{progress}</p>}

      <div className={progress ? 'mt-3 space-y-5' : 'space-y-5'}>
        {cards.map((card) => {
          const answer = answers[card.id]
          const mark = markOf(card)
          const isChoice = CHOICE_TYPES.includes(card.type)
          return (
            <div key={card.id}>
              <p className="text-[11px] text-faint">{TYPE_LABEL[card.type]}</p>

              {card.question && (
                <p className="mt-1.5 text-[15px] leading-relaxed">{card.question}</p>
              )}

              {card.statement && (
                <p className="mt-2 rounded-xl bg-surface2 px-3.5 py-3 text-[15px] leading-relaxed">
                  {card.statement}
                </p>
              )}

              {isChoice && (
                <div className="mt-3 space-y-2">
                  {(card.options ?? []).map((opt) => {
                    const selected = answer?.choice === opt.label
                    const tone = !selected
                      ? 'border-ink/12 hover:border-ink/28'
                      : mark === 'wrong'
                        ? 'border-danger/60 bg-danger/8'
                        : mark === 'right'
                          ? 'border-success/60 bg-success/8'
                          : 'border-gold bg-gold/12'
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        disabled={!editable}
                        onClick={() => pick(card, opt.label)}
                        className={`flex w-full items-start gap-2.5 rounded-2xl border px-4 py-3 text-left text-[15px] leading-relaxed transition ${tone} ${
                          editable ? '' : 'cursor-default'
                        }`}
                      >
                        <span className="mt-[1px] shrink-0 text-[13px] text-faint">{opt.label}</span>
                        <span className="min-w-0 flex-1">{opt.text}</span>
                        {selected && mark === 'wrong' && <span className="text-[13px] text-danger">✕</span>}
                        {selected && mark === 'right' && <span className="text-[13px] text-success">✓</span>}
                      </button>
                    )
                  })}

                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => pick(card, UNSURE)}
                    className={`flex w-full items-center gap-2.5 rounded-2xl border border-dashed px-4 py-2.5 text-left text-[14px] transition ${
                      answer?.choice === UNSURE
                        ? 'border-gold/70 text-gold'
                        : 'border-ink/15 text-muted hover:border-ink/30 hover:text-ink'
                    } ${editable ? '' : 'cursor-default'}`}
                  >
                    <span className="shrink-0 text-[13px] text-faint">?</span>
                    <span className="min-w-0 flex-1">说不好，帮我讲讲</span>
                  </button>
                </div>
              )}

              {!isChoice && (
                <div className="mt-3">
                  {card.scaffold && (
                    <p className="text-[12px] text-faint">可以这样开头：{card.scaffold}</p>
                  )}
                  <AutoTextarea
                    className="input mt-2"
                    maxRows={4}
                    value={answer?.text ?? ''}
                    onChange={(e) => onChange(card.id, { text: e.target.value })}
                    onKeyDown={handleKey}
                    placeholder={card.placeholder || '一句话就行'}
                    disabled={!editable}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {state === 'answering' && !tapToSubmit && (
        <button className="btn btn-primary mt-4 w-full" disabled={!canSubmit} onClick={onSubmit}>
          回答
        </button>
      )}

      {state === 'grading' && <p className="mt-4 text-[12px] text-muted">教练在看你的回答…</p>}
    </div>
  )
}
