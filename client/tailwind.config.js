/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // ─── Leentek brand palette ──────────────────────
        brand: {
          orange: '#E8762A',
          orangeDeep: '#E85A30',
          magenta: '#C23074',
          purple: '#6B2D7B',
          purpleDeep: '#2D1B69',
          purpleNav: '#1A0F3D', // sidebar bg
          cyan: '#22D3EE',
          red: '#DC2626',
        },
        // ─── Surfaces ───────────────────────────────────
        page: '#0C0C0C',
        card: '#161616',
        cardHover: '#1E1E1E',
        line: '#222222',
        lineSoft: '#2A2A2A',
        // ─── Ink / text scale (replaces slate-*) ────────
        ink: {
          50: '#F5F5F5',
          100: '#E8E8E8', // primary text
          300: '#8A8A8A', // muted text
          500: '#6B6B6B', // subtle text
          700: '#444444',
          900: '#222222',
        },
        // ─── Legacy semantic aliases ────────────────────
        primaryKey: '#22D3EE', // cyan — opaque Primary Key
        displayCode: '#E8762A', // orange — human Display Code (rebranded from amber)
      },
      backgroundImage: {
        'brand-gradient':
          'linear-gradient(135deg, #2D1B69 0%, #6B2D7B 25%, #C23074 55%, #E85A30 80%, #E8762A 100%)',
        'brand-btn':
          'linear-gradient(135deg, #C23074 0%, #E8762A 100%)',
        'brand-btn-hover':
          'linear-gradient(135deg, #D43C84 0%, #F08840 100%)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(232, 118, 42, 0.4), 0 0 12px rgba(232, 118, 42, 0.25)',
      },
    },
  },
  plugins: [],
};
