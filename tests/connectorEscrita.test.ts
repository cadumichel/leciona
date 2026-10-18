import { describe, it, expect } from 'vitest';
import { aplicarPlano, desfazerLote, prepararAvaliacoes, prepararConteudos, prepararSituacoes } from '../connector/escrita';
import { listarAvaliacoes } from '../connector/consultas';
import { mergeAppData } from '../utils/sync';

// Dados inventados (nenhum nome real)
const VESP = [
  { id: 's1', startTime: '13:30', endTime: '14:15', type: 'class', label: '1' },
  { id: 's2', startTime: '14:15', endTime: '15:00', type: 'class', label: '2' },
  { id: 'b', startTime: '15:00', endTime: '15:15', type: 'break', label: 'Intervalo' },
  { id: 's3', startTime: '15:15', endTime: '16:00', type: 'class', label: '3' },
  { id: 's4', startTime: '16:00', endTime: '16:45', type: 'class', label: '4' },
  { id: 's5', startTime: '16:45', endTime: '17:30', type: 'class', label: '5' }
];

const base = (): any => ({
  profile: {}, settings: {}, students: [], classRecords: [], grades: [], schedules: [], reminders: [],
  customAssessments: [], gradingConfigs: [],
  schools: [
    { id: 'C', name: 'Cônsul', color: '#f00', shifts: [{ id: 'cv', name: 'Vespertino', slots: VESP }],
      classes: [{ id: 'c183', name: '183' }, { id: 'c163', name: '163' }] }
  ],
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's3', classId: '183' },
    { id: 'e2', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's4', classId: '183' },
    { id: 'e3', dayOfWeek: 2, schoolId: 'C', shiftId: 'cv', slotId: 's5', classId: '183' },
    { id: 'e4', dayOfWeek: 3, schoolId: 'C', shiftId: 'cv', slotId: 's1', classId: '163' }
  ] }],
  calendars: [{ id: 'cal', schoolId: 'C', year: 2026, division: 'trimestres', start: '2026-02-10', end: '2026-12-15',
    terms: [], midYearBreak: { start: '', end: '' }, extraRecesses: [{ id: 'r', name: 'Recesso', date: '2026-11-03' }] }],
  events: [
    { id: 'p2', type: 'test', schoolId: 'C', classId: 'c183', slotId: 's5', date: '2026-10-27T00:00:00.000Z',
      title: 'P2', description: '', blocksClasses: false, prepared: false, scheduled: true }
  ],
  logs: [
    { id: 'l1', date: '2026-11-10T00:00:00.000Z', schoolId: 'C', classId: 'c183', slotId: 's5',
      subject: 'Revisão para a P3', homework: '', notes: '' }
  ]
});

const HOJE = '2026-10-21';
const AGORA = Date.parse('2026-10-21T15:00:00Z');
const P3 = { turma: '183', data: '2026-11-17', tipo: 'prova' as const, titulo: 'P3', descricao: 'Cap. 15 e 16' };

