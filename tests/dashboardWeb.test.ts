import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildTodayTimeline, buildWeeklyGrid, lessonNumberInShift, todayLessonStatus } from '../utils/dashboardWeb';

const slots = (times: string[], breakAfter: number) => {
  const out: any[] = [];
  times.forEach((t, i) => {
    out.push({ id: `s${i + 1}`, startTime: t, endTime: '', type: 'class', label: `${i + 1}ª Aula` });
    if (i + 1 === breakAfter) out.push({ id: `b${i}`, startTime: '', endTime: '', type: 'break', label: 'Intervalo' });
  });
  // fim de cada aula = início + 45 min
  out.forEach(s => {
    if (s.type !== 'class') return;
    const [h, m] = s.startTime.split(':').map(Number);
    const end = h * 60 + m + 45;
    s.endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  });
  return out;
};

const MAT = slots(['07:20', '08:05', '08:50', '09:55', '10:40', '11:25'], 3);
const VESP = slots(['13:30', '14:15', '15:15', '16:00', '16:45', '17:30'], 2);

const data: any = {
  profile: {}, settings: { isPrivateTeacher: false },
  schools: [
    { id: 'U', name: 'Uniavan', color: '#f59e0b', shifts: [{ id: 'um', name: 'Matutino', slots: MAT }],
      classes: [{ id: 'c1b', name: '1ª Série B' }, { id: 'c3', name: '3ª Série' }] },
    { id: 'C', name: 'Cônsul', color: '#ef4444', shifts: [{ id: 'cv', name: 'Vespertino', slots: VESP }],
      classes: [{ id: 'c183', name: '183' }, { id: 'c163', name: '163' }] }
  ],
  students: [],
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', name: '', schedules: [
    { id: 'e1', dayOfWeek: 1, schoolId: 'U', shiftId: 'um', slotId: 's1', classId: '1ª Série B' },
    { id: 'e2', dayOfWeek: 1, schoolId: 'U', shiftId: 'um', slotId: 's2', classId: '1ª Série B' },
    { id: 'e3', dayOfWeek: 1, schoolId: 'U', shiftId: 'um', slotId: 's3', classId: '3ª Série' },
    { id: 'e4', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's1', classId: '163' },
    { id: 'e5', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's2', classId: 'window' },
    { id: 'e6', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's3', classId: '183' },
    { id: 'e7', dayOfWeek: 2, schoolId: 'C', shiftId: 'cv', slotId: 's5', classId: '183' }
  ] }],
  schedules: [],
  logs: [{ id: 'L1', date: '2026-10-19T00:00:00.000Z', schoolId: 'U', classId: 'c1b', slotId: 's1', subject: 'Revolução Francesa', homework: '', notes: '' }],
  events: [],
  calendars: [], reminders: [], grades: [], customAssessments: [], gradingConfigs: [], classRecords: []
};

afterEach(() => vi.useRealTimers());

describe('número da aula', () => {
  it('conta só os horários de aula e ignora o intervalo', () => {
    expect(lessonNumberInShift(MAT, 's3')).toBe(3);
    expect(lessonNumberInShift(MAT, 's4')).toBe(4); // depois do intervalo continua 4ª
  });
});

describe('linha do dia', () => {
  it('cada aula separada, número recomeça no vespertino', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T14:30:00-03:00'));
    const groups = buildTodayTimeline(data, '2026-10-19');
    expect(groups.map(g => `${g.schoolName} · ${g.shiftName}`)).toEqual(['Uniavan · Matutino', 'Cônsul · Vespertino']);
    expect(groups[0].lessons.map(l => `${l.number}ª ${l.className}`)).toEqual(['1ª 1ª Série B', '2ª 1ª Série B', '3ª 3ª Série']);
    expect(groups[1].lessons.map(l => `${l.number}ª ${l.className}`)).toEqual(['1ª 163', '2ª Janela', '3ª 183']);
  });

  it('situação de cada aula', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T14:30:00-03:00'));
    const [m, v] = buildTodayTimeline(data, '2026-10-19');
    const now = 14 * 60 + 30;
    expect(m.lessons.map(l => todayLessonStatus(l, now))).toEqual(['done', 'pending', 'pending']);
    expect(v.lessons.map(l => todayLessonStatus(l, now))).toEqual(['pending', 'window', 'upcoming']);
    expect(todayLessonStatus(v.lessons[0], 13 * 60 + 40)).toBe('now');
  });

  it('aula futura com conteúdo já lançado (prova marcada) fica "a seguir" e mostra a avaliação', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T14:30:00-03:00'));
    const withTest = {
      ...data,
      events: [{ id: 'P2', date: '2026-10-19T00:00:00.000Z', schoolId: 'C', classId: 'c183', slotId: 's3', type: 'test', title: 'P2', blocksClasses: false }],
      logs: [...data.logs, { id: 'L2', date: '2026-10-19T00:00:00.000Z', schoolId: 'C', classId: 'c183', slotId: 's3', subject: 'Avaliação: P2', homework: '', notes: '' }]
    };
    const [, v] = buildTodayTimeline(withTest, '2026-10-19');
    const aula183 = v.lessons[2];
    expect(aula183.className).toBe('183');
    expect(aula183.assessment).toBe('P2');
    expect(aula183.hasContent).toBe(true);
    expect(todayLessonStatus(aula183, 14 * 60 + 30)).toBe('upcoming');
    expect(todayLessonStatus(aula183, 16 * 60 + 30)).toBe('done');
    // a prova é na 3ª aula: outras aulas da mesma turma no dia não ganham o aviso
    const outra = buildTodayTimeline({ ...withTest, scheduleVersions: [{ ...withTest.scheduleVersions[0], schedules: [
      ...withTest.scheduleVersions[0].schedules, { id: 'e8', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's6', classId: '183' }
    ] }] }, '2026-10-19')[1].lessons.find((l: any) => l.key === 'e8');
    expect(outra?.assessment).toBeUndefined();
  });

  it('aula suspensa por evento aparece riscada', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T07:00:00-03:00'));
    const blockedData = { ...data, events: [{ id: 'ev', date: '2026-10-19T00:00:00.000Z', schoolId: 'C', type: 'event', title: 'Conselho', blocksClasses: true }] };
    const [, v] = buildTodayTimeline(blockedData, '2026-10-19');
    expect(v.lessons.filter(l => !l.isWindow).every(l => l.blocked)).toBe(true);
    expect(todayLessonStatus(v.lessons[0], 7 * 60)).toBe('blocked');
  });

  it('feriado: sem linha do dia', () => {
    expect(buildTodayTimeline(data, '2026-11-02')).toEqual([]);
  });
});

describe('grade semanal', () => {
  it('repete as aulas seguidas e deixa a janela de fora', () => {
    const week = buildWeeklyGrid(data, '2026-10-19');
    expect(week.map(d => d.label)).toEqual(['SEG', 'TER', 'QUA', 'QUI', 'SEX']);
    const seg = week[0];
    expect(seg.count).toBe(5);
    expect(seg.groups.map(g => `${g.period} · ${g.schoolName}`)).toEqual(['MAT · Uniavan', 'VESP · Cônsul']);
    expect(seg.groups[0].lessons.map(l => `${l.time} ${l.className}`)).toEqual(['07:20 1ª Série B', '08:05 1ª Série B', '08:50 3ª Série']);
    expect(seg.groups[1].lessons.map(l => `${l.time} ${l.className}`)).toEqual(['13:30 163', '15:15 183']);
    expect(week[1].groups[0].lessons.map(l => l.time)).toEqual(['16:45']);
  });
});
