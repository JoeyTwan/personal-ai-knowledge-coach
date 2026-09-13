import OpenAI from 'openai'
import { env } from '../config/env'
import { extractJSON } from './json'

// LLM 统一封装。第一版用 DeepSeek（OpenAI 兼容协议），未来可替换 provider。
const openai = new OpenAI({
  apiKey: env.deepseekApiKey,
  baseURL: env.deepseekBaseUrl,
  // 推理模型偶尔会长时间思考不返回（同样一个整理任务，实测 47 秒能成，也遇到过一次
  // 跑满六分钟还没结束）。SDK 默认 10 分钟太久，卡住时用户只能干等，
  // 收到两分钟：正常任务 40 到 60 秒就回来了，超过这个数是卡了，早点掐掉重来
  timeout: 120_000,
})

// 单次调用的输出上限。这个模型是推理模型，思考过程同样计入输出预算：
// 写小了会在「想完了但还没开始写正文」的时候被截断，正文变空白；
// 完全不设则可能一直想下去不返回（实测有过跑了六分钟没结束）。
// 32768 是按实测定的：够它想完再写完，同时兜住上限
const DEFAULT_MAX_TOKENS = 32768

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
  // 基本不用传，走 DEFAULT_MAX_TOKENS 就好。
  // 这个模型是推理模型，思考过程同样计入输出预算，写死一个偏小的值
  // 会出现「思考已经用光、正文还没开始写」的空回复。只有确实要压短输出时才传
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
  // 输出上限：调用方指定的优先，其次看 .env 里的总闸 AI_MAX_TOKENS，都没写就用默认值。
  // 注意一定要有个上限，完全不传这个字段可能让模型一直思考下去不返回
  const maxTokens = options?.maxTokens ?? env.aiMaxTokens ?? DEFAULT_MAX_TOKENS
  const res = await openai.chat.completions.create({
    model: env.deepseekModel,
    // content 允许是文本块数组（多模态），SDK 类型收得比较死，这里按协议内容断言
    messages: messages as never,
    temperature: options?.temperature ?? 0.7,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  })
  const choice = res.choices[0]
  const content = choice?.message?.content ?? ''
  const usage = res.usage as
    | {
        prompt_tokens?: number
        completion_tokens?: number
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    | undefined
  // 这个模型是推理模型，思考过程也占 token 预算。预算不够时正文会是空的，
  // 光看「空回复」判断不出原因，把 finish_reason 和思考用量一起记下来
  if (!content) {
    console.error(
      `[AI] 空回复 finish_reason=${choice?.finish_reason} 输出token=${usage?.completion_tokens ?? '?'} 其中思考=${usage?.completion_tokens_details?.reasoning_tokens ?? '?'}`,
    )
  } else if (process.env.AI_LOG_USAGE === '1') {
    // 想在 .env 里看花销就打开 AI_LOG_USAGE=1
    console.log(
      `[AI] 用量 输入=${usage?.prompt_tokens ?? '?'} 输出=${usage?.completion_tokens ?? '?'} 其中思考=${usage?.completion_tokens_details?.reasoning_tokens ?? '?'} finish=${choice?.finish_reason}`,
    )
  }
  return content
}

export async function chatJSON<T>(messages: ChatMessage[], options?: ChatOptions): Promise<T> {
  const ask = () =>
    chat(messages, {
      temperature: options?.temperature ?? 0.3,
      maxTokens: options?.maxTokens,
    })

  let first = ''
  try {
    first = await ask()
  } catch (e) {
    // 推理模型偶尔会想很久，最后撞上超时。这种失败跟内容没关系，原样重来一次多半能成
    console.error('[AI] 调用超时或失败，原样重来一次：', e instanceof Error ? e.message : e)
    first = await ask()
  }
  try {
    return extractJSON<T>(first)
  } catch {
    // 模型偶尔会输出空内容或被截断。原样记下来，方便判断是没输出还是输出坏了
    console.error('[AI] JSON 解析失败，原始输出：', first.slice(0, 800) || '（空回复）')
  }

  // 给一次补救机会：明确要求只输出 JSON，不再带任何解释文字。
  // 这次不带调用方的预算设定，直接用默认的大额度，避免上次就是被预算卡住的
  const second = await chat(
    [...messages, { role: 'assistant', content: first }, { role: 'user', content: '（只输出合法 JSON 本身，不要任何解释、不要代码块围栏。）' }],
    { temperature: 0.2 },
  )
  try {
    return extractJSON<T>(second)
  } catch {
    console.error('[AI] JSON 解析二次失败，原始输出：', second.slice(0, 800) || '（空回复）')
    throw new Error('这次没能整理出结构，稍后再试一次')
  }
}
