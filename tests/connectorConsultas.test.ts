import { describe, it, expect } from 'vitest';
import {
  ConsultaError, avaliacoesProximas, calendario, conteudoDesdeUltimaAvaliacao, encontrarTurma,
  hojeEmBrasilia, listarAvaliacoes, turmasEGrade
} from '../connector/consultas';

// Dados inventados (nenhum nome real de aluno)
const slots = (times: string[], breakAfter: number) => {
  const out: any[] = [];
  times.forEach((t, i) => {
    const [h, m] = t.split(':').map(Number);
    const end = h * 60 + m + 45;
    const endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    out.push({ id: `s${i + 1}`, startTime: t, endTime, type: 'class', label: `${i + 1}ª Aula` });
    if (i + 1 === breakAfter) out.push({ id: `b${i}`, startTime: '', endTime: '', type: 'break', label: 'Intervalo' });
  });
  return out;
};

const MAT = slots(['07:20', '08:05', '08:50', '09:55'], 2);
const VESP = slots(['13:30', '14:15', '15:15', '16:00', '16:45'], 2);
const D = (d: string) => `${d}T00:00:00.000Z`;

const data: any = {
  profile: { name: 'Prof' },
  settings: { isPrivateTeacher: true },
  schools: [
    { id: 'C', name: 'Cônsul', color: '#f00', shifts: [{ id: 'cv', name: 'Vespertino', slots: VESP }],
      classes: [{ id: 'c183', name: '183' }, { id: 'c163', name: '163' }, { id: 'cold', name: '153', deleted: true }] },
    { id: 'U', name: 'Uniavan', color: '#0f0', shifts: [{ id: 'um', name: 'Matutino', slots: MAT }],
      classes: [{ id: 'u3', name: '3ª Série' }] },
    { id: 'K', name: 'Cultura', color: '#00f', shifts: [{ id: 'km', name: 'Matutino', slots: MAT }],
      classes: [{ id: 'k3', name: '3ª Série' }] },
    { id: 'X', name: 'Escola Antiga', deleted: true, color: '#000', shifts: [], classes: [{ id: 'x1', name: '999' }] }
  ],
  students: [{ id: 'p1', name: 'Pedrinho Particular', subject: 'História', color: '#ccc', startDate: '2026-01-01',
    schedules: [{ id: 'ps1', dayOfWeek: 3, startTime: '18:00', endTime: '19:00' }] }],
  classRecords: [{ id: 'r1', schoolId: 'C', classId: 'c183', students: [{ id: 'a1', name: 'Joãozinho da Silva' }] }],
  grades: [{ id: 'g1', studentId: 'a1', assessmentId: 'p1', value: 3 }],
  scheduleVersions: [{ id: 'v1', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's1', classId: '163' },
    { id: 'e2', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's2', classId: 'window' },
    { id: 'e3', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's3', classId: '183' },
    { id: 'e4', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's4', classId: '183' },
    { id: 'e5', dayOfWeek: 2, schoolId: 'C', shiftId: 'cv', slotId: 's5', classId: '183' },
    { id: 'e6', dayOfWeek: 1, schoolId: 'U', shiftId: 'um', slotId: 's1', classId: '3ª Série' },
    { id: 'e7', dayOfWeek: 3, schoolId: 'K', shiftId: 'km', slotId: 's1', classId: '3ª Série' }
  ] }],
  schedules: [],
  calendars: [{
    id: 'cal', schoolId: 'C', year: 2026, division: 'trimestres', start: '2026-02-10', end: '2026-12-15',
    terms: [
      { name: '1º Trimestre', start: '2026-02-10', end: '2026-05-15' },
      { name: '2º Trimestre', start: '2026-05-18', end: '2026-09-04' },
      { name: '3º Trimestre', start: '2026-09-08', end: '2026-12-15' }
    ],
    midYearBreak: { start: '2026-07-13', end: '2026-07-24' },
    extraRecesses: [{ id: 'r', name: 'Recesso escolar', date: '2026-10-13' }]
  }],
  events: [
    { id: 'p1', type: 'test', schoolId: 'C', classId: 'c183', slotId: 's3', date: D('2026-10-05'),
      title: 'P1 Revolução Francesa', description: 'Cap. 3 e 4', blocksClasses: false, prepared: true },
    { id: 'p2', type: 'test', schoolId: 'C', classId: 'c183', slotId: 's5', date: D('2026-10-27'),
      title: 'P2 Era Napoleônica', description: '', blocksClasses: false, prepared: false, scheduled: true },
    { id: 't1', type: 'work', schoolId: 'C', classId: 'c163', slotId: 's1', date: D('2026-10-26'),
      title: 'Trabalho Iluminismo', description: '', blocksClasses: false, prepared: true },
    { id: 'u1', type: 'test', schoolId: 'U', classId: 'u3', slotId: 's1', date: D('2026-11-09'),
      title: 'Simulado', description: '', blocksClasses: false },
    { id: 'old', type: 'test', schoolId: 'C', classId: 'cold', slotId: 's1', date: D('2026-10-28'),
      title: 'Prova turma excluída', description: '', blocksClasses: false },
    { id: 'x', type: 'test', schoolId: 'X', classId: 'x1', date: D('2026-10-22'),
      title: 'Prova escola excluída', description: '', blocksClasses: false },
    { id: 'm1', type: 'meeting', schoolId: 'C', date: D('2026-10-20'),
      title: 'Conselho de classe', description: 'Falar sobre o Joãozinho da Silva', blocksClasses: false }
  ],
  logs: [
    { id: 'l1', date: D('2026-10-05'), schoolId: 'C', classId: 'c183', slotId: 's3',
      subject: 'Avaliação: P1 Revolução Francesa', homework: '', notes: '' },
    { id: 'l2', date: D('2026-10-05'), schoolId: 'C', classId: '183', slotId: 's4',
      subject: 'Correção da prova', homework: '', notes: 'Joãozinho da Silva conversou muito',
      occurrences: [{ id: 'o', type: 'Conversa', description: 'Joãozinho da Silva', studentIds: ['a1'] }],
      attendance: [{ studentId: 'a1', status: 'absent' }] },
    { id: 'l3', date: D('2026-10-06'), schoolId: 'C', classId: 'c183', slotId: 's5',
      subject: 'Napoleão: ascensão', homework: 'p. 45', notes: 'Joãozinho da Silva faltou' },
    { id: 'l4', date: D('2026-10-19'), schoolId: 'C', classId: '183', slotId: 's3',
      subject: 'Bloqueio continental', homework: '', notes: '' },
    { id: 'l5', date: D('2026-10-20'), schoolId: 'C', classId: 'c183', slotId: 's5',
      subject: '', homework: '', notes: '', status: 'removed' },
    { id: 'l6', date: D('2026-10-19'), schoolId: 'C', classId: 'c163', slotId: 's1',
      subject: 'Iluminismo', homework: '', notes: '' },
    { id: 'l7', date: D('2026-10-08'), schoolId: 'p1', studentId: 'p1', classId: '', slotId: 'ps1',
      subject: 'Aula particular', homework: '', notes: '' }
  ],
  reminders: [], customAssessments: [], gradingConfigs: []
};

