/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 生产部署用 standalone 产物，服务器无需安装完整依赖
  output: 'standalone',
  // 这里原本用 rewrites 把 /api 转发给后端，但 rewrites 内置 30 秒超时，
  // 整理知识这类要调模型的长任务会被掐断，用户只看到「请求失败」。
  // 改成由 app/api/[...path]/route.ts 自己转发，它不设超时。
  // 本地开发与服务器部署共用同一套，后端依然不需要对外暴露。
  experimental: {
    // 万一有请求又落回内置转发，也别用默认的 30 秒
    proxyTimeout: 600_000,
  },
}

module.exports = nextConfig
