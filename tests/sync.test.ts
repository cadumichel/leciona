import { describe, it, expect } from 'vitest';
import {
  trackChanges, mergeAppData, mergeCollection, mergeTombstones, prepareRestore,
  removeUndefined, TOMBSTONE_TTL_MS, SyncedData
} from '../utils/sync';

const base = (over: Partial<SyncedData> = {}): SyncedData => ({
  profile: { name: 'Cadu', subjects: [] },
  schools: [], students: [], classRecords: [], schedules: [], scheduleVersions: [],
  logs: [], events: [], calendars: [], reminders: [], grades: [],
  customAssessments: [], gradingConfigs: [],
  settings: { themeColor: '#2563eb' } as any,
  ...over
} as SyncedData);

const T0 = 1_760_000_000_000;

describe('trackChanges', () => {
  it('carimba só o item editado e mantém a referência dos demais', () => {
    const a = { id: 'a', subject: 'x' };
    const b = { id: 'b', subject: 'y' };
    const prev = base({ logs: [a, b] as any });
    const next = base({ logs: [a, { ...b, subject: 'z' }] as any });
    const out = trackChanges(prev, next, T0);
    expect(out.logs[0]).toBe(a);
    expect((out.logs[1] as any)._m).toBe(T0);
  });

  it('registra lápide para item removido', () => {
    const prev = base({ events: [{ id: 'p1' }, { id: 'p2' }] as any });
    const next = base({ events: [{ id: 'p2' }] as any });
    const out = trackChanges(prev, next, T0);
    expect(out._deleted).toEqual({ p1: T0 });
  });

  it('não carimba item que só mudou de referência sem mudar conteúdo', () => {
    const prev = base({ reminders: [{ id: 'r', title: 't' }] as any });
    const next = base({ reminders: [{ id: 'r', title: 't' }] as any });
    const out = trackChanges(prev, next, T0);
    expect((out.reminders[0] as any)._m).toBeUndefined();
  });

  it('carimba profile/settings alterados', () => {
    const prev = base();
    const next = base({ settings: { themeColor: '#000' } as any });
    expect(trackChanges(prev, next, T0)._fieldM).toEqual({ settings: T0 });
  });

  it('item recriado com id que tinha lápide perde a lápide', () => {
    const prev = base({ grades: [] as any, _deleted: { g1: T0 - 10 } });
    const next = base({ grades: [{ id: 'g1', value: 7 }] as any, _deleted: { g1: T0 - 10 } });
    const out = trackChanges(prev, next, T0);
    expect(out._deleted).toBeUndefined();
  });
});

