import OpenAI from 'openai'
import { env } from '../config/env'
import { extractJSON } from './json'

// LLM 统一封装。第一版用 DeepSeek（OpenAI 兼容协议），未来可替换 provider。
const openai = new OpenAI({
  apiKey: env.deepseekApiKey,
  baseURL: env.deepseekBaseUrl,
})

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2048,
  })
  return res.choices[0]?.message?.content ?? ''
}

export async function chatJSON<T>(messages: ChatMessage[], options?: ChatOptions): Promise<T> {
  const content = await chat(messages, { temperature: options?.temperature ?? 0.3, maxTokens: options?.maxTokens })
  return extractJSON<T>(content)
}