describe('conector (gravação): prévia de avaliações', () => {
  it('prepara uma prova na única aula do dia, com registro no diário como o app', () => {
    const { itens, plano } = prepararAvaliacoes(base(), [P3], HOJE, AGORA);
    expect(itens[0]).toMatchObject({ ok: true, avisos: [] });
    expect(itens[0].descricao).toBe('Prova "P3" — 183 (Cônsul), terça 17/11/2026, 5ª aula (16:45) — Pendente');
    expect(plano!.criar.events[0]).toMatchObject({
      title: 'P3', date: '2026-11-17T00:00:00.000Z', schoolId: 'C', classId: 'c183', slotId: 's5', type: 'test',
      description: 'Cap. 15 e 16', blocksClasses: false, prepared: false, scheduled: false
    });
    expect(plano!.criar.logs[0]).toMatchObject({ subject: 'Avaliação: P3', slotId: 's5', classId: 'c183', notes: 'Cap. 15 e 16' });
  });

  it('com aulas seguidas, pede para escolher a aula', () => {
    const sem = prepararAvaliacoes(base(), [{ ...P3, data: '2026-11-16' }], HOJE, AGORA);
    expect(sem.plano).toBeNull();
    expect(sem.itens[0].erro).toMatch(/aulas seguidas: 3ª aula \(15:15\) e 4ª aula \(16:00\)/);
    const com = prepararAvaliacoes(base(), [{ ...P3, data: '2026-11-16', aula: 4 }], HOJE, AGORA);
    expect(com.plano!.criar.events[0].slotId).toBe('s4');
    const errada = prepararAvaliacoes(base(), [{ ...P3, data: '2026-11-16', aula: 2 }], HOJE, AGORA);
    expect(errada.itens[0].erro).toMatch(/Escolha uma delas/);
  });

  it('recusa dia sem aula da turma, feriado e recesso', () => {
    const r = prepararAvaliacoes(base(), [
      { ...P3, data: '2026-11-18' },               // quarta: 183 não tem aula
      { ...P3, data: '2026-11-02', aula: 3 },      // Finados
      { ...P3, data: '2026-11-03' }                // recesso da escola
    ], HOJE, AGORA);
    expect(r.plano).toBeNull();
    expect(r.itens[0].erro).toMatch(/não tem aula.*Dias com aula: segunda, terça/);
    expect(r.itens[1].erro).toMatch(/feriado \(Finados\)/);
    expect(r.itens[2].erro).toMatch(/sem aula nessa escola/);
  });

  it('recusa repetida e avisa de data passada e aula com outra avaliação', () => {
    const r = prepararAvaliacoes(base(), [
      { ...P3, data: '2026-10-27', titulo: 'p2' },
      { ...P3, data: '2026-10-27', titulo: 'Trabalho extra' },
      { ...P3, data: '2026-10-13' },
      P3, P3
    ], HOJE, AGORA);
    expect(r.itens[0].erro).toMatch(/Já existe "p2"/);
    expect(r.itens[1].avisos).toContain('Já existe outra avaliação nessa aula: "P2".');
    expect(r.itens[2].avisos).toContain('A data já passou.');
    expect(r.itens[4].erro).toBe('Repetida neste mesmo pedido.');
    expect(r.plano!.criar.events).toHaveLength(3);
  });

  it('nunca apaga registro do diário: mantém o existente e não cria "Avaliação: X"', () => {
    const { itens, plano } = prepararAvaliacoes(base(), [{ ...P3, data: '2026-11-10' }], HOJE, AGORA);
    expect(itens[0].avisos[0]).toMatch(/já tem registro no diário \("Revisão para a P3"\).*será mantido/);
    expect(plano!.criar.events).toHaveLength(1);
    expect(plano!.criar.logs).toHaveLength(0);
  });

  it('turma desconhecida vira erro do item, sem derrubar os outros', () => {
    const r = prepararAvaliacoes(base(), [{ ...P3, turma: '999' }, P3], HOJE, AGORA);
    expect(r.itens[0].erro).toMatch(/não encontrada/);
    expect(r.itens[1].ok).toBe(true);
  });
});

describe('conector (gravação): gravar e desfazer', () => {
  it('grava com carimbo, não duplica ao confirmar de novo e aparece nas consultas', () => {
    const doc = base();
    const { plano } = prepararAvaliacoes(doc, [{ ...P3, situacao: 'Agendada' }], HOJE, AGORA);
    const r = aplicarPlano(doc, plano!, AGORA + 1000);
    expect(r.lote.criados.events).toHaveLength(1);
    expect(r.lote.criados.logs).toHaveLength(1);
    Object.assign(doc, r.alteracoes);
    expect(doc.events.at(-1)._m).toBe(AGORA + 1000);
    expect(listarAvaliacoes(doc, { turma: '183', de: '2026-11-01' })).toMatchObject([{ titulo: 'P3', situacao: 'Agendada' }]);

    const deNovo = aplicarPlano(doc, plano!, AGORA + 2000);
    expect(deNovo.jaGravado).toBe(true);
    expect(deNovo.alteracoes).toEqual({});
  });

  it('desfaz com lápide e não deixa regravar a mesma prévia', () => {
    const doc = base();
    const { plano } = prepararAvaliacoes(doc, [P3], HOJE, AGORA);
    const r = aplicarPlano(doc, plano!, AGORA);
    Object.assign(doc, r.alteracoes);
    const d = desfazerLote(doc, r.lote, AGORA + 5000);
    expect(d.desfeito).toBe(true);
    Object.assign(doc, d.alteracoes);
    expect(doc.events.map((e: any) => e.id)).toEqual(['p2']);
    expect(doc.logs.map((l: any) => l.id)).toEqual(['l1']);
    expect(doc._deleted[r.lote.criados.events[0]]).toBe(AGORA + 5000);
    expect(() => aplicarPlano(doc, plano!, AGORA + 6000)).toThrow(/desfeita/);
  });

  it('ao desfazer, mantém o que foi alterado no app depois', () => {
    const doc = base();
    const { plano } = prepararAvaliacoes(doc, [P3], HOJE, AGORA);
    const r = aplicarPlano(doc, plano!, AGORA);
    Object.assign(doc, r.alteracoes);
    doc.events = doc.events.map((e: any) => (e.title === 'P3' ? { ...e, prepared: true, _m: AGORA + 9000 } : e));
    const d = desfazerLote(doc, r.lote, AGORA + 10000);
    Object.assign(doc, d.alteracoes);
    expect(doc.events.some((e: any) => e.title === 'P3')).toBe(true);
    expect(doc.logs.some((l: any) => l.subject === 'Avaliação: P3')).toBe(false);
    expect(d.avisos[0]).toMatch(/alterado no app depois/);
  });
});

