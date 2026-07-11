/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        phantom: {
          bg:      '#0A0E1A',
          surface: '#111827',
          card:    '#1A2235',
          border:  '#1E2D45',
          accent:  '#00D4FF',
          dim:     '#00A3C4',
          soft:    'rgba(0,212,255,0.12)',
          danger:  '#FF4757',
          warning: '#FFA502',
          success: '#2ED573',
          text:    '#EEF2FF',
          muted:   '#8899BB',
          faint:   '#445577',
        },
      },
      fontFamily: {
        sans:  ['var(--font-syne)', 'system-ui', 'sans-serif'],
        mono:  ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow':  'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':     'fadeIn 0.4s ease-out',
        'slide-up':    'slideUp 0.4s ease-out',
        'glow':        'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        glow:    { '0%': { boxShadow: '0 0 5px #00D4FF30' }, '100%': { boxShadow: '0 0 20px #00D4FF60' } },
      },
      backgroundImage: {
        'grid-pattern': 'radial-gradient(circle, #1E2D4520 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid': '32px 32px',
      },
    },
  },
  plugins: [],
};
