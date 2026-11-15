// Gera styles/tamanhoLetras.css: tamanhos de letra maiores para a opção
// Ajustes → Aparência → Tamanho das letras (html[data-letras="grande" | "maior"]).
// Rode de novo se o app passar a usar um tamanho novo: node scripts/gerarTamanhoLetras.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const levels = { grande: 1.12, maior: 1.25 };
// [classe, tamanho em px, altura da linha em px (null = não mexe)]
const named = [
  ['text-xs', 12, 16], ['text-sm', 14, 20], ['text-base', 16, 24], ['text-lg', 18, 28],
  ['text-xl', 20, 28], ['text-2xl', 24, 32], ['text-3xl', 30, 36], ['text-4xl', 36, 40],
];
const arbitrary = [7, 8, 9, 10, 11, 12, 13, 14].map(px => [`text-[${px}px]`, px, null]);
const all = [...arbitrary, ...named];
const prefixes = [['', null], ['sm:', 640], ['md:', 768], ['lg:', 1024], ['xl:', 1280]];

const esc = c => c.replace(/([:\[\].])/g, '\\$1');
const round = n => Math.round(n * 10) / 10;

let css = '/* Gerado por scripts/gerarTamanhoLetras.mjs. Não edite à mão. */\n';
for (const [level, f] of Object.entries(levels)) {
  css += `\n/* ${level}: ${Math.round((f - 1) * 100)}% maior */\n`;
  for (const [prefix, bp] of prefixes) {
    const rules = all.map(([cls, px, lh]) =>
      `html[data-letras="${level}"] .${esc(prefix + cls)} { font-size: ${round(px * f)}px;${lh ? ` line-height: ${round(lh * f)}px;` : ''} }`
    ).join('\n');
    css += bp ? `@media (min-width: ${bp}px) {\n${rules}\n}\n` : rules + '\n';
  }
}
mkdirSync('styles', { recursive: true });
writeFileSync('styles/tamanhoLetras.css', css);
console.log('styles/tamanhoLetras.css', css.length, 'bytes');
