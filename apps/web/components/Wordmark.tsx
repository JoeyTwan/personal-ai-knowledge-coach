// 品牌字标：只靠排版，不加图标
// 明朝体常规字重 + 拉开字距，「人生」与「知识库」之间留一处呼吸，
// 让四个字读起来是两组，而不是平铺的一串
//
// 字距用行内样式，因为 .h-serif 里写死了 letter-spacing 且优先级压过工具类
const TRACKING = { letterSpacing: '0.1em' } as const

export default function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`h-serif inline-flex items-baseline text-[17px] font-normal leading-none ${className}`}
      style={TRACKING}
    >
      <span>人生</span>
      <span className="ml-[0.45em]">知识库</span>
    </span>
  )
}
