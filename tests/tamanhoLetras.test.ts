import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// A opção "Tamanho das letras" (Ajustes) só aumenta as classes que estão em styles/tamanhoLetras.css.
// Se o app passar a usar um tamanho novo, rode: node scripts/gerarTamanhoLetras.mjs
describe('tamanho das letras', () => {
  const css = readFileSync('styles/tamanhoLetras.css', 'utf8');
  const files = ['App.tsx', ...readdirSync('components').filter(f => f.endsWith('.tsx')).map(f => join('components', f))];
  const used = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?<![\w-])((?:sm|md|lg|xl):)?text-(\[\d+px\]|xs|sm|base|lg|xl|2xl|3xl|4xl)(?![\w-])/g)) used.add(m[0]);
  }
  const esc = (c: string) => c.replace(/([:\[\].])/g, '\\$1');

  it('cobre todos os tamanhos de letra usados nas telas', () => {
    const missing = [...used].filter(c => !css.includes(`html[data-letras="grande"] .${esc(c)} {`) || !css.includes(`html[data-letras="maior"] .${esc(c)} {`));
    expect(missing).toEqual([]);
  });
});