describe('mergeAppData — cenários que perdiam dados na versão anterior', () => {
  it('prova apagada no computador NÃO volta pelo celular', () => {
    // Computador apagou P1 e enviou a lápide para a nuvem
    const cloud = base({ events: [] as any, _deleted: { P1: T0 } });
    // Celular ainda tem P1 na cópia local
    const phone = base({ events: [{ id: 'P1', title: 'Prova AV2' }] as any });
    const merged = mergeAppData(cloud, phone, T0 + 1000);
    expect(merged.events).toHaveLength(0);
  });

  it('nota corrigida sem internet não volta ao valor antigo', () => {
    // Na nuvem: nota 5 (id G1). No celular, offline: corrigiu para 8 (novo id G2, lápide em G1)
    const cloud = base({ grades: [{ id: 'G1', studentId: 'ana', assessmentId: 'P1', value: 5 }] as any });
    const prevPhone = base({ grades: [{ id: 'G1', studentId: 'ana', assessmentId: 'P1', value: 5 }] as any });
    const nextPhone = base({ grades: [{ id: 'G2', studentId: 'ana', assessmentId: 'P1', value: 8 }] as any });
    const phone = trackChanges(prevPhone, nextPhone, T0);
    const merged = mergeAppData(cloud, phone, T0 + 1000);
    expect(merged.grades.map((g: any) => g.value)).toEqual([8]);
  });

  it('conteúdo editado sem internet vence a versão antiga da nuvem', () => {
    const cloud = base({ logs: [{ id: 'L1', subject: 'Era Vargas (rascunho)' }] as any });
    const phone = trackChanges(
      base({ logs: [{ id: 'L1', subject: 'Era Vargas (rascunho)' }] as any }),
      base({ logs: [{ id: 'L1', subject: 'Era Vargas: Estado Novo e CLT' }] as any }),
      T0
    );
    expect(mergeAppData(cloud, phone, T0 + 1).logs[0].subject).toBe('Era Vargas: Estado Novo e CLT');
  });

  it('edição mais recente de outro aparelho vence edição local mais antiga', () => {
    const cloud = base({ logs: [{ id: 'L1', subject: 'versão PC', _m: T0 + 500 }] as any });
    const phone = base({ logs: [{ id: 'L1', subject: 'versão celular', _m: T0 }] as any });
    expect(mergeAppData(cloud, phone, T0 + 1000).logs[0].subject).toBe('versão PC');
  });

  it('item novo criado só no celular é mantido', () => {
    const cloud = base({ logs: [{ id: 'L1' }] as any });
    const phone = base({ logs: [{ id: 'L1' }, { id: 'L2', subject: 'nova' }] as any });
    expect(mergeAppData(cloud, phone, T0).logs.map((l: any) => l.id).sort()).toEqual(['L1', 'L2']);
  });

  it('item novo criado em outro aparelho chega ao celular', () => {
    const cloud = base({ reminders: [{ id: 'R1' }, { id: 'R2' }] as any });
    const phone = base({ reminders: [{ id: 'R1' }] as any });
    expect(mergeAppData(cloud, phone, T0).reminders).toHaveLength(2);
  });

  it('dados antigos sem carimbo: nuvem vence (comportamento anterior preservado)', () => {
    const cloud = base({ schools: [{ id: 'S1', name: 'Cônsul' }] as any });
    const phone = base({ schools: [{ id: 'S1', name: 'Consul' }] as any });
    expect(mergeAppData(cloud, phone, T0).schools[0].name).toBe('Cônsul');
  });

  it('configurações alteradas offline são mantidas', () => {
    const cloud = base({ settings: { themeColor: '#2563eb' } as any });
    const phone = base({ settings: { themeColor: '#10b981' } as any, _fieldM: { settings: T0 } });
    expect((mergeAppData(cloud, phone, T0).settings as any).themeColor).toBe('#10b981');
  });

  it('lápides vencidas são descartadas', () => {
    const old = T0 - TOMBSTONE_TTL_MS - 1;
    expect(mergeTombstones({ a: old, b: T0 }, {}, T0)).toEqual({ b: T0 });
  });

  it('itens sem id da grade legada não somem', () => {
    const merged = mergeCollection([{ dayOfWeek: 1 } as any], [], {});
    expect(merged).toHaveLength(1);
  });
});

describe('prepareRestore', () => {
  it('itens que não estão no backup ganham lápide e o backup vence cópias antigas', () => {
    const current = base({ events: [{ id: 'novo' }, { id: 'velho' }] as any });
    const backup = base({ events: [{ id: 'velho', title: 'do backup' }] as any });
    const restored = prepareRestore(current, backup, T0);
    expect(restored._deleted).toEqual({ novo: T0 });
    // Outro aparelho que ainda tem "novo" e uma versão antiga de "velho"
    const other = base({ events: [{ id: 'novo' }, { id: 'velho', title: 'antigo' }] as any });
    const merged = mergeAppData(restored, other, T0 + 1);
    expect(merged.events).toEqual([{ id: 'velho', title: 'do backup', _m: T0 }]);
  });
});

describe('removeUndefined', () => {
  it('remove undefined em objetos e listas', () => {
    expect(removeUndefined({ a: 1, b: undefined, c: [1, undefined, { d: undefined }] })).toEqual({ a: 1, c: [1, {}] });
  });
});