const HOJE = '2026-10-21';
const semDadosDeAlunos = (r: unknown) => {
  const json = JSON.stringify(r);
  expect(json).not.toMatch(/Joãozinho|Pedrinho|c183|c163|u3|k3/);
};

describe('conector: encontrar turma', () => {
  it('acha pelo nome, sem ligar para acento, maiúscula ou ª', () => {
    expect(encontrarTurma(data, '183').cls.id).toBe('c183');
    expect(encontrarTurma(data, '3a serie', 'uniavan').school.id).toBe('U');
    expect(encontrarTurma(data, '3ª Série', 'Cultura').school.id).toBe('K');
  });

  it('pede a escola quando o nome da turma existe em mais de uma', () => {
    expect(() => encontrarTurma(data, '3ª Série')).toThrow(/Uniavan.*Cultura|Cultura.*Uniavan/);
  });

  it('não acha turma excluída nem de escola excluída', () => {
    expect(() => encontrarTurma(data, '153')).toThrow(ConsultaError);
    expect(() => encontrarTurma(data, '999')).toThrow(ConsultaError);
  });
});

describe('conector: avaliações', () => {
  it('lista por período com nome da turma, número da aula e se já foi elaborada', () => {
    const r = listarAvaliacoes(data, { de: '2026-10-01', ate: '2026-10-31', escola: 'consul' });
    expect(r.map(a => a.titulo)).toEqual(['P1 Revolução Francesa', 'Trabalho Iluminismo', 'P2 Era Napoleônica', 'Prova turma excluída']);
    const p2 = r.find(a => a.titulo === 'P2 Era Napoleônica')!;
    expect(p2).toMatchObject({
      data: '2026-10-27', dataBR: '27/10/2026', diaSemana: 'terça', escola: 'Cônsul', turma: '183',
      tipo: 'Prova', aula: '5ª aula (16:45)', situacao: 'Agendada', elaborada: false, comunicadaAosAlunos: true
    });
    // "Pronta" no app: elaborada, enviada e alunos avisados (o app desliga "Agendada")
    expect(r.find(a => a.titulo === 'P1 Revolução Francesa')).toMatchObject({ situacao: 'Pronta', elaborada: true, comunicadaAosAlunos: true });
    expect(r.find(a => a.titulo === 'Prova turma excluída')).toMatchObject({ situacao: 'Pendente', elaborada: false, comunicadaAosAlunos: false });
    expect(r.find(a => a.titulo === 'Prova turma excluída')!.turma).toBe('153');
    semDadosDeAlunos(r);
  });

  it('filtra por turma e pelas que faltam elaborar', () => {
    expect(listarAvaliacoes(data, { turma: '183', elaborada: false }).map(a => a.titulo)).toEqual(['P2 Era Napoleônica']);
    expect(listarAvaliacoes(data, { turma: '3ª série', escola: 'Uniavan' }).map(a => a.titulo)).toEqual(['Simulado']);
  });

  it('ignora escolas excluídas', () => {
    expect(listarAvaliacoes(data).some(a => a.titulo === 'Prova escola excluída')).toBe(false);
  });

  it('recusa data em formato errado', () => {
    expect(() => listarAvaliacoes(data, { de: '21/10/2026' })).toThrow(/AAAA-MM-DD/);
  });
});

