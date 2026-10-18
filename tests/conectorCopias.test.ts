import { describe, it, expect } from 'vitest';
import { copiasVencidas, dadosDaCopia, dadosSemInfo, documentoRestaurado, resumoDosDados } from '../connector/copias';
import { mergeAppData } from '../utils/sync';

// Dados inventados
const doc = (): any => ({
  profile: { name: 'Prof' }, settings: {},
  schools: [
    { id: 'C', name: 'Escola', classes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', deleted: true }, 'Legada'] },
    { id: 'X', name: 'Antiga', deleted: true, classes: [{ id: 'x', name: 'X' }] }
  ],
  events: [{ id: 'p1', type: 'test' }, { id: 't1', type: 'work' }, { id: 'm1', type: 'meeting' }],
  logs: [{ id: 'l1' }, { id: 'l2' }],
  reminders: [{ id: 'r1' }],
  grades: [],
  updatedAt: { seconds: 1 }
});

describe('cópias de segurança', () => {
  it('resume só em números (sem conteúdo)', () => {
    expect(resumoDosDados(doc())).toEqual({ escolas: 1, turmas: 2, avaliacoes: 2, eventos: 1, registrosDoDiario: 2, lembretes: 1, notas: 0 });
  });

  it('guarda os dados sem a marca de atualização e com as informações da cópia', () => {
    const c = dadosDaCopia(doc(), { criadaEm: '2026-10-21T06:00:00.000Z', tipo: 'diaria' });
    expect(c).not.toHaveProperty('updatedAt');
    expect(c._copia).toMatchObject({ tipo: 'diaria', resumo: { avaliacoes: 2 } });
    expect(dadosSemInfo(c)).not.toHaveProperty('_copia');
  });

  it('apaga só as com mais de 30 dias', () => {
    const lista = [
      { id: '2026-09-20', criadaEm: '2026-09-20T06:00:00.000Z' },
      { id: '2026-09-21', criadaEm: '2026-09-21T06:00:00.000Z' },
      { id: 'antes-de-restaurar-x', criadaEm: '2026-09-01T12:00:00.000Z' }
    ];
    expect(copiasVencidas(lista, '2026-10-21')).toEqual(['2026-09-20', 'antes-de-restaurar-x']);
  });

  it('restaurar vence as cópias antigas nos outros aparelhos e mantém as marcas já aplicadas', () => {
    const copia = dadosDaCopia(doc(), { criadaEm: '2026-10-20T06:00:00.000Z', tipo: 'diaria' });
    const atual = { ...doc(), events: [...doc().events, { id: 'novo', type: 'test', _m: 5 }], _yearResetAt: 'marca', _schoolYear: 2026 };
    const restaurado = documentoRestaurado(atual, copia, 1000);
    expect(restaurado._deleted).toEqual({ novo: 1000 });
    expect(restaurado.events.every((e: any) => e._m === 1000)).toBe(true);
    expect(restaurado).toMatchObject({ _yearResetAt: 'marca', _schoolYear: 2026 });
    expect(restaurado).not.toHaveProperty('_copia');
    // Um aparelho que ainda tem a avaliação nova (sem alteração pendente) junta e ela some
    const juntos = mergeAppData(restaurado, atual, 2000);
    expect(juntos.events.map((e: any) => e.id)).toEqual(['p1', 't1', 'm1']);
  });
});
