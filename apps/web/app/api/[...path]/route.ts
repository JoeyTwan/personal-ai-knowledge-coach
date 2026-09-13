import { NextRequest } from 'next/server'

// 后端地址：本地开发与服务器部署共用这一套，后端不需要对外暴露
const BACKEND = process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:8787'

// 这些头交给 fetch 自己处理，原样转发会出错
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'transfer-encoding',
  'keep-alive',
])

// 整理知识、生成整理建议这类任务要调模型，几十秒到两三分钟都有可能。
// Next 自带的 rewrites 转发会在 30 秒把请求掐断，用户那边只看到「请求失败」，
// 所以这里自己写转发，不设超时。第一次收录长笔记就是被这一层挡住的
export const dynamic = 'force-dynamic'
export const maxDuration = 600

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const target = `${BACKEND}/api/${path.join('/')}${req.nextUrl.search}`

  const headers = new Headers()
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value)
  })

  const method = req.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  // 用 arrayBuffer 转发：文件上传的 multipart 边界靠原始字节保留
  const body = hasBody ? await req.arrayBuffer() : undefined

  try {
    const res = await fetch(target, { method, headers, body, redirect: 'manual' })
    const out = new Headers()
    res.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value)
    })
    return new Response(res.body, { status: res.status, headers: out })
  } catch (e) {
    console.error('[代理] 后端没响应', e)
    return Response.json({ error: '后端没响应，稍等一下再试' }, { status: 502 })
  }
}

export const GET = proxy
export const POST = proxy
export const PATCH = proxy
export const PUT = proxy
export const DELETE = proxy
