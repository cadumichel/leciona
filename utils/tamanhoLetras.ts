/**
 * Tamanho das letras (Ajustes → Aparência). Vale só para este aparelho: fica no localStorage,
 * fora dos dados sincronizados, porque celular e computador costumam pedir tamanhos diferentes.
 * O CSS de cada tamanho está em styles/tamanhoLetras.css (gerado por scripts/gerarTamanhoLetras.mjs).
 */
export type TamanhoLetras = 'normal' | 'grande' | 'maior';

export const TAMANHO_LETRAS_KEY = 'leciona-tamanho-letras';

export const TAMANHOS_LETRAS: { value: TamanhoLetras; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'grande', label: 'Grande' },
  { value: 'maior', label: 'Maior' },
];

export function lerTamanhoLetras(): TamanhoLetras {
  try {
    const v = localStorage.getItem(TAMANHO_LETRAS_KEY);
    return v === 'grande' || v === 'maior' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function aplicarTamanhoLetras(t: TamanhoLetras): void {
  if (typeof document === 'undefined') return;
  if (t === 'normal') delete document.documentElement.dataset.letras;
  else document.documentElement.dataset.letras = t;
}

export function salvarTamanhoLetras(t: TamanhoLetras): void {
  try {
    if (t === 'normal') localStorage.removeItem(TAMANHO_LETRAS_KEY);
    else localStorage.setItem(TAMANHO_LETRAS_KEY, t);
  } catch { /* sem armazenamento: vale até fechar o app */ }
  aplicarTamanhoLetras(t);
}