describe('conector: conteúdo desde a última avaliação', () => {
  const r = conteudoDesdeUltimaAvaliacao(data, { turma: '183', hoje: HOJE });

  it('pega o diário depois da última prova, sem o registro automático da avaliação', () => {
    expect(r.ultimaAvaliacao?.titulo).toBe('P1 Revolução Francesa');
    expect(r.proximaAvaliacao?.titulo).toBe('P2 Era Napoleônica');
    expect(r.desde).toBe('2026-10-06');
    expect(r.aulas).toEqual([
      { data: '2026-10-06', dataBR: '06/10/2026', aula: '5ª aula (16:45)', conteudo: 'Napoleão: ascensão', tarefa: 'p. 45' },
      { data: '2026-10-19', dataBR: '19/10/2026', aula: '3ª aula (15:15)', conteudo: 'Bloqueio continental', tarefa: undefined }
    ]);
  });

  it('avisa das aulas sem registro, pulando feriado, recesso e aula removida', () => {
    // 12/10 é feriado, 13/10 é recesso, 20/10 foi removida; a 4ª aula de 19/10 ficou sem registro
    expect(r.aulasSemRegistro).toEqual([{ data: '2026-10-19', dataBR: '19/10/2026', aula: '4ª aula (16:00)' }]);
  });

  it('não expõe observações, ocorrências, chamada nem nomes de alunos', () => {
    semDadosDeAlunos(r);
    expect(JSON.stringify(r)).not.toMatch(/conversou|faltou|absent/);
  });

  it('sem avaliação anterior, começa no início do ano letivo', () => {
    const t = conteudoDesdeUltimaAvaliacao(data, { turma: '163', hoje: HOJE });
    expect(t.ultimaAvaliacao).toBeUndefined();
    expect(t.desde).toBe('2026-02-10');
    expect(t.aulas.map(a => a.conteudo)).toEqual(['Iluminismo']);
  });
});

