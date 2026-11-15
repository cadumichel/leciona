import { describe, it, expect } from 'vitest';
import { seriesKey, suggestContentFromSiblings, relativeDayLabel } from '../utils/otherClassContent';

const school = (id: string, names: string[]) => ({
  id, name: id, color: '', subjects: [], shifts: [],
  classes: names.map(n => ({ id: `${id}-${n}`, name: n }))
});
const log = (id: string, schoolId: string, classId: string, date: string, subject: string, extra: Record<string, unknown> = {}) =>
  ({ id, schoolId, classId, slotId: 's', date: `${date}T00:00:00.000Z`, subject, homework: '', notes: '', ...extra });

const data = {
  schools: [school('consul', ['183', '184', '163']), school('uni', ['1ª Série A', '1ª Série B', '2ª Série'])],
  logs: [
    log('a', 'consul', 'consul-183', '2026-11-09', 'Revolução Francesa: Terror', { homework: 'pág. 40' }),
    log('b', 'consul', 'consul-183', '2026-11-02', 'Revolução Francesa: Estados Gerais'),
    log('c', 'consul', 'consul-163', '2026-11-10', 'Grécia Antiga'),
    log('d', 'consul', 'consul-183', '2026-11-10', 'Avaliação: P2'),
    log('e', 'consul', 'consul-183', '2026-11-11', 'Napoleão', { status: 'removed' }),
    log('f', 'uni', 'uni-1ª Série A', '2026-11-12', 'Feudalismo'),
  ]
} as any;

describe('usar conteúdo de outra turma', () => {
  it('reconhece a série pelo nome da turma', () => {
    expect(['183', '184', '163', '1ª Série A', '6º MAT', '9ª ano 1', '9º ano 2', '3ª Série', 'Ap Prova'].map(seriesKey))
      .toEqual(['18', '18', '16', '1', '6', '9', '9', '3', null]);
  });

  it('sugere o registro mais recente da turma irmã, sem automáticos nem removidos', () => {
    const s = suggestContentFromSiblings(data, { schoolId: 'consul', classId: 'consul-184', date: '2026-11-11', previousDate: '2026-11-04' });
    expect(s.map(x => [x.className, x.date, x.subject, x.homework])).toEqual([['183', '2026-11-09', 'Revolução Francesa: Terror', 'pág. 40']]);
  });

  it('não sugere o que esta turma já teve nem registros anteriores à aula anterior', () => {
    expect(suggestContentFromSiblings(data, { schoolId: 'consul', classId: 'consul-184', date: '2026-11-11', previousDate: '2026-11-10' })).toEqual([]);
    expect(suggestContentFromSiblings(data, { schoolId: 'consul', classId: 'consul-184', date: '2026-11-11', previousSubject: ' revolução francesa:  terror ' })
      .map(x => x.subject)).toEqual(['Revolução Francesa: Estados Gerais']);
  });

  it('não olha registros depois do dia da aula nem de outra escola', () => {
    expect(suggestContentFromSiblings(data, { schoolId: 'consul', classId: 'consul-184', date: '2026-11-05' }).map(x => x.date)).toEqual(['2026-11-02']);
    expect(suggestContentFromSiblings(data, { schoolId: 'uni', classId: 'uni-1ª Série B', date: '2026-11-13' }).map(x => x.className)).toEqual(['1ª Série A']);
    expect(suggestContentFromSiblings(data, { schoolId: 'uni', classId: 'uni-2ª Série', date: '2026-11-13' })).toEqual([]);
  });

  it('aceita a turma pelo nome (grade) além do código', () => {
    expect(suggestContentFromSiblings(data, { schoolId: 'consul', classId: '184', date: '2026-11-11' }).map(x => x.className)).toEqual(['183']);
  });

  it('mostra o dia como hoje, ontem ou dd/mm', () => {
    expect(['2026-11-15', '2026-11-14', '2026-11-09'].map(d => relativeDayLabel(d, '2026-11-15'))).toEqual(['hoje', 'ontem', '09/11']);
  });
});
