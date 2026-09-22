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
          // Was #445577, which scored 2.1–2.6:1 against the three surface
          // colours — far below the WCAG AA 4.5:1 minimum, on the token used
          // for every section header, timestamp and helper line. #7A8CA0
          // clears AA on bg (5.6), surface (5.1) and card (4.6), and matches
          // the mobile app's token so the two clients share one scale.
          faint:   '#7A8CA0',
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
