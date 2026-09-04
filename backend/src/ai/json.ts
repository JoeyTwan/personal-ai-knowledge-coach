// 从 LLM 输出中安全提取 JSON
export function extractJSON<T>(text: string): T {
  // 1. 直接解析
  try {
    return JSON.parse(text) as T
  } catch {
    /* ignore */
  }

  // 2. 提取 ```json ... ``` 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) {
    try {
      return JSON.parse(fence[1]) as T
    } catch {
      /* ignore */
    }
  }

  // 3. 提取第一个 { 到最后一个 }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T
    } catch {
      /* ignore */
    }
  }

  // 4. 提取第一个 [ 到最后一个 ]
  const arrStart = text.indexOf('[')
  const arrEnd = text.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(text.slice(arrStart, arrEnd + 1)) as T
    } catch {
      /* ignore */
    }
  }

  throw new Error('无法从 LLM 输出中解析出有效 JSON')
}
