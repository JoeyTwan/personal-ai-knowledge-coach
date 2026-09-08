import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 全部走 CSS 变量，支持暗夜 / 明亮两套主题（默认暗夜）
        canvas: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        surface2: 'rgb(var(--surface2) / <alpha-value>)',
        ink: 'rgb(var(--text) / <alpha-value>)',
        muted: 'rgb(var(--text2) / <alpha-value>)',
        faint: 'rgb(var(--text3) / <alpha-value>)',
        gold: 'rgb(var(--accent) / <alpha-value>)',
        'gold-bright': 'rgb(var(--accentStrong) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        // 兼容旧命名
        paper: 'rgb(var(--bg) / <alpha-value>)',
        mist: 'rgb(var(--surface2) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'sans-serif',
        ],
        serif: ['Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', 'serif'],
      },
      opacity: {
        '8': '0.08',
        '12': '0.12',
        '15': '0.15',
        '85': '0.85',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
export default config
