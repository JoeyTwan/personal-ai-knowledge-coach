import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1b1a18',
        paper: '#faf6ef',
        mist: '#f1ece2',
        gold: '#c2a36a',
        muted: '#8a8578',
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
      },
      opacity: {
        '8': '0.08',
        '15': '0.15',
        '85': '0.85',
      },
    },
  },
  plugins: [],
}
export default config