describe('conector (gravação): situação', () => {
  it('muda Agendada → Pronta e desfaz', () => {
    const doc = base();
    const { itens, plano } = prepararSituacoes(doc, [{ turma: '183', data: '2026-10-27', situacao: 'Pronta' }]);
    expect(itens[0].descricao).toBe('"P2" — 183 (Cônsul), terça 27/10/2026: Agendada → Pronta');
    const r = aplicarPlano(doc, plano!, AGORA);
    Object.assign(doc, r.alteracoes);
    expect(doc.events[0]).toMatchObject({ prepared: true, scheduled: false, _m: AGORA });
    const d = desfazerLote(doc, r.lote, AGORA + 1000);
    Object.assign(doc, d.alteracoes);
    expect(doc.events[0]).toMatchObject({ prepared: false, scheduled: true });
  });

  it('avisa quando nada muda e quando não acha a avaliação', () => {
    const r = prepararSituacoes(base(), [
      { turma: '183', data: '2026-10-27', situacao: 'Agendada' },
      { turma: '183', data: '2026-10-28', situacao: 'Pronta' }
    ]);
    expect(r.itens[0].avisos[0]).toMatch(/nada muda/);
    expect(r.itens[1].erro).toMatch(/Não há avaliação da 183 em quarta 28\/10\/2026/);
    expect(r.plano).toBeNull();
  });
});

describe('conector (gravação): convivência com o app aberto', () => {
  it('o app com alterações pendentes junta e mantém o que o conector gravou', () => {
    const nuvem = base();
    const { plano } = prepararAvaliacoes(nuvem, [P3], HOJE, AGORA);
    Object.assign(nuvem, aplicarPlano(nuvem, plano!, AGORA).alteracoes);
    // O app tinha uma edição local ainda não enviada
    const app = base();
    app.logs = app.logs.map((l: any) => ({ ...l, homework: 'p. 50', _m: AGORA + 100 }));
    const juntos = mergeAppData(nuvem, app, AGORA + 200);
    expect(juntos.events.some(e => e.title === 'P3')).toBe(true);
    expect(juntos.logs.find(l => l.id === 'l1')!.homework).toBe('p. 50');
    expect(juntos.logs.some(l => l.subject === 'Avaliação: P3')).toBe(true);
  });

  it('desfazer pelo conector também some de um aparelho que já tinha recebido', () => {
    const nuvem = base();
    const { plano } = prepararAvaliacoes(nuvem, [P3], HOJE, AGORA);
    const r = aplicarPlano(nuvem, plano!, AGORA);
    Object.assign(nuvem, r.alteracoes);
    const app = JSON.parse(JSON.stringify(nuvem)); // celular já recebeu a P3
    Object.assign(nuvem, desfazerLote(nuvem, r.lote, AGORA + 1000).alteracoes);
    const juntos = mergeAppData(nuvem, app, AGORA + 2000);
    expect(juntos.events.some(e => e.title === 'P3')).toBe(false);
    expect(juntos.logs.some(l => l.subject === 'Avaliação: P3')).toBe(false);
  });
});

