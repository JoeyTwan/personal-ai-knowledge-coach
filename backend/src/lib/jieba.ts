import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'

// 华为昇腾/鲲鹏 + AI 硬件领域自定义词典，补充默认词典缺失的领域词。
// 格式：词 词频 词性。词频越大越优先被识别为独立词。
const DOMAIN_DICT = [
  '昇腾 1000 n',
  '算力 1000 n',
  '鲲鹏 1000 n',
  '显存 1000 n',
  '液冷 1000 n',
  '风冷 1000 n',
  '整机 1000 n',
  '载板 1000 n',
  '模组 1000 n',
  '大模型 1000 n',
  '推理卡 1000 n',
  '训练卡 1000 n',
  '自注意力 1000 n',
  '感受野 1000 n',
  '知识图谱 1000 n',
  '向量检索 1000 n',
  '深度学习 1000 n',
  '神经网络 1000 n',
  'Transformer 1000 eng',
  'Atlas 1000 n',
  'NPU 1000 n',
  'HBM 1000 n',
  'TOPS 1000 n',
  'TFLOPS 1000 n',
  'FP16 1000 n',
  'FP32 1000 n',
  'INT8 1000 n',
  'INT4 1000 n',
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
