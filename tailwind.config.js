/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0f1117', soft: '#161a23', card: '#1b202e', hover: '#232a3d', deep: '#0b0d13' },
        line: '#2a3145',
        accent: { DEFAULT: 'rgb(var(--lh-accent-rgb, 91 140 255) / <alpha-value>)', soft: '#223055' },
        txt: { DEFAULT: '#e6e9f2', dim: '#9aa3b8' }
      }
    }
  },
  plugins: []
}
