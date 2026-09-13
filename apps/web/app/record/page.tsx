'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiGet, apiPost, apiUpload } from '@/lib/api'
import Markdown from '@/components/Markdown'
import AutoTextarea from '@/components/AutoTextarea'
import Composer from '@/components/Composer'
import AskCards, { type AskCard, type CardAnswer, type GroupState } from '@/components/AskCards'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  // 收录完成时插入的消息带这个字段，渲染成几个可点的入口
  saved?: { id: string; title?: string }[]
}

interface Draft {
  title?: string
  coreConclusion?: string
  briefExplanation?: string
  detailExplanation?: string
  example?: string
  type?: string
  tags?: string[]
  // 这条知识认领的原料要点，用来核对有没有漏
  keyPoints?: string[]
}

// 一次整理的结果：原料的全部要点 + 按主题分好的知识草稿 + 没落地的要点
interface ExtractRes {
  points?: string[]
  items?: Draft[]
  uncovered?: string[]
}

interface DiscussRes {
  sessionId: string
  reply: string
  cards?: AskCard[]
  // AI 识别出用户想收录了，前端自动触发整理
  ready?: boolean
}

// 来源固定三类
const SOURCE_TYPES = ['自己思考的', '听别人说的', '社交媒体/博客等']

// 还没走完的材料
interface PendingMaterial {
  id: string
  title: string
  kind: string
  total: number
  passed: number
}

const KIND_LABEL: Record<string, string> = {
  image: '图片',
  pdf: 'PDF',
  docx: '文档',
  text: '文本',
}

// 编辑态的五个字段：固定标签，不用占位符充当
const EDIT_FIELDS: { key: keyof Draft; label: string; maxRows?: number }[] = [
  { key: 'title', label: '标题' },
  { key: 'coreConclusion', label: '核心结论', maxRows: 5 },
  { key: 'briefExplanation', label: '简要解释（可留空）', maxRows: 4 },
  { key: 'detailExplanation', label: '详细解释（可留空）', maxRows: 8 },
  { key: 'example', label: '示例（可留空）', maxRows: 5 },
]