describe('conector: avaliações próximas (alertas)', () => {
  it('traz as avaliações dos próximos dias com o conteúdo de cada uma', () => {
    const r = avaliacoesProximas(data, { hoje: HOJE, dias: 7 });
    expect(r.map(a => [a.titulo, a.diasAte])).toEqual([['Trabalho Iluminismo', 5], ['P2 Era Napoleônica', 6]]);
    expect(r[1].conteudo?.aulas.map(a => a.conteudo)).toEqual(['Napoleão: ascensão', 'Bloqueio continental']);
    semDadosDeAlunos(r);
  });

  it('inclui avaliação de hoje', () => {
    expect(avaliacoesProximas(data, { hoje: '2026-10-27', dias: 0 }).map(a => a.titulo)).toEqual(['P2 Era Napoleônica']);
  });
});

describe('conector: turmas e grade', () => {
  const r = turmasEGrade(data, { data: HOJE });

  it('lista escolas ativas, turmas e horários dos turnos', () => {
    expect(r.escolas.map(e => e.escola)).toEqual(['Cônsul', 'Uniavan', 'Cultura']);
    expect(r.escolas[0].turmas).toEqual(['183', '163']);
    expect(r.escolas[0].turnos[0].aulas[2]).toBe('3ª 15:15–16:00');
  });

  it('monta a grade com aulas seguidas separadas e sem janelas nem alunos particulares', () => {
    const segunda = r.grade.find(d => d.dia === 'segunda')!;
    expect(segunda.aulas.map(a => `${a.numero}ª ${a.escola} ${a.turma}`)).toEqual([
      '1ª Uniavan 3ª Série', '1ª Cônsul 163', '3ª Cônsul 183', '4ª Cônsul 183'
    ]);
    expect(r.grade.map(d => d.dia)).toEqual(['segunda', 'terça', 'quarta', 'quinta', 'sexta']);
    semDadosDeAlunos(r);
  });
});

describe('conector: calendário', () => {
  const r = calendario(data, { de: '2026-10-01', ate: '2026-10-31', escola: 'Cônsul' });

  it('traz feriados, períodos, recessos e eventos', () => {
    expect(r.feriados).toEqual([{ data: '2026-10-12', dataBR: '12/10/2026', nome: 'Aparecida' }]);
    const c = r.escolas[0];
    expect(c.anoLetivo).toEqual({ inicio: '2026-02-10', fim: '2026-12-15', divisao: 'trimestres' });
    expect(c.periodos).toHaveLength(3);
    expect(c.recessos).toEqual([{ data: '2026-10-13', dataBR: '13/10/2026', nome: 'Recesso escolar' }]);
    expect(c.eventos).toEqual([{ data: '2026-10-20', dataBR: '20/10/2026', tipo: 'Reunião', titulo: 'Conselho de classe', turma: 'Todas as turmas', suspendeAulas: false }]);
  });

  it('não mostra a descrição dos eventos (pode citar alunos)', () => {
    semDadosDeAlunos(r);
  });

  it('recusa períodos invertidos ou longos demais', () => {
    expect(() => calendario(data, { de: '2026-10-31', ate: '2026-10-01' })).toThrow(ConsultaError);
    expect(() => calendario(data, { de: '2026-01-01', ate: '2027-12-31' })).toThrow(ConsultaError);
  });
});

describe('conector: data de hoje', () => {
  it('usa o fuso de Brasília', () => {
    // 22/10 01:00 em UTC ainda é 21/10 em Brasília
    expect(hojeEmBrasilia(new Date('2026-10-22T01:00:00Z'))).toBe('2026-10-21');
  });
});
