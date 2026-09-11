/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 生产部署用 standalone 产物，服务器无需安装完整依赖
  output: 'standalone',
  async rewrites() {
    // 浏览器只访问前端端口，/api 请求由前端转发给后端
    // 本地开发与服务器部署共用这一套，后端无需对外暴露
    const backend = process.env.BACKEND_ORIGIN ?? 'http://127.0.0.1:8787'
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }]
  },
}

module.exports = nextConfig
