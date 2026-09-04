const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
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
