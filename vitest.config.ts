import { defineConfig } from 'vitest/config';

// Configuração só dos testes (sem o plugin de PWA do vite.config.ts)
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Datas do app são interpretadas no fuso do professor
    env: { TZ: 'America/Sao_Paulo' }
  }
});
