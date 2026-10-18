import { AppData, AcademicCalendar, School, SchoolClass, SchoolEvent } from '../types';
import { formatDateBR, getHolidayName, getSafeDate, parseTimeToMinutes } from '../utils';
import { getClassName, isSameClassRef } from '../utils/classRefs';
import { getSchedulesForDate } from '../utils/schedule';
import { isLessonBlocked } from '../utils/lessonStats';
import { lessonNumberInShift } from '../utils/dashboardWeb';
import { countRemainingLessons } from '../utils/remainingLessons';

/**
 * Consultas do conector do Leciona para o Claude (etapa 1: só leitura).
 *
 * Recebem o documento do professor (AppData) e devolvem respostas prontas, em português, usando as
 * mesmas regras do app (nomes de turma, grade em vigor, feriados, recessos).
 *
 * Privacidade: nada daqui devolve nomes de alunos, notas, chamada, ocorrências ou observações do
 * diário. Do diário saem só o conteúdo e a tarefa. Alunos particulares ficam de fora.
 */

/** Erro com mensagem que pode ser mostrada ao Cadu (turma não encontrada, ambígua etc.). */
export class ConsultaError extends Error {}

// ── Datas ─────────────────────────────────────────────────────────────────────

export const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "2026-10-20T00:00:00.000Z" ou "2026-10-20" → "2026-10-20" */
export const dia = (d: string | undefined | null) => String(d || '').split('T')[0];

/** Data de hoje no fuso do professor (o servidor roda em UTC). */
export const hojeEmBrasilia = (agora: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);

export const somarDias = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const diaDaSemana = (dateStr: string) => getSafeDate(dateStr).getDay();

