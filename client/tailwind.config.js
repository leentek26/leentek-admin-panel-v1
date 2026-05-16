/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Semantic aliases
        primaryKey: '#22d3ee', // cyan-400 — opaque Primary Key
        displayCode: '#f59e0b', // amber-500 — human Display Code
      },
    },
  },
  plugins: [],
};
