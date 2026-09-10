import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'

// 领域自定义词典：补充默认词典缺失的技术与认知科学词汇，让检索和关系召回更准。
// 格式：词 词频 词性。词频越大越优先被识别为独立词。
const DOMAIN_DICT = [
  // 模型与技术
  '大模型 1000 n',
  '提示工程 1000 n',
  '检索增强 1000 n',
  '向量检索 1000 n',
  '知识图谱 1000 n',
  '上下文 1000 n',
  '上下文窗口 1500 n',
  '微调 1000 n',
  '幻觉 1000 n',
  '开源模型 1000 n',
  '闭源模型 1000 n',
  '推理成本 1000 n',
  '深度学习 1000 n',
  '神经网络 1000 n',
  '自注意力 1500 n',
  '注意力机制 1500 n',
  '算力 1000 n',
  '显存 1000 n',
  '嵌入 1000 n',
  // 认知与学习方法
  '认知负荷 1000 n',
  '间隔重复 1000 n',
  '主动回忆 1000 n',
  '组块化 1000 n',
  '工作记忆 1000 n',
  '遗忘曲线 1000 n',
  '元认知 1000 n',
  '心智模型 1000 n',
  // 英文术语
  'Transformer 1000 eng',
  'RAG 1000 eng',
  'LLM 1000 eng',
  'Prompt 1000 eng',
  'Token 1000 eng',
  'Embedding 1000 eng',
].join('\n')

let _jieba: Jieba | null = null

// 单例：词典体积较大，避免每次分词重复加载
export function getJieba(): Jieba {
  if (!_jieba) {
    _jieba = Jieba.withDict(dict)
    _jieba.loadDict(Buffer.from(DOMAIN_DICT))
  }
  return _jieba
}

// 中文分词 + 过滤：返回可用于检索的实词列表
export function tokenize(text: string): string[] {
  const words = getJieba().cut(text)
  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of words) {
    const t = raw.trim()
    if (!t || seen.has(t)) continue
    // 保留英文/数字字母词（任意长度），或长度 >= 2 的中文词；过滤单字虚词和标点
    if (/^[a-zA-Z0-9][a-zA-Z0-9+./#-]*$/.test(t) || t.length >= 2) {
      seen.add(t)
      result.push(t)
    }
  }
  return result.slice(0, 15)
}