// 要点比对用的归一化：忽略空白、标点和大小写。
// 必须和服务端 cocreation.service 里的算法一致，否则两边对同一条要点会给出不同判断
function normLite(s: string): string {
  return (s ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。、；：！？""''（）《》【】,.!?;:"'()[\]<>—–-]/g, '')
    .toLowerCase()
}

export default function RecordPage() {
  const router = useRouter()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  // 整理结果：一份笔记可能拆出好几条知识，所以草稿是数组
  const [drafts, setDrafts] = useState<Draft[]>([])
  // 原料拆出的全部要点，以及一条知识都没认领的那些（正常情况下为空）
  const [points, setPoints] = useState<string[]>([])
  const [uncovered, setUncovered] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [cards, setCards] = useState<AskCard[]>([])
  const [cardAnswers, setCardAnswers] = useState<Record<string, CardAnswer>>({})
  const [cardState, setCardState] = useState<GroupState>('answering')
  const [sourceType, setSourceType] = useState('自己思考的')
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState<PendingMaterial[]>([])

  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 未走完的材料，进来就放在最上面
  useEffect(() => {
    apiGet<PendingMaterial[]>('/api/material/list')
      .then(setPending)
      .catch(() => undefined)
  }, [])

  // 微信式：新消息自动滚到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading, cards, drafts])

  // 上传一份材料：读懂之后拆成清单，然后跳过去逐条过
  async function uploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || uploading) return
    setUploading(true)
    setError('')
    try {
      const material = await apiUpload<{ id: string }>('/api/material/import', file)
      router.push(`/material/${material.id}`)
    } catch (err: any) {
      setError(err.message)
      setUploading(false)
    }
  }

  // 收起整理结果。结果是一组草稿，清的时候要连带要点清单一起清
  function clearDrafts() {
    setDrafts([])
    setPoints([])
    setUncovered([])
    setEditing(false)
  }

  // 防崩溃：任何异常回复都不许把页面弄白
  function applyReply(res: DiscussRes) {
    setSessionId(res.sessionId)
    // 防崩溃：任何异常回复都不许把页面弄白
    const reply = typeof res.reply === 'string' && res.reply.trim() ? res.reply : '（这轮我出岔了，你再说一遍试试）'
    setMessages((m) => [...m, { role: 'assistant', content: reply }])
    const list = Array.isArray(res.cards) ? res.cards : []
    setCards(list)
    setCardAnswers({})
    setCardState('answering')
    if (res.ready) void summarize()
  }

  async function send() {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: text }])
    // 草稿先收起来：你说话就是想继续聊
    clearDrafts()
    setLoading(true)
    setError('')
    try {
      const res = await apiPost<DiscussRes>('/api/cocreation/discuss', { sessionId, message: text })
      applyReply(res)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 交一组卡片作答：点选和打字打包成一条消息提交
  async function submitCards() {
    if (loading || cards.length === 0) return
    const payload = Object.values(cardAnswers).filter((a) => a.choice || (a.text ?? '').trim())
    if (payload.length === 0) return
    setCardState('grading')
    setLoading(true)
    setError('')
    try {
      const res = await apiPost<DiscussRes>('/api/cocreation/discuss', {
        sessionId,
        answers: payload,
        cards,
      })
      setCards([])
      applyReply(res)
    } catch (e: any) {
      setError(e.message)
      setCardState('answering')
    } finally {
      setLoading(false)
    }
  }

  // 我发起的整理：先把原料拆成要点，再按主题收成多条知识，收不收由我判断
  async function summarize() {
    if (!sessionId || summarizing) return
    setSummarizing(true)
    setError('')
    try {
      const res = await apiPost<ExtractRes>('/api/cocreation/summarize', { sessionId })
      // 防崩溃：一条草稿都没出来就当没整理出来，明确告诉用户
      const items = (Array.isArray(res?.items) ? res.items : []).filter(
        (d) => d && typeof d === 'object' && (d.coreConclusion || d.title),
      )
      if (items.length === 0) {
        setError('这次没整理出有效的草稿，再聊两句或者再试一次')
        return
      }
      setDrafts(items)
      setPoints(Array.isArray(res?.points) ? res.points : [])
      setUncovered(Array.isArray(res?.uncovered) ? res.uncovered : [])
      setEditing(false)
    } catch (e: any) {
      // 模型偶尔会想很久然后超时，这不是内容的问题，再点一次多半就好，
      // 所以这里用人话说明白，不要甩一段英文报错给他
      const msg = String(e?.message ?? '')
      setError(
        /timeout|timed out|abort|超时/i.test(msg)
          ? '这次整理模型想了太久，超时了。再点一次基本就能出来。'
          : msg || '整理没成功，再试一次',
      )
    } finally {
      setSummarizing(false)
    }
  }

  // 收录：不跳走，对话里插一条「已收录」，想接着聊接着聊。
  // 一次可能收多条，消息里逐条给出入口
  async function confirm(payload?: Draft[]) {
    const list = (payload ?? drafts).filter((d) => d && (d.coreConclusion || d.title))
    if (list.length === 0) return
    setLoading(true)
    setError('')
    try {
      const res = await apiPost<{ knowledges?: { id: string; title?: string }[] }>(
        '/api/cocreation/confirm',
        { sessionId, drafts: list, sourceType },
      )
      const saved = Array.isArray(res?.knowledges) ? res.knowledges : []
      clearDrafts()
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            saved.length > 0
              ? `已收录 ${saved.length} 条知识。要继续聊这个话题，或者换个新话题都行。`
              : '已收录。',
          saved,
        },
      ])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function discard() {
    clearDrafts()
    setMessages((m) => [...m, { role: 'assistant', content: '好的，这次先不收。我们接着聊。' }])
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="h-serif text-xl font-semibold">记录新知识</h1>
        <p className="mt-1 text-sm text-muted">
          说一段话，或者丢一份笔记、一张截图进来。我会和你讨论，直到你把它讲清楚。
        </p>
      </header>

      {/* 没走完的材料 */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] text-muted">还有 {pending.length} 份材料没走完</p>
          {pending.map((m) => (
            <Link
              key={m.id}
              href={`/material/${m.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-gold/25 bg-gold/6 px-4 py-3 transition hover:border-gold/45"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium">{m.title}</span>
                <span className="mt-0.5 block text-[12px] text-muted">
                  {KIND_LABEL[m.kind] ?? '材料'} · 已收录 {m.passed} / {m.total} 条
                </span>
              </span>
              <span className="shrink-0 text-[13px] text-gold">接着过</span>
            </Link>
          ))}
        </div>
      )}

      {/* 对话区 */}
      <div className="space-y-4">
        {messages.length === 0 && (
          <div className="card py-8 text-center text-sm text-muted">
            试着说：「我今天研究了一个计算机视觉问题，我发现视觉 Transformer 的优势是它可以一次看到整张图像……」
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                m.saved?.length
                  ? 'border border-gold/40 bg-gold/8'
                  : m.role === 'user'
                    ? 'bg-gold/18 text-ink'
                    : 'bg-surface2 text-ink'
              }`}
            >
              <Markdown content={m.content} />
              {m.saved && m.saved.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {m.saved.map((k) => (
                    <Link
                      key={k.id}
                      href={`/knowledge/${k.id}`}
                      className="text-[13px] text-gold underline underline-offset-4"
                    >
                      《{k.title || '未命名知识'}》→
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="text-sm text-muted">思考中…</div>}
      </div>

      {/* 追问卡片：点一下就答完，不用凑一小段话 */}
      {cards.length > 0 && drafts.length === 0 && (
        <AskCards
          cards={cards}
          state={cardState}
          answers={cardAnswers}
          onChange={(cardId, patch) =>
            setCardAnswers((a) => ({ ...a, [cardId]: { ...a[cardId], ...patch, cardId } }))
          }
          onSubmit={submitCards}
        />
      )}

      {/* 我发起的整理：常驻入口，收录的权利在我手里 */}
      {messages.length > 0 && drafts.length === 0 && !loading && (
        <button
          className="btn btn-ghost w-full border-dashed"
          onClick={summarize}
          disabled={summarizing || loading}
        >
          {summarizing ? '正在整理…（先拆要点，再分条）' : '聊透了，整理成知识'}
        </button>
      )}

      {/* 整理结果：一份笔记可能拆出多条知识，逐条检查，不要的可以单独剔掉 */}
      {drafts.length > 0 && !editing && (
        <div className="card border-gold/40">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium text-gold">
              这次整理出 {drafts.length} 条知识，你检查一下
            </p>
            {/* 要点核对：原料里说过的每一条，都该落到某条知识里 */}
            {points.length > 0 && (
              <span className={`text-[12px] ${uncovered.length ? 'text-danger' : 'text-muted'}`}>
                {uncovered.length
                  ? `${points.length} 条要点里有 ${uncovered.length} 条还没落地`
                  : `原料的 ${points.length} 条要点全部落地`}
              </span>
            )}
          </div>

          <div className="mt-4 space-y-3">
            {drafts.map((d, i) => (
              <div key={i} className="rounded-xl border border-ink/12 bg-surface2/40 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] font-semibold leading-snug">
                    <span className="mr-1.5 text-[12px] font-normal text-muted">{i + 1}</span>
                    {d.title || '未命名知识'}
                  </p>
                  {drafts.length > 1 && (
                    <button
                      onClick={() => setDrafts((list) => list.filter((_, j) => j !== i))}
                      className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-muted transition hover:text-danger"
                    >
                      这条不收
                    </button>
                  )}
                </div>
                {d.coreConclusion && (
                  <p className="mt-2 text-[14px] leading-relaxed">{d.coreConclusion}</p>
                )}
                {d.detailExplanation && (
                  <div className="mt-2 text-[13px] leading-relaxed text-ink/85">
                    <Markdown content={d.detailExplanation} />
                  </div>
                )}
                {d.example && (
                  <div className="mt-2 text-[13px] leading-relaxed text-muted">
                    <Markdown content={d.example} />
                  </div>
                )}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-mist px-2 py-0.5 text-[11px] text-muted">
                    {d.type || '概念'}
                  </span>
                  {d.tags?.map((t) => (
                    <span key={t} className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px]">
                      #{t}
                    </span>
                  ))}
                  {d.keyPoints?.length ? (
                    <span className="text-[11px] text-muted">覆盖 {d.keyPoints.length} 条要点</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {/* 要点对照：想核对的时候展开，平时不占地方 */}
          {points.length > 0 && (
            <details className="mt-3 rounded-xl border border-ink/12 p-3">
              <summary className="cursor-pointer text-[12px] text-muted">
                看原料的每个要点落在了哪条知识
              </summary>
              <ul className="mt-2.5 space-y-1.5">
                {points.map((p, i) => {
                  const owner = drafts.findIndex((d) =>
                    (d.keyPoints ?? []).some((kp) => normLite(kp) === normLite(p)),
                  )
                  return (
                    <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed">
                      <span className="mt-[3px] shrink-0 text-muted">{i + 1}</span>
                      <span className="min-w-0 flex-1">{p}</span>
                      <span className={`shrink-0 ${owner >= 0 ? 'text-muted' : 'text-danger'}`}>
                        {owner >= 0 ? `→ 第 ${owner + 1} 条` : '未落地'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </details>
          )}

          {/* 来源选择 */}
          <div className="mt-4 border-t border-ink/10 pt-4">
            <p className="mb-2 text-[12px] text-muted">这些知识来自哪里？</p>
            <div className="flex flex-wrap gap-2">
              {SOURCE_TYPES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSourceType(s)}
                  className={`rounded-full px-3 py-1.5 text-[13px] transition ${
                    sourceType === s
                      ? 'bg-gold text-canvas'
                      : 'border border-ink/15 text-muted hover:border-ink/30'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => confirm()} disabled={loading}>
              {drafts.length > 1 ? `收录这 ${drafts.length} 条` : '收录'}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>
              修改后收录
            </button>
            <button className="btn btn-ghost" onClick={clearDrafts}>
              还没聊透，继续聊
            </button>
            <button className="btn btn-ghost" onClick={discard}>
              放弃
            </button>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            下面输入框照常能用：你一说话我们就接着聊，这份草稿先收起来。
          </p>
        </div>
      )}

      {/* 编辑模式：固定标签，一眼分清哪个框是什么 */}
      {drafts.length > 0 && editing && (
        <div className="card border-gold/40">
          <p className="mb-3 text-[13px] font-medium text-gold">改成你自己的说法，再收录</p>
          <div className="space-y-5">
            {drafts.map((d, i) => (
              <div key={i} className="space-y-3 rounded-xl border border-ink/12 p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] text-muted">第 {i + 1} 条</p>
                  {drafts.length > 1 && (
                    <button
                      onClick={() => setDrafts((list) => list.filter((_, j) => j !== i))}
                      className="rounded-full px-2 py-0.5 text-[12px] text-muted transition hover:text-danger"
                    >
                      不收这条
                    </button>
                  )}
                </div>
                {EDIT_FIELDS.map((f) => (
                  <div key={f.key}>
                    <p className="mb-1.5 text-[12px] font-medium text-muted">{f.label}</p>
                    <AutoTextarea
                      className="input"
                      maxRows={f.maxRows}
                      value={(d[f.key] as string) ?? ''}
                      onChange={(e) =>
                        setDrafts((list) =>
                          list.map((x, j) => (j === i ? { ...x, [f.key]: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3">
            <p className="mb-2 text-[12px] text-muted">这些知识来自哪里？</p>
            <div className="flex flex-wrap gap-2">
              {SOURCE_TYPES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSourceType(s)}
                  className={`rounded-full px-3 py-1.5 text-[13px] transition ${
                    sourceType === s
                      ? 'bg-gold text-canvas'
                      : 'border border-ink/15 text-muted hover:border-ink/30'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button className="btn btn-primary" onClick={() => confirm()} disabled={loading}>
              确认收录
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              返回
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* 输入区 */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+64px)] z-20 bg-canvas py-2 sm:bottom-0">
        {uploading && (
          <p className="mb-2 text-center text-[12px] text-gold">
            正在读这份材料，读完会列出里面的知识点…
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.docx,.txt,.md"
          className="hidden"
          onChange={uploadFile}
        />
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={send}
          placeholder="说说你学到了什么…"
          loading={loading}
          onAttach={() => fileRef.current?.click()}
          attachDisabled={uploading || loading}
          hint="点左边的加号可以传笔记或截图"
        />
      </div>
      <div ref={bottomRef} />
    </div>
  )
}