export const validarData = (valor: string | undefined, campo: string) => {
  if (valor === undefined) return undefined;
  const d = dia(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ConsultaError(`Data inválida em "${campo}": use AAAA-MM-DD.`);
  return d;
};

// ── Escolas e turmas ──────────────────────────────────────────────────────────

export const normalizar = (s: string) =>
  String(s || '').replace(/ª/g, 'a').replace(/º/g, 'o')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const escolasAtivas = (data: AppData) => (data.schools || []).filter(s => !s.deleted);

// Turmas antigas podem estar salvas só como texto (o nome)
export const turmasAtivas = (school: School): SchoolClass[] =>
  ((school.classes || []) as (SchoolClass | string)[])
    .map(c => (typeof c === 'string' ? { id: c, name: c } : c))
    .filter(c => !c.deleted);

const escolhaPorNome = <T>(itens: T[], nomeDe: (t: T) => string, busca: string): T[] => {
  const alvo = normalizar(busca);
  const exatos = itens.filter(t => normalizar(nomeDe(t)) === alvo);
  if (exatos.length) return exatos;
  return itens.filter(t => normalizar(nomeDe(t)).includes(alvo));
};

export const encontrarEscola = (data: AppData, busca: string): School => {
  const escolas = escolasAtivas(data);
  const achadas = escolhaPorNome(escolas, s => s.name, busca);
  if (achadas.length === 1) return achadas[0];
  const opcoes = (achadas.length ? achadas : escolas).map(s => s.name).join(', ');
  throw new ConsultaError(
    achadas.length
      ? `Mais de uma escola combina com "${busca}": ${opcoes}.`
      : `Escola "${busca}" não encontrada. Escolas: ${opcoes}.`
  );
};

export const encontrarTurma = (data: AppData, busca: string, escola?: string) => {
  const escolas = escola ? [encontrarEscola(data, escola)] : escolasAtivas(data);
  const todas = escolas.flatMap(school => turmasAtivas(school).map(cls => ({ school, cls })));
  const achadas = escolhaPorNome(todas, t => t.cls.name, busca);
  if (achadas.length === 1) return achadas[0];
  if (achadas.length > 1) {
    const opcoes = achadas.map(t => `${t.cls.name} (${t.school.name})`).join(', ');
    throw new ConsultaError(`Mais de uma turma combina com "${busca}": ${opcoes}. Diga também a escola.`);
  }
  const opcoes = todas.map(t => `${t.cls.name} (${t.school.name})`).join(', ');
  throw new ConsultaError(`Turma "${busca}" não encontrada. Turmas: ${opcoes}.`);
};

export const eDaTurma = (data: AppData, school: School, cls: SchoolClass, ref: string | undefined) =>
  !!ref && isSameClassRef(data, school.id, ref, cls.id);

const nomeDaTurma = (data: AppData, school: School, ref: string | undefined) => {
  if (!ref) return 'Todas as turmas';
  const cls = turmasAtivas(school).find(c => isSameClassRef(data, school.id, ref, c.id));
  // getClassName nunca mostra o código interno
  return cls ? cls.name : getClassName(data, school.id, ref);
};

/** "2ª aula (08:05)" para a aula indicada, se o horário existir. */
export const descreverAula = (school: School, slotId: string | undefined) => {
  if (!slotId) return undefined;
  for (const shift of school.shifts || []) {
    const slot = shift.slots.find(s => s.id === slotId);
    if (slot) return { texto: `${lessonNumberInShift(shift.slots, slotId)}ª aula (${slot.startTime})`, inicio: slot.startTime };
  }
  return undefined;
};

// ── Avaliações ────────────────────────────────────────────────────────────────

export interface Avaliacao {
  data: string;
  dataBR: string;
  diaSemana: string;
  escola: string;
  turma: string;
  tipo: 'Prova' | 'Trabalho';
  titulo: string;
  descricao: string;
  aula?: string;
  /** Mesma caixa do app: Pendente (vai acontecer, alunos ainda não avisados) → Agendada (comunicada aos alunos) → Pronta (enviada para a coordenação e impressão) */
  situacao: 'Pendente' | 'Agendada' | 'Pronta';
  elaborada: boolean;
  comunicadaAosAlunos: boolean;
}

export const eAvaliacao = (e: SchoolEvent) => e.type === 'test' || e.type === 'work';

export const descreverAvaliacao = (data: AppData, school: School, e: SchoolEvent): Avaliacao => {
  const d = dia(e.date);
  return {
    data: d,
    dataBR: formatDateBR(d),
    diaSemana: DIAS_SEMANA[diaDaSemana(d)],
    escola: school.name,
    turma: nomeDaTurma(data, school, e.classId),
    tipo: e.type === 'test' ? 'Prova' : 'Trabalho',
    titulo: e.title,
    descricao: e.description || '',
    aula: descreverAula(school, e.slotId)?.texto,
    situacao: e.prepared ? 'Pronta' : e.scheduled ? 'Agendada' : 'Pendente',
    elaborada: !!e.prepared,
    // No app, escolher "Pronta" desliga "Agendada"; pronta já foi enviada e os alunos já sabem
    comunicadaAosAlunos: !!e.prepared || !!e.scheduled
  };
};

const ordemDaAvaliacao = (school: School, e: SchoolEvent) =>
  `${dia(e.date)} ${descreverAula(school, e.slotId)?.inicio || '99:99'}`;

/** Avaliações da escola (e turma, se indicada), em ordem de data e horário. */
export const avaliacoesDe = (data: AppData, school: School, cls?: SchoolClass) =>
  (data.events || [])
    .filter(e => eAvaliacao(e) && e.schoolId === school.id && (!cls || eDaTurma(data, school, cls, e.classId)))
    .sort((a, b) => ordemDaAvaliacao(school, a).localeCompare(ordemDaAvaliacao(school, b)));

export interface FiltroAvaliacoes {
  de?: string;
  ate?: string;
  escola?: string;
  turma?: string;
  /** true = só as já elaboradas; false = só as que faltam elaborar */
  elaborada?: boolean;
}

export const listarAvaliacoes = (data: AppData, filtro: FiltroAvaliacoes = {}): Avaliacao[] => {
  const de = validarData(filtro.de, 'de');
  const ate = validarData(filtro.ate, 'ate');
  const alvo = filtro.turma ? encontrarTurma(data, filtro.turma, filtro.escola) : undefined;
  const escolas = alvo ? [alvo.school] : filtro.escola ? [encontrarEscola(data, filtro.escola)] : escolasAtivas(data);

  return escolas
    .flatMap(school => avaliacoesDe(data, school, alvo?.cls).map(e => ({ school, e })))
    .filter(({ e }) => (!de || dia(e.date) >= de) && (!ate || dia(e.date) <= ate))
    .filter(({ e }) => filtro.elaborada === undefined || !!e.prepared === filtro.elaborada)
    .sort((a, b) => ordemDaAvaliacao(a.school, a.e).localeCompare(ordemDaAvaliacao(b.school, b.e)))
    .map(({ school, e }) => descreverAvaliacao(data, school, e));
};

// ── Conteúdo dado (diário) ────────────────────────────────────────────────────

export interface AulaDada {
  data: string;
  dataBR: string;
  aula?: string;
  conteudo: string;
  tarefa?: string;
}

export interface ConteudoDaTurma {
  escola: string;
  turma: string;
  /** Período considerado: depois da última avaliação até a data de referência */
  desde: string;
  ate: string;
  ultimaAvaliacao?: Avaliacao;
  proximaAvaliacao?: Avaliacao;
  aulas: AulaDada[];
  /** Aulas da grade, já passadas, sem nada registrado no diário (o conteúdo pode estar incompleto) */
  aulasSemRegistro: { data: string; dataBR: string; aula?: string }[];
}

const REGISTRO_DE_AVALIACAO = /^Avaliação:/;

/** Calendário da escola que contém a data, se houver. */
export const calendarioNaData = (data: AppData, schoolId: string, d: string): AcademicCalendar | undefined =>
  (data.calendars || []).find(c => c.schoolId === schoolId && d >= dia(c.start) && d <= dia(c.end));

/**
 * Conteúdo dado na turma desde a última avaliação (exclusive) até `ate` (inclusive).
 * Sem avaliação anterior, começa no início do ano letivo (ou em 1º de janeiro).
 */
const conteudoEntre = (data: AppData, school: School, cls: SchoolClass, ate: string, hoje: string): ConteudoDaTurma => {
  const avaliacoes = avaliacoesDe(data, school, cls);
  const anteriores = avaliacoes.filter(e => dia(e.date) < ate);
  const ultima = anteriores[anteriores.length - 1];
  const proxima = avaliacoes.find(e => dia(e.date) >= ate);

  const inicioDoAno = calendarioNaData(data, school.id, ate)?.start;
  const desde = ultima ? somarDias(dia(ultima.date), 1) : dia(inicioDoAno) || `${ate.slice(0, 4)}-01-01`;

  // Inclui aulas removidas (status 'removed'): não contam como pendentes, mas não têm conteúdo
  const registros = (data.logs || []).filter(l =>
    !l.studentId && l.schoolId === school.id && eDaTurma(data, school, cls, l.classId) &&
    dia(l.date) >= desde && dia(l.date) <= ate
  );

  const aulas = registros
    .filter(l => l.status !== 'removed')
    .filter(l => (l.subject || '').trim() || (l.homework || '').trim())
    .filter(l => !REGISTRO_DE_AVALIACAO.test(l.subject || ''))
    .map(l => {
      const aula = descreverAula(school, l.slotId);
      return {
        ordem: `${dia(l.date)} ${aula?.inicio || l.startTime || ''}`,
        data: dia(l.date),
        dataBR: formatDateBR(l.date),
        aula: aula?.texto,
        conteudo: (l.subject || '').trim(),
        tarefa: (l.homework || '').trim() || undefined
      };
    })
    .sort((a, b) => a.ordem.localeCompare(b.ordem))
    .map(({ ordem, ...resto }) => resto);

  // Aulas da grade que já aconteceram e não têm registro no diário
  const aulasSemRegistro: ConteudoDaTurma['aulasSemRegistro'] = [];
  const fim = ate < hoje ? ate : somarDias(hoje, -1);
  for (let d = desde; d <= fim; d = somarDias(d, 1)) {
    if (getHolidayName(getSafeDate(d))) continue;
    if ((data.calendars || []).some(c => c.schoolId === school.id) && !calendarioNaData(data, school.id, d)) continue;
    const semana = diaDaSemana(d);
    getSchedulesForDate(data, d)
      .filter(s => Number(s.dayOfWeek) === semana && s.schoolId === school.id && eDaTurma(data, school, cls, s.classId))
      .filter(s => !isLessonBlocked(data, d, school.id, s.shiftId, s.classId))
      .forEach(s => {
        const temRegistro = registros.some(l => dia(l.date) === d && l.slotId === s.slotId);
        if (!temRegistro) aulasSemRegistro.push({ data: d, dataBR: formatDateBR(d), aula: descreverAula(school, s.slotId)?.texto });
      });
  }

  return {
    escola: school.name,
    turma: cls.name,
    desde,
    ate,
    ultimaAvaliacao: ultima && descreverAvaliacao(data, school, ultima),
    proximaAvaliacao: proxima && descreverAvaliacao(data, school, proxima),
    aulas,
    aulasSemRegistro
  };
};

export const conteudoDesdeUltimaAvaliacao = (
  data: AppData,
  opcoes: { turma: string; escola?: string; ate?: string; hoje: string }
): ConteudoDaTurma => {
  const { school, cls } = encontrarTurma(data, opcoes.turma, opcoes.escola);
  return conteudoEntre(data, school, cls, validarData(opcoes.ate, 'ate') || opcoes.hoje, opcoes.hoje);
};

// ── Alertas ───────────────────────────────────────────────────────────────────

export interface AvaliacaoProxima extends Avaliacao {
  diasAte: number;
  /** Conteúdo dado desde a avaliação anterior desta turma */
  conteudo?: Pick<ConteudoDaTurma, 'desde' | 'aulas' | 'aulasSemRegistro'>;
}

/** Avaliações de hoje até `dias` dias à frente, cada uma com o conteúdo que vai cair. */
export const avaliacoesProximas = (
  data: AppData,
  opcoes: { hoje: string; dias?: number; escola?: string }
): AvaliacaoProxima[] => {
  const dias = Math.max(0, Math.min(opcoes.dias ?? 7, 60));
  const ate = somarDias(opcoes.hoje, dias);
  const escolas = opcoes.escola ? [encontrarEscola(data, opcoes.escola)] : escolasAtivas(data);
  const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

  return escolas
    .flatMap(school => avaliacoesDe(data, school).map(e => ({ school, e })))
    .filter(({ e }) => dia(e.date) >= opcoes.hoje && dia(e.date) <= ate)
    .sort((a, b) => ordemDaAvaliacao(a.school, a.e).localeCompare(ordemDaAvaliacao(b.school, b.e)))
    .map(({ school, e }) => ({ school, e, cls: turmasAtivas(school).find(c => eDaTurma(data, school, c, e.classId)) }))
    // Avaliação de turma excluída não gera alerta
    .filter(({ e, cls }) => !e.classId || !!cls)
    .map(({ school, e, cls }) => {
      const c = cls && conteudoEntre(data, school, cls, dia(e.date), opcoes.hoje);
      return {
        ...descreverAvaliacao(data, school, e),
        diasAte: diasEntre(opcoes.hoje, dia(e.date)),
        conteudo: c && { desde: c.desde, aulas: c.aulas, aulasSemRegistro: c.aulasSemRegistro }
      };
    });
};

// ── Turmas e grade ────────────────────────────────────────────────────────────

export interface TurmasEGrade {
  vigenteEm: string;
  escolas: { escola: string; turmas: string[]; turnos: { turno: string; aulas: string[] }[] }[];
  grade: { dia: string; aulas: { numero: number; inicio: string; fim: string; escola: string; turma: string }[] }[];
}

/** Escolas, turmas, horários dos turnos e grade semanal em vigor na data. Janelas ficam de fora. */
export const turmasEGrade = (data: AppData, opcoes: { data: string }): TurmasEGrade => {
  const ref = validarData(opcoes.data, 'data')!;
  const escolas = escolasAtivas(data);

  const linhas = getSchedulesForDate(data, ref).flatMap(s => {
    if (s.classId === 'window') return [];
    const school = escolas.find(e => e.id === s.schoolId);
    const shift = school?.shifts.find(sh => sh.id === s.shiftId);
    const slot = shift?.slots.find(sl => sl.id === s.slotId);
    if (!school || !shift || !slot) return [];
    return [{
      diaSemana: Number(s.dayOfWeek),
      numero: lessonNumberInShift(shift.slots, slot.id),
      inicio: slot.startTime,
      fim: slot.endTime,
      escola: school.name,
      turma: nomeDaTurma(data, school, s.classId)
    }];
  });

  const dias = [1, 2, 3, 4, 5];
  if (linhas.some(l => l.diaSemana === 6)) dias.push(6);

  return {
    vigenteEm: ref,
    escolas: escolas.map(school => ({
      escola: school.name,
      turmas: turmasAtivas(school).map(c => c.name),
      turnos: (school.shifts || []).map(shift => ({
        turno: shift.name,
        aulas: shift.slots
          .filter(s => s.type !== 'break')
          .map(s => `${lessonNumberInShift(shift.slots, s.id)}ª ${s.startTime}–${s.endTime}`)
      }))
    })),
    grade: dias.map(d => ({
      dia: DIAS_SEMANA[d],
      aulas: linhas
        .filter(l => l.diaSemana === d)
        .sort((a, b) => parseTimeToMinutes(a.inicio) - parseTimeToMinutes(b.inicio) || a.escola.localeCompare(b.escola))
        .map(({ diaSemana, ...resto }) => resto)
    }))
  };
};

// ── Calendário ────────────────────────────────────────────────────────────────

const TIPOS_DE_EVENTO: Record<string, string> = {
  meeting: 'Reunião', festivity: 'Festividade', trip: 'Passeio', material: 'Material', other: 'Outro'
};

export interface Calendario {
  de: string;
  ate: string;
  feriados: { data: string; dataBR: string; nome: string }[];
  escolas: {
    escola: string;
    anoLetivo?: { inicio: string; fim: string; divisao: string };
    periodos: { nome: string; inicio: string; fim: string }[];
    recessoDeMeioDeAno?: { inicio: string; fim: string };
    recessos: { data: string; dataBR: string; nome: string }[];
    eventos: { data: string; dataBR: string; tipo: string; titulo: string; turma: string; suspendeAulas: boolean }[];
  }[];
}

/** Feriados, períodos (bimestres/trimestres), recessos e eventos que não são avaliações. */
export const calendario = (data: AppData, opcoes: { de: string; ate: string; escola?: string }): Calendario => {
  const de = validarData(opcoes.de, 'de')!;
  const ate = validarData(opcoes.ate, 'ate')!;
  if (ate < de) throw new ConsultaError('A data final vem antes da inicial.');
  if (Date.parse(ate) - Date.parse(de) > 400 * 86400000) throw new ConsultaError('Peça no máximo um ano por vez.');
  const noPeriodo = (d: string) => dia(d) >= de && dia(d) <= ate;

  const feriados: Calendario['feriados'] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    const nome = getHolidayName(getSafeDate(d));
    if (nome) feriados.push({ data: d, dataBR: formatDateBR(d), nome });
  }

  const escolas = opcoes.escola ? [encontrarEscola(data, opcoes.escola)] : escolasAtivas(data);

  return {
    de,
    ate,
    feriados,
    escolas: escolas.map(school => {
      // Calendário que cruza o período pedido (o mais recente, se houver vários)
      const cal = (data.calendars || [])
        .filter(c => c.schoolId === school.id && dia(c.start) <= ate && dia(c.end) >= de)
        .sort((a, b) => dia(b.start).localeCompare(dia(a.start)))[0];
      const meio = cal?.midYearBreak;
      return {
        escola: school.name,
        anoLetivo: cal && { inicio: dia(cal.start), fim: dia(cal.end), divisao: cal.division },
        periodos: (cal?.terms || []).map(t => ({ nome: t.name, inicio: dia(t.start), fim: dia(t.end) })),
        recessoDeMeioDeAno: meio?.start ? { inicio: dia(meio.start), fim: dia(meio.end) } : undefined,
        recessos: (cal?.extraRecesses || [])
          .filter(r => noPeriodo(r.date))
          .map(r => ({ data: dia(r.date), dataBR: formatDateBR(r.date), nome: r.name })),
        // Só o título: descrições de reuniões podem citar alunos
        eventos: (data.events || [])
          .filter(e => !eAvaliacao(e) && e.schoolId === school.id && noPeriodo(e.date))
          .sort((a, b) => dia(a.date).localeCompare(dia(b.date)))
          .map(e => ({
            data: dia(e.date),
            dataBR: formatDateBR(e.date),
            tipo: TIPOS_DE_EVENTO[e.type] || 'Outro',
            titulo: e.title,
            turma: nomeDaTurma(data, school, e.classId),
            suspendeAulas: !!e.blocksClasses
          }))
      };
    })
  };
};

