import OpenAI from 'openai'
import { env } from '../config/env'
import { extractJSON } from './json'

// LLM 统一封装。第一版用 DeepSeek（OpenAI 兼容协议），未来可替换 provider。
const openai = new OpenAI({
  apiKey: env.deepseekApiKey,
  baseURL: env.deepseekBaseUrl,
})

// 多模态消息：content 可以是纯文本，也可以是文本 + 图片块的数组
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'original' | 'auto' } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

// 把本地图片编码成 data URL（模型侧按内容判断格式，这里只负责拼装）
export function imageDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

// 判断 MIME 是否属于模型支持的四类图片
export function isSupportedImage(mime: string): boolean {
  return ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(
    mime.toLowerCase(),
  )
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

export class AIError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIError'
  }
}

export async function chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
  if (!env.deepseekApiKey) {
    throw new AIError('未配置 DEEPSEEK_API_KEY，请在 .env 中填入后重启服务')
  }
  const res = await openai.chat.completions.create({
    model: env.deepseekModel,
    // content 允许是文本块数组（多模态），SDK 类型收得比较死，这里按协议内容断言
    messages: messages as never,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2048,
  })
  const choice = res.choices[0]
  const content = choice?.message?.content ?? ''
  // 这个模型是推理模型，思考过程也占 token 预算。预算不够时正文会是空的，
  // 光看「空回复」判断不出原因，把 finish_reason 和思考用量一起记下来
  if (!content) {
    const usage = res.usage as
      | { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }
      | undefined
    console.error(
      `[AI] 空回复 finish_reason=${choice?.finish_reason} 输出token=${usage?.completion_tokens ?? '?'} 其中思考=${usage?.completion_tokens_details?.reasoning_tokens ?? '?'}`,
    )
  }
  return content
}

export async function chatJSON<T>(messages: ChatMessage[], options?: ChatOptions): Promise<T> {
  const first = await chat(messages, {
    temperature: options?.temperature ?? 0.3,
    maxTokens: options?.maxTokens,
  })
  try {
    return extractJSON<T>(first)
  } catch {
    // 模型偶尔会输出空内容或被截断。原样记下来，方便判断是没输出还是输出坏了
    console.error('[AI] JSON 解析失败，原始输出：', first.slice(0, 800) || '（空回复）')
  }

  // 给一次补救机会：明确要求只输出 JSON，不再带任何解释文字
  // 输出预算翻倍——空回复多半是思考把预算吃光了，原样再来一次还是空
  const second = await chat(
    [...messages, { role: 'assistant', content: first }, { role: 'user', content: '（只输出合法 JSON 本身，不要任何解释、不要代码块围栏。）' }],
    { temperature: 0.2, maxTokens: (options?.maxTokens ?? 2048) * 2 },
  )
  try {
    return extractJSON<T>(second)
  } catch {
    console.error('[AI] JSON 解析二次失败，原始输出：', second.slice(0, 800) || '（空回复）')
    throw new Error('这次没能整理出结构，稍后再试一次')
  }
}
