import { describe, it, expect } from 'vitest';
import { calcularAvisos, momentoEmBrasilia } from '../utils/avisos';

// Dados inventados (nenhum nome real)
const SLOTS = [
  { id: 's1', startTime: '07:30', endTime: '08:15', type: 'class', label: '1' },
  { id: 's2', startTime: '08:15', endTime: '09:00', type: 'class', label: '2' }
];
const TARDE = [{ id: 't1', startTime: '13:30', endTime: '14:15', type: 'class', label: '1' }];

const base = (): any => ({
  profile: {}, settings: { isPrivateTeacher: false, alertAfterShift: true, alertAfterShiftDelay: 0 }, students: [], classRecords: [],
  grades: [], schedules: [], reminders: [], customAssessments: [], gradingConfigs: [], logs: [], events: [],
  schools: [
    { id: 'E', name: 'Escola Teste', color: '#0a0', classes: [{ id: 'c6', name: '6º Ano' }, { id: 'c7', name: '7º Ano' }],
      shifts: [{ id: 'm', name: 'Matutino', slots: SLOTS }, { id: 't', name: 'Vespertino', slots: TARDE }] },
    { id: 'F', name: 'Outra Escola', color: '#00a', classes: [{ id: 'c8', name: '8º Ano' }], shifts: [{ id: 'm', name: 'Matutino', slots: SLOTS }] }
  ],
  // Terças: Escola Teste de manhã (6º e 7º) e à tarde (6º). Quartas: Outra Escola (8º).
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 2, schoolId: 'E', shiftId: 'm', slotId: 's1', classId: '6º Ano' },
    { id: 'e2', dayOfWeek: 2, schoolId: 'E', shiftId: 'm', slotId: 's2', classId: '7º Ano' },
    { id: 'e3', dayOfWeek: 2, schoolId: 'E', shiftId: 't', slotId: 't1', classId: '6º Ano' },
    { id: 'e4', dayOfWeek: 3, schoolId: 'F', shiftId: 'm', slotId: 's1', classId: '8º Ano' }
  ] }],
  calendars: [
    { id: 'cal', schoolId: 'E', year: 2026, division: 'bimestres', start: '2026-02-10', end: '2026-12-15', terms: [], midYearBreak: { start: '', end: '' }, extraRecesses: [] },
    { id: 'cal2', schoolId: 'F', year: 2026, division: 'bimestres', start: '2026-02-10', end: '2026-12-15', terms: [], midYearBreak: { start: '', end: '' }, extraRecesses: [] }
  ]
});

const TERCA = '2026-10-20';
const as = (hora: string, hoje = TERCA) => ({ hoje, minutos: Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3)) });
const log = (slotId: string, extra: any = {}) => ({ id: `l-${slotId}`, date: `${TERCA}T00:00:00.000Z`, schoolId: 'E', slotId, classId: 'c6', subject: 'Conteúdo', homework: '', notes: '', ...extra });

describe('avisos: fim de turno', () => {
  it('avisa quando o turno termina com aula sem registro, com as turmas no texto', () => {
    const r = calcularAvisos(base(), as('09:00'));
    expect(r.avisos).toEqual([expect.objectContaining({
      chave: `turno|${TERCA}|E|m`, titulo: 'Escola Teste: 2 aulas sem registro', destino: 'pendencias'
    })]);
    expect(r.avisos[0].texto).toContain('6º Ano, 7º Ano');
  });

  it('não avisa antes do fim do turno, e informa quando conferir de novo', () => {
    const r = calcularAvisos(base(), as('08:59'));
    expect(r.avisos).toEqual([]);
    expect(r.proximo).toBe(`${TERCA}T09:00`);
  });

  it('respeita o atraso escolhido nos Ajustes', () => {
    const d = base();
    d.settings.alertAfterShiftDelay = 10;
    expect(calcularAvisos(d, as('09:05')).avisos).toEqual([]);
    expect(calcularAvisos(d, as('09:10')).avisos).toHaveLength(1);
  });

  it('com tudo registrado não avisa; com uma registrada conta só a outra', () => {
    const d = base();
    d.logs = [log('s1')];
    expect(calcularAvisos(d, as('09:00')).avisos[0].titulo).toBe('Escola Teste: 1 aula sem registro');
    d.logs = [log('s1'), log('s2', { classId: 'c7' })];
    expect(calcularAvisos(d, as('09:00')).avisos).toEqual([]);
  });

  it('aula marcada como "Não houve aula" não é cobrada', () => {
    const d = base();
    d.logs = [log('s1', { subject: '', status: 'removed' }), log('s2', { classId: 'c7', subject: '', status: 'removed' })];
    expect(calcularAvisos(d, as('09:00')).avisos).toEqual([]);
  });

  it('não avisa em feriado, recesso nem em dia de evento que suspende as aulas', () => {
    // 02/11/2026 (Finados) é segunda; usa o feriado numa terça: 21/04/2026 (Tiradentes)
    expect(calcularAvisos(base(), as('09:00', '2026-04-21')).avisos).toEqual([]);
    const recesso = base();
    recesso.calendars[0].extraRecesses = [{ date: TERCA, name: 'Conselho de classe' }];
    expect(calcularAvisos(recesso, as('09:00')).avisos).toEqual([]);
    const evento = base();
    evento.events = [{ id: 'ev', type: 'other', schoolId: 'E', date: `${TERCA}T00:00:00.000Z`, title: 'Feira', blocksClasses: true }];
    expect(calcularAvisos(evento, as('09:00')).avisos).toEqual([]);
  });

  it('cada turno e cada escola têm o seu aviso', () => {
    const tarde = calcularAvisos(base(), as('14:15'));
    expect(tarde.avisos.map(a => a.chave)).toEqual([`turno|${TERCA}|E|t`]);
    const quarta = calcularAvisos(base(), as('08:15', '2026-10-21'));
    expect(quarta.avisos.map(a => a.titulo)).toEqual(['Outra Escola: 1 aula sem registro']);
  });

  it('vale por 2 horas depois do fim do turno (cobre atraso do agendador) e depois não', () => {
    expect(calcularAvisos(base(), as('10:59')).avisos.map(a => a.chave)).toEqual([`turno|${TERCA}|E|m`]);
    expect(calcularAvisos(base(), as('11:00')).avisos).toEqual([]);
  });

  it('desligado nos Ajustes não avisa', () => {
    const d = base();
    d.settings.alertAfterShift = false;
    expect(calcularAvisos(d, as('09:00')).avisos).toEqual([]);
  });
});