// ── Aulas que faltam ──────────────────────────────────────────────────────────

/**
 * Aulas que faltam para a turma de hoje (inclusive) até o fim do período atual ou até uma data,
 * sem feriados, recessos e eventos que suspendem aula (utils/remainingLessons.ts).
 */
export const aulasRestantes = (data: AppData, opcoes: { turma: string; escola?: string; ate?: string; hoje: string }) => {
  const { school, cls } = encontrarTurma(data, opcoes.turma, opcoes.escola);
  const ate = validarData(opcoes.ate, 'ate');
  const r = countRemainingLessons(data, { schoolId: school.id, classId: cls.id, date: opcoes.hoje, until: ate });
  if (!r) throw new ConsultaError(`A ${school.name} não tem bimestres/trimestres cadastrados que incluam hoje. Cadastre o calendário da escola.`);
  const fim = ate || dia(r.term.end);
  return {
    escola: school.name,
    turma: cls.name,
    periodo: r.term.name,
    de: opcoes.hoje,
    ate: fim,
    ateBR: formatDateBR(fim),
    aulas: r.count,
    datas: r.dates.map(d => `${DIAS_SEMANA[diaDaSemana(d)]} ${formatDateBR(d)}`),
    proximaAvaliacao: r.nextAssessment && {
      titulo: r.nextAssessment.title,
      data: r.nextAssessment.date,
      dataBR: formatDateBR(r.nextAssessment.date),
      aulasAntes: r.nextAssessment.lessonsBefore
    }
  };
};
