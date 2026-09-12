// 默认走同源相对路径，由 next.config 的 rewrites 转发到后端
// 这样本地开发、服务器部署、手机访问都只有一套配置
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? ''

export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  // 无 body 时不带 Content-Type，否则后端会按空 JSON 解析并报错
  // 上传文件时也不能带，交给浏览器自己带 multipart 边界
  const headers = new Headers(options?.headers)
  const isForm = typeof FormData !== 'undefined' && options?.body instanceof FormData
  if (options?.body !== undefined && options.body !== null && !isForm && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    let msg = '请求失败'
    try {
      const err = await res.json()
      msg = err.error ?? err.message ?? msg
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const apiGet = <T = any>(path: string) => api<T>(path)

export const apiPost = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })

export const apiPatch = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined })

export const apiDelete = <T = any>(path: string) => api<T>(path, { method: 'DELETE' })

// 上传文件：走 multipart，交给浏览器设 Content-Type
export function apiUpload<T = any>(path: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<T>(path, { method: 'POST', body: form })
}