describe('conector (gravação): conteúdo de aula', () => {
  const AULA = { turma: '183', data: '2026-10-20', conteudo: 'Revolução Industrial', tarefa: 'p. 40' };

  it('cria o registro da aula como o app (tipo regular, código da turma)', () => {
    const { itens, plano } = prepararConteudos(base(), [AULA], HOJE, AGORA);
    expect(itens[0]).toMatchObject({ ok: true, avisos: [] });
    expect(plano!.resumo).toEqual(['183 (Cônsul), terça 20/10/2026, 5ª aula (16:45) — "Revolução Industrial", tarefa: "p. 40"']);
    expect(plano!.criar.logs[0]).toMatchObject({
      date: '2026-10-20T00:00:00.000Z', schoolId: 'C', classId: 'c183', slotId: 's5',
      subject: 'Revolução Industrial', homework: 'p. 40', notes: '', type: 'regular'
    });
    expect(plano!.criar.events).toHaveLength(0);
  });

  it('com aulas seguidas, pergunta; com as aulas informadas, registra em cada uma', () => {
    const sem = prepararConteudos(base(), [{ ...AULA, data: '2026-10-19' }], HOJE, AGORA);
    expect(sem.itens[0].erro).toMatch(/aulas seguidas.*vale para todas ou só para uma/);
    const duas = prepararConteudos(base(), [{ ...AULA, data: '2026-10-19', aulas: [3, 4] }], HOJE, AGORA);
    expect(duas.plano!.criar.logs.map(l => l.slotId)).toEqual(['s3', 's4']);
    const uma = prepararConteudos(base(), [{ ...AULA, data: '2026-10-19', aulas: [4] }], HOJE, AGORA);
    expect(uma.plano!.criar.logs.map(l => l.slotId)).toEqual(['s4']);
  });

  it('acrescenta ao que já está no diário (ou substitui, se pedido) e mostra como vai ficar', () => {
    const r = prepararConteudos(base(), [{ ...AULA, data: '2026-11-10', tarefa: '' }], HOJE, AGORA);
    expect(r.itens[0].avisos).toContain('A aula ainda não aconteceu: fica registrado como planejamento.');
    expect(r.itens[0].avisos).toContain('A 5ª aula (16:45) já tinha no diário: "Revisão para a P3". Vai ficar: "Revisão para a P3\nRevolução Industrial".');
    expect(r.plano!.criar.logs).toHaveLength(0);
    expect(r.plano!.conteudos![0]).toMatchObject({ id: 'l1', subject: 'Revisão para a P3\nRevolução Industrial', homework: '' });
    const s = prepararConteudos(base(), [{ ...AULA, data: '2026-11-10', modo: 'substituir' }], HOJE, AGORA);
    expect(s.plano!.conteudos![0]).toMatchObject({ subject: 'Revolução Industrial', homework: 'p. 40' });
  });

  it('não repete o que já está escrito', () => {
    const r = prepararConteudos(base(), [{ turma: '183', data: '2026-11-10', conteudo: 'revisão para a p3' }], HOJE, AGORA);
    expect(r.itens[0].avisos.some(a => /já tem esse registro; nada muda/.test(a))).toBe(true);
    expect(r.plano).toBeNull();
  });

  it('grava, desfaz e volta o conteúdo anterior', () => {
    const doc = base();
    const { plano } = prepararConteudos(doc, [{ ...AULA, data: '2026-11-10' }, AULA], HOJE, AGORA);
    const r = aplicarPlano(doc, plano!, AGORA);
    Object.assign(doc, r.alteracoes);
    expect(doc.logs.find((l: any) => l.id === 'l1')).toMatchObject({ subject: 'Revisão para a P3\nRevolução Industrial', homework: 'p. 40', _m: AGORA });
    expect(doc.logs).toHaveLength(2);
    expect(aplicarPlano(doc, plano!, AGORA + 1).jaGravado).toBe(true);
    const d = desfazerLote(doc, r.lote, AGORA + 1000);
    Object.assign(doc, d.alteracoes);
    expect(doc.logs).toHaveLength(1);
    expect(doc.logs[0]).toMatchObject({ id: 'l1', subject: 'Revisão para a P3', homework: '' });
  });

  it('não grava se o registro mudou no app depois da prévia', () => {
    const doc = base();
    const { plano } = prepararConteudos(doc, [{ ...AULA, data: '2026-11-10' }], HOJE, AGORA);
    doc.logs[0] = { ...doc.logs[0], subject: 'Mudei no celular', _m: AGORA + 10 };
    const r = aplicarPlano(doc, plano!, AGORA + 20);
    expect(r.alteracoes).toEqual({});
    expect(r.lote.resumo.at(-1)).toMatch(/mudou no app depois da prévia/);
  });

  it('recusa feriado, recesso, aula removida, registro de outra turma e texto vazio', () => {
    const doc = base();
    doc.logs.push(
      { id: 'rem', date: '2026-10-27T00:00:00.000Z', schoolId: 'C', classId: 'c183', slotId: 's5', subject: '', homework: '', notes: '', status: 'removed' },
      { id: 'out', date: '2026-10-13T00:00:00.000Z', schoolId: 'C', classId: 'c163', slotId: 's5', subject: 'Substituição', homework: '', notes: '' }
    );
    const r = prepararConteudos(doc, [
      { ...AULA, data: '2026-11-02', aulas: [3] },
      { ...AULA, data: '2026-11-03' },
      { ...AULA, data: '2026-10-27' },
      { ...AULA, data: '2026-10-13' },
      { turma: '183', data: '2026-10-20', conteudo: '  ' }
    ], HOJE, AGORA);
    expect(r.itens.map(i => i.erro)).toEqual([
      expect.stringMatching(/feriado \(Finados\)/),
      expect.stringMatching(/sem aula nessa escola/),
      expect.stringMatching(/marcada como removida/),
      expect.stringMatching(/registro de outra turma/),
      expect.stringMatching(/Informe o conteúdo/)
    ]);
    expect(r.plano).toBeNull();
  });
});
