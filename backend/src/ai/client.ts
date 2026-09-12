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
  return res.choices[0]?.message?.content ?? ''
}

export async function chatJSON<T>(messages: ChatMessage[], options?: ChatOptions): Promise<T> {
  const content = await chat(messages, { temperature: options?.temperature ?? 0.3, maxTokens: options?.maxTokens })
  return extractJSON<T>(content)
}