describe('avisos: resumo do dia', () => {
  it('no horário escolhido, só se houver pendência de hoje', () => {
    const d = base();
    d.settings.alertAfterShift = false;
    d.settings.alertDailySummary = true;
    d.settings.alertDailySummaryTime = '18:00';
    expect(calcularAvisos(d, as('17:59')).avisos).toEqual([]);
    const r = calcularAvisos(d, as('18:00'));
    expect(r.avisos).toEqual([expect.objectContaining({ chave: `resumo|${TERCA}`, titulo: 'Hoje: 3 aulas sem registro' })]);
    expect(r.avisos[0].texto).toContain('Escola Teste: 3');
    d.logs = [log('s1'), log('s2', { classId: 'c7' }), log('t1')];
    expect(calcularAvisos(d, as('18:00')).avisos).toEqual([]);
  });

  it('sem horário escolhido usa 18:00', () => {
    const d = base();
    d.settings.alertAfterShift = false;
    d.settings.alertDailySummary = true;
    expect(calcularAvisos(d, as('12:00')).proximo).toBe(`${TERCA}T18:00`);
  });
});

describe('avisos: lembretes com alarme', () => {
  const comLembrete = () => {
    const d = base();
    d.reminders = [{ id: 'r1', date: `${TERCA}T00:00:00.000Z`, alarmTime: `${TERCA}T15:30:00`, category: 'general', title: 'Entregar notas', content: 'Na secretaria' }];
    return d;
  };

  it('avisa na hora do alarme, mesmo que o app já tenha marcado como avisado em outro aparelho', () => {
    const d = comLembrete();
    d.reminders[0].alarmTriggered = true;
    expect(calcularAvisos(d, as('15:29')).avisos.filter(a => a.destino === 'lembretes')).toEqual([]);
    expect(calcularAvisos(d, as('15:30')).avisos).toContainEqual({
      chave: `lembrete|r1|${TERCA}T15:30`, titulo: 'Lembrete: Entregar notas', texto: 'Na secretaria', destino: 'lembretes'
    });
  });

  it('alarme perto da meia-noite ainda vale no dia seguinte, dentro da janela', () => {
    const d = comLembrete();
    d.reminders[0].alarmTime = `${TERCA}T23:50:00`;
    expect(calcularAvisos(d, as('00:30', '2026-10-21')).avisos.some(a => a.destino === 'lembretes')).toBe(true);
    expect(calcularAvisos(d, as('02:00', '2026-10-21')).avisos.some(a => a.destino === 'lembretes')).toBe(false);
  });

  it('"proximo" aponta para o alarme futuro mais perto', () => {
    const d = comLembrete();
    expect(calcularAvisos(d, as('14:30')).proximo).toBe(`${TERCA}T15:30`);
    expect(calcularAvisos(d, as('16:00')).proximo).toBe('2026-10-21T00:00');
  });
});

describe('avisos: hora de Brasília', () => {
  it('converte o instante do servidor (UTC) para o dia e a hora do professor', () => {
    expect(momentoEmBrasilia(new Date('2026-10-21T01:30:00Z'))).toEqual({ hoje: TERCA, minutos: 22 * 60 + 30 });
    expect(momentoEmBrasilia(new Date('2026-10-20T03:00:00Z'))).toEqual({ hoje: TERCA, minutos: 0 });
  });
});
