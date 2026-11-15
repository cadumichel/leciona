// Tailwind compilado no build (antes vinha por CDN a cada abertura do app).
// Mesma versão e mesma configuração do CDN antigo, para o visual ficar idêntico.
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './utils/**/*.ts',
    './utils.ts',
    './constants.ts',
  ],
  theme: { extend: {} },
  plugins: [],
};
