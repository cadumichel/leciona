import { describe, it, expect } from 'vitest';
import { lessonDraftKey, loadDraft, saveDraft, removeDraft, DRAFTS_KEY } from '../utils/lessonDraft';

const memStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    m,
  };
};

const now = new Date('2026-11-04T11:30:00Z');
const text = { subject: 'Revolução Francesa', homework: 'pág. 42', notes: '' };

describe('rascunho do registro de aula', () => {
  it('chave separa aula da grade e aula extra, e ignora a hora da data', () => {
    expect(lessonDraftKey('sc1', 'sh1', 's2', '2026-11-04T00:00:00.000Z')).toBe('sc1|grade|s2|2026-11-04');
    expect(lessonDraftKey('sc1', 'extra', 'log9', '2026-11-04')).toBe('sc1|extra|log9|2026-11-04');
  });

  it('guarda, lê e apaga', () => {
    const s = memStore();
    const k = lessonDraftKey('sc1', 'sh1', 's2', '2026-11-04');
    saveDraft(k, text, now, s);
    expect(loadDraft(k, now, s)).toMatchObject(text);
    removeDraft(k, now, s);
    expect(loadDraft(k, now, s)).toBeNull();
    expect(s.m.has(DRAFTS_KEY)).toBe(false);
  });

  it('texto vazio apaga o rascunho', () => {
    const s = memStore();
    saveDraft('a', text, now, s);
    saveDraft('a', { subject: '  ', homework: '', notes: '' }, now, s);
    expect(loadDraft('a', now, s)).toBeNull();
  });

  it('mesmo texto mantém a hora original', () => {
    const s = memStore();
    saveDraft('a', text, now, s);
    saveDraft('a', text, new Date('2026-11-04T12:00:00Z'), s);
    expect(loadDraft('a', now, s)?.savedAt).toBe(now.toISOString());
  });

  it('descarta rascunhos com mais de 14 dias', () => {
    const s = memStore();
    saveDraft('a', text, now, s);
    expect(loadDraft('a', new Date('2026-11-17T11:30:00Z'), s)).not.toBeNull();
    expect(loadDraft('a', new Date('2026-11-19T11:30:00Z'), s)).toBeNull();
  });

  it('dado corrompido não quebra', () => {
    const s = memStore();
    s.setItem(DRAFTS_KEY, '{oops');
    expect(loadDraft('a', now, s)).toBeNull();
    saveDraft('a', text, now, s);
    expect(loadDraft('a', now, s)).toMatchObject(text);
  });
});
