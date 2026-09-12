import { FastifyInstance } from 'fastify'
import type { MultipartFile } from '@fastify/multipart'
import { getDefaultUserId } from '../services/user.service'
import { sanitizeAnswers } from '../ai/cards'
import {
  MaterialError,
  importMaterial,
  listMaterials,
  getMaterial,
  startItem,
  answerItem,
  addExample,
  getItemThread,
  completeItem,
  skipItem,
  dismissMaterial,
} from '../services/material.service'

// 材料导入相关的错误都是「能讲给用户听」的，统一转成 400 并带上原话
function fail(reply: any, e: unknown) {
  if (e instanceof MaterialError) return reply.code(400).send({ error: e.message })
  console.error('[材料] 处理失败', e)
  const message = e instanceof Error ? e.message : '处理失败'
  return reply.code(500).send({ error: message })
}

export async function materialRoutes(app: FastifyInstance) {
  // 上传一份材料：接受图片或文档，返回拆好的知识清单
  app.post('/api/material/import', async (req, reply) => {
    try {
      const userId = await getDefaultUserId()
      // multipart 的类型增强在独立插件作用域里不生效，这里按插件实际提供的接口声明
      const file = await (
        req as unknown as { file: () => Promise<MultipartFile | undefined> }
      ).file()
      if (!file) {
        return reply.code(400).send({ error: '没收到文件' })
      }
      const buffer = await file.toBuffer()
      if (buffer.length === 0) {
        return reply.code(400).send({ error: '文件是空的' })
      }
      const material = await importMaterial(userId, {
        filename: file.filename,
        mime: file.mimetype,
        buffer,
      })
      return reply.code(201).send(material)
    } catch (e) {
      return fail(reply, e)
    }
  })

  // 还没走完的材料（记录页顶部提示）
  app.get('/api/material/list', async () => {
    const userId = await getDefaultUserId()
    return listMaterials(userId)
  })

  app.get('/api/material/:id', async (req, reply) => {
    const userId = await getDefaultUserId()
    const { id } = req.params as { id: string }
    const material = await getMaterial(userId, id)
    if (!material) return reply.code(404).send({ error: '材料不存在' })
    return material
  })

  // 开始过一条：AI 先讲，再给第一批卡
  app.post('/api/material/:id/items/:itemId/start', async (req, reply) => {
    try {
      const userId = await getDefaultUserId()
      const { id, itemId } = req.params as { id: string; itemId: string }
      return await startItem(userId, id, itemId)
    } catch (e) {
      return fail(reply, e)
    }
  })

  // 刷新后接着答：把对话和还没答的卡取回来
  app.get('/api/material/items/:itemId/thread', async (req, reply) => {
    try {
      const userId = await getDefaultUserId()
      const { itemId } = req.params as { itemId: string }
      return await getItemThread(userId, itemId)
    } catch (e) {
      return fail(reply, e)
    }
  })

  // 交一批作答，拿判定和下一步的卡
  app.post('/api/material/items/:itemId/answer', async (req, reply) => {
    try {
      const userId = await getDefaultUserId()
      const { itemId } = req.params as { itemId: string }
      const { answers } = req.body as { answers?: unknown }
      const list = sanitizeAnswers(answers)
      const filled = list.some((a) => a.choice || a.text)
      if (!filled) return reply.code(400).send({ error: '还没作答' })
      return await answerItem(userId, itemId, list)
    } catch (e) {
      return fail(reply, e)
    }
  })

  // 补一个自己的例子（可选，不影响过关）
  app.post('/api/material/items/:itemId/example', async (req, reply) => {
    try {
      const userId = await getDefaultUserId()
      const { itemId } = req.params as { itemId: string }
      const { text } = req.body as { text?: string }
      if (!text || !text.trim()) return reply.code(400).send({ error: '还没写例子' })
      return await addExample(userId, itemId, text.trim())
    } catch (e) {
      return fail(reply, e)
    }
  })

  // 收录完成，把这条挂上知识 id
  app.post('/api/material/items/:itemId/complete', async (req, reply) => {
    try {
      const userId = await getDefaultUserId()
      const { itemId } = req.params as { itemId: string }
      const { knowledgeId } = req.body as { knowledgeId?: string }
      if (!knowledgeId) return reply.code(400).send({ error: '缺少知识 id' })
      return await completeItem(userId, itemId, knowledgeId)
    } catch (e) {
      return fail(reply, e)
    }
  })

  // 搁置这一条
  app.post('/api/material/items/:itemId/skip', async (req, reply) => {
    try {
      const userId = await getDefaultUserId()
      const { itemId } = req.params as { itemId: string }
      return await skipItem(userId, itemId)
    } catch (e) {
      return fail(reply, e)
    }
  })

  // 丢掉整份材料
  app.post('/api/material/:id/dismiss', async (req, reply) => {
    try {
      const userId = await getDefaultUserId()
      const { id } = req.params as { id: string }
      return await dismissMaterial(userId, id)
    } catch (e) {
      return fail(reply, e)
    }
  })
}
