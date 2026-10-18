import { AcademicCalendar, AppData, School, SchoolClass, SchoolEvent } from '../types';
import { deepEqual, formatDateBR, getHolidayName, getSafeDate } from '../utils';
import { getSchedulesForDate } from '../utils/schedule';
import { isLessonBlocked } from '../utils/lessonStats';
import { lessonNumberInShift } from '../utils/dashboardWeb';
import { removeUndefined } from '../utils/sync';
import {
  ConsultaError, DIAS_SEMANA, avaliacoesDe, calendarioNaData, dia, diaDaSemana, eDaTurma, encontrarEscola, encontrarTurma,
  escolasAtivas, normalizar, turmasAtivas, validarData
} from './consultas';

/**
 * Gravação pelo conector (etapa 2). Sempre em dois passos:
 * 1. "preparar": confere tudo e devolve a prévia + um plano (assinado depois, em servidor.ts);
 * 2. "aplicar": grava exatamente o plano, como "mais um aparelho" (carimbo `_m`, lápides em `_deleted`).
 * Cada gravação devolve um lote, que permite desfazer.
 *
 * Diferença proposital em relação ao app: o conector nunca apaga registro do diário. Se a aula da
 * avaliação já tiver registro, ele é mantido e o registro "Avaliação: X" não é criado.
 */

export type Situacao = 'Pendente' | 'Agendada' | 'Pronta';
export const SITUACOES: Situacao[] = ['Pendente', 'Agendada', 'Pronta'];

const camposDaSituacao = (s: Situacao) => ({ prepared: s === 'Pronta', scheduled: s === 'Agendada' });
const situacaoDe = (e: Pick<SchoolEvent, 'prepared' | 'scheduled'> | Item): Situacao =>
  e.prepared ? 'Pronta' : e.scheduled ? 'Agendada' : 'Pendente';

type Item = { id: string; _m?: number; [k: string]: any };

/** O que será gravado. Vai assinado na prévia e volta igual na confirmação. */
export interface Plano {
  resumo: string[];
  criar: { events: Item[]; logs: Item[] };
  situacoes: { id: string; situacao: Situacao; descricao: string }[];
  /** Registros do diário que já existem e ganham conteúdo (com o valor visto na prévia) */
  conteudos?: { id: string; subject: string; homework: string; antes: { subject: string; homework: string }; descricao: string }[];
  /** Calendários (um por escola) criados ou alterados, com o valor visto na prévia (null = novo) */
  calendarios?: { id: string; novo: any; antes: any | null; descricao: string }[];
  /** Restaurar uma cópia de segurança (connector/copias.ts) */
  restaurar?: { copia: string; descricao: string };
}

/** O que foi gravado, para desfazer. */
export interface Lote {
  em: number;
  resumo: string[];
  criados: { events: string[]; logs: string[] };
  situacoesAnteriores: { id: string; prepared: boolean; scheduled: boolean; descricao: string }[];
  conteudosAnteriores?: { id: string; subject: string; homework: string; descricao: string }[];
  calendariosAnteriores?: { id: string; antes: any | null; descricao: string }[];
  /** Restauração feita: desfazer = restaurar a cópia guardada antes dela */
  restauracao?: { desfazerCom: string };
}

export interface ItemDaPrevia {
  pedido: number;
  ok: boolean;
  descricao: string;
  avisos: string[];
  erro?: string;
}

const novoId = () => crypto.randomUUID();
const diaISO = (d: string) => `${d}T00:00:00.000Z`;
const quando = (d: string) => `${DIAS_SEMANA[diaDaSemana(d)]} ${formatDateBR(d)}`;

// ── Aulas da turma num dia ────────────────────────────────────────────────────

interface AulaNoDia { slotId: string; shiftId: string; numero: number; inicio: string; texto: string }

/** Aulas da turma no dia, pela grade em vigor naquela data (sem janelas). */
export const aulasDaTurmaNoDia = (data: AppData, school: School, cls: SchoolClass, d: string): AulaNoDia[] => {
  const semana = diaDaSemana(d);
  return getSchedulesForDate(data, d)
    .filter(s => Number(s.dayOfWeek) === semana && s.schoolId === school.id && s.classId !== 'window')
    .filter(s => eDaTurma(data, school, cls, s.classId))
    .flatMap(s => {
      const shift = school.shifts.find(sh => sh.id === s.shiftId);
      const slot = shift?.slots.find(sl => sl.id === s.slotId);
      if (!shift || !slot) return [];
      const numero = lessonNumberInShift(shift.slots, slot.id);
      return [{ slotId: slot.id, shiftId: shift.id, numero, inicio: slot.startTime, texto: `${numero}ª aula (${slot.startTime})` }];
    })
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
};

/** Dias da semana em que a turma tem aula (para a mensagem de erro). */
const diasComAula = (data: AppData, school: School, cls: SchoolClass, d: string) => {
  const dias = new Set(getSchedulesForDate(data, d)
    .filter(s => s.schoolId === school.id && s.classId !== 'window' && eDaTurma(data, school, cls, s.classId))
    .map(s => Number(s.dayOfWeek)));
  return [...dias].sort().map(n => DIAS_SEMANA[n]).join(', ') || 'nenhum dia na grade';
};

// ── Cadastrar avaliações ──────────────────────────────────────────────────────

export interface PedidoDeAvaliacao {
  turma: string;
  escola?: string;
  data: string;
  tipo: 'prova' | 'trabalho';
  titulo: string;
  descricao?: string;
  /** Número da aula no turno (1ª, 2ª…), quando a turma tem mais de uma aula no dia */
  aula?: number;
  situacao?: Situacao;
}

export const prepararAvaliacoes = (data: AppData, pedidos: PedidoDeAvaliacao[], hoje: string, agora = Date.now()) => {
  if (!pedidos.length) throw new ConsultaError('Nenhuma avaliação informada.');
  if (pedidos.length > 40) throw new ConsultaError('Envie no máximo 40 avaliações por vez.');

  const plano: Plano = { resumo: [], criar: { events: [], logs: [] }, situacoes: [] };
  const itens: ItemDaPrevia[] = [];
  // Para detectar repetição dentro do próprio pedido
  const nestePedido: { schoolId: string; classId: string; dia: string; titulo: string; slotId: string }[] = [];

  pedidos.forEach((p, i) => {
    const item: ItemDaPrevia = { pedido: i + 1, ok: false, descricao: `${p.titulo} (${p.turma}, ${p.data})`, avisos: [] };
    itens.push(item);
    try {
      const d = validarData(p.data, 'data')!;
      const titulo = (p.titulo || '').trim();
      if (!titulo) throw new ConsultaError('Falta o título da avaliação.');
      if (p.tipo !== 'prova' && p.tipo !== 'trabalho') throw new ConsultaError('O tipo deve ser "prova" ou "trabalho".');
      const situacao = p.situacao ?? 'Pendente';
      if (!SITUACOES.includes(situacao)) throw new ConsultaError('Situação deve ser Pendente, Agendada ou Pronta.');
      const { school, cls } = encontrarTurma(data, p.turma, p.escola);
      const tipoTexto = p.tipo === 'prova' ? 'Prova' : 'Trabalho';
      item.descricao = `${tipoTexto} "${titulo}" — ${cls.name} (${school.name}), ${quando(d)}`;

      // Em qual aula
      const aulas = aulasDaTurmaNoDia(data, school, cls, d);
      if (!aulas.length) {
        throw new ConsultaError(`A turma ${cls.name} não tem aula na grade em ${quando(d)}. Dias com aula: ${diasComAula(data, school, cls, d)}.`);
      }
      let aula = aulas[0];
      if (p.aula !== undefined) {
        const escolhida = aulas.find(a => a.numero === p.aula);
        if (!escolhida) throw new ConsultaError(`Nesse dia a turma ${cls.name} tem: ${aulas.map(a => a.texto).join(', ')}. Escolha uma delas.`);
        aula = escolhida;
      } else if (aulas.length > 1) {
        throw new ConsultaError(`Nesse dia a turma ${cls.name} tem aulas seguidas: ${aulas.map(a => a.texto).join(' e ')}. Pergunte ao Cadu em qual aula será a avaliação e informe o número da aula.`);
      }
      item.descricao += `, ${aula.texto}`;

      // Dia sem aula
      const feriado = getHolidayName(getSafeDate(d));
      if (feriado) throw new ConsultaError(`${formatDateBR(d)} é feriado (${feriado}).`);
      if (isLessonBlocked(data, d, school.id, aula.shiftId, cls.id)) {
        throw new ConsultaError(`${formatDateBR(d)} está sem aula nessa escola (recesso ou evento que suspende as aulas).`);
      }
      if ((data.calendars || []).some(c => c.schoolId === school.id) && !calendarioNaData(data, school.id, d)) {
        item.avisos.push('A data está fora do ano letivo cadastrado para essa escola.');
      }
      if (d < hoje) item.avisos.push('A data já passou.');

      // Repetição
      const mesmaTurmaNoDia = avaliacoesDe(data, school, cls).filter(e => dia(e.date) === d);
      if (mesmaTurmaNoDia.some(e => normalizar(e.title) === normalizar(titulo))) {
        throw new ConsultaError(`Já existe "${titulo}" para a ${cls.name} nesse dia.`);
      }
      const naMesmaAula = mesmaTurmaNoDia.find(e => e.slotId === aula.slotId);
      if (naMesmaAula) item.avisos.push(`Já existe outra avaliação nessa aula: "${naMesmaAula.title}".`);
      if (nestePedido.some(o => o.schoolId === school.id && o.classId === cls.id && o.dia === d && normalizar(o.titulo) === normalizar(titulo))) {
        throw new ConsultaError('Repetida neste mesmo pedido.');
      }
      if (nestePedido.some(o => o.schoolId === school.id && o.classId === cls.id && o.dia === d && o.slotId === aula.slotId)) {
        item.avisos.push('Outra avaliação deste pedido está na mesma aula.');
      }

      // Registro no diário (como o app faz), sem apagar registro existente
      const registro = (data.logs || []).find(l =>
        l.status !== 'removed' && !l.studentId && dia(l.date) === d && l.schoolId === school.id && l.slotId === aula.slotId);
      const evento: Item = removeUndefined({
        id: novoId(), title: titulo, date: diaISO(d), schoolId: school.id, classId: cls.id, slotId: aula.slotId,
        type: p.tipo === 'prova' ? 'test' : 'work', description: (p.descricao || '').trim(), blocksClasses: false,
        ...camposDaSituacao(situacao), _m: agora
      });
      plano.criar.events.push(evento);
      if (registro) {
        item.avisos.push(`Essa aula já tem registro no diário ("${(registro.subject || '').slice(0, 60)}"). Ele será mantido e o registro "Avaliação: ${titulo}" não será criado.`);
      } else {
        plano.criar.logs.push({
          id: novoId(), date: diaISO(d), schoolId: school.id, classId: cls.id, slotId: aula.slotId,
          subject: `Avaliação: ${titulo}`, homework: '', notes: evento.description, _m: agora
        });
      }
      item.descricao += ` — ${situacao}`;
      plano.resumo.push(item.descricao);
      nestePedido.push({ schoolId: school.id, classId: cls.id, dia: d, titulo, slotId: aula.slotId });
      item.ok = true;
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      item.erro = e.message;
    }
  });

  return { itens, plano: plano.resumo.length ? plano : null };
};

// ── Mudar a situação de avaliações ────────────────────────────────────────────

export interface PedidoDeSituacao {
  turma: string;
  escola?: string;
  data: string;
  /** Só é preciso quando a turma tem mais de uma avaliação no dia */
  titulo?: string;
  situacao: Situacao;
}

export const prepararSituacoes = (data: AppData, pedidos: PedidoDeSituacao[]) => {
  if (!pedidos.length) throw new ConsultaError('Nenhuma avaliação informada.');
  if (pedidos.length > 40) throw new ConsultaError('Envie no máximo 40 avaliações por vez.');
  const plano: Plano = { resumo: [], criar: { events: [], logs: [] }, situacoes: [] };
  const itens: ItemDaPrevia[] = [];

  pedidos.forEach((p, i) => {
    const item: ItemDaPrevia = { pedido: i + 1, ok: false, descricao: `${p.turma}, ${p.data}`, avisos: [] };
    itens.push(item);
    try {
      const d = validarData(p.data, 'data')!;
      if (!SITUACOES.includes(p.situacao)) throw new ConsultaError('Situação deve ser Pendente, Agendada ou Pronta.');
      const { school, cls } = encontrarTurma(data, p.turma, p.escola);
      let candidatas = avaliacoesDe(data, school, cls).filter(e => dia(e.date) === d);
      if (p.titulo) {
        const alvo = normalizar(p.titulo);
        const exatas = candidatas.filter(e => normalizar(e.title) === alvo);
        candidatas = exatas.length ? exatas : candidatas.filter(e => normalizar(e.title).includes(alvo));
      }
      if (!candidatas.length) throw new ConsultaError(`Não há avaliação${p.titulo ? ` "${p.titulo}"` : ''} da ${cls.name} em ${quando(d)}.`);
      if (candidatas.length > 1) {
        throw new ConsultaError(`A ${cls.name} tem mais de uma avaliação nesse dia: ${candidatas.map(e => `"${e.title}"`).join(', ')}. Informe o título.`);
      }
      const ev = candidatas[0] as SchoolEvent;
      if (plano.situacoes.some(s => s.id === ev.id)) throw new ConsultaError('Avaliação repetida neste pedido.');
      const atual = situacaoDe(ev);
      item.descricao = `"${ev.title}" — ${cls.name} (${school.name}), ${quando(d)}: ${atual} → ${p.situacao}`;
      if (atual === p.situacao) {
        item.avisos.push(`Já está como ${atual}; nada muda.`);
        item.ok = true;
        return;
      }
      plano.situacoes.push({ id: ev.id, situacao: p.situacao, descricao: item.descricao });
      plano.resumo.push(item.descricao);
      item.ok = true;
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      item.erro = e.message;
    }
  });

  return { itens, plano: plano.resumo.length ? plano : null };
};

// ── Registrar conteúdo de aula ────────────────────────────────────────────────

/** Mesmos limites e limpeza do app (utils/validation.ts, que não dá para importar aqui por usar React). */
const LIMITE_CONTEUDO = 500;
const LIMITE_TAREFA = 2000;
const limpar = (t: string | undefined) => (t || '').trim().replace(/[<>]/g, '');

export interface PedidoDeConteudo {
  turma: string;
  escola?: string;
  data: string;
  /** Números das aulas no turno (1ª, 2ª…). Obrigatório quando a turma tem aulas seguidas no dia */
  aulas?: number[];
  conteudo?: string;
  tarefa?: string;
  /** "acrescentar" (padrão) junta ao que já está no diário; "substituir" troca */
  modo?: 'acrescentar' | 'substituir';
}

const juntar = (atual: string, novo: string, modo: 'acrescentar' | 'substituir') => {
  if (!novo) return atual;
  if (modo === 'substituir' || !atual.trim()) return novo;
  if (normalizar(atual).includes(normalizar(novo))) return atual;
  return `${atual}\n${novo}`;
};

export const prepararConteudos = (data: AppData, pedidos: PedidoDeConteudo[], hoje: string, agora = Date.now()) => {
  if (!pedidos.length) throw new ConsultaError('Nenhum registro informado.');
  if (pedidos.length > 40) throw new ConsultaError('Envie no máximo 40 registros por vez.');

  const plano: Plano = { resumo: [], criar: { events: [], logs: [] }, situacoes: [], conteudos: [] };
  const itens: ItemDaPrevia[] = [];
  const aulasNestePedido = new Set<string>();

  pedidos.forEach((p, i) => {
    const item: ItemDaPrevia = { pedido: i + 1, ok: false, descricao: `${p.turma}, ${p.data}`, avisos: [] };
    itens.push(item);
    try {
      const d = validarData(p.data, 'data')!;
      const modo = p.modo ?? 'acrescentar';
      const conteudo = limpar(p.conteudo);
      const tarefa = limpar(p.tarefa);
      if (!conteudo && !tarefa) throw new ConsultaError('Informe o conteúdo da aula (ou a tarefa).');
      if (conteudo.length > LIMITE_CONTEUDO) throw new ConsultaError(`O conteúdo passa de ${LIMITE_CONTEUDO} caracteres (limite do app).`);
      if (tarefa.length > LIMITE_TAREFA) throw new ConsultaError(`A tarefa passa de ${LIMITE_TAREFA} caracteres (limite do app).`);
      const { school, cls } = encontrarTurma(data, p.turma, p.escola);
      item.descricao = `${cls.name} (${school.name}), ${quando(d)}`;

      // Quais aulas
      const aulasDoDia = aulasDaTurmaNoDia(data, school, cls, d);
      if (!aulasDoDia.length) {
        throw new ConsultaError(`A turma ${cls.name} não tem aula na grade em ${quando(d)}. Dias com aula: ${diasComAula(data, school, cls, d)}.`);
      }
      let escolhidas = aulasDoDia;
      if (p.aulas?.length) {
        escolhidas = p.aulas.map(n => {
          const a = aulasDoDia.find(x => x.numero === n);
          if (!a) throw new ConsultaError(`Nesse dia a turma ${cls.name} tem: ${aulasDoDia.map(x => x.texto).join(', ')}. Escolha entre elas.`);
          return a;
        });
        escolhidas = escolhidas.filter((a, k) => escolhidas.findIndex(b => b.slotId === a.slotId) === k);
      } else if (aulasDoDia.length > 1) {
        throw new ConsultaError(`Nesse dia a turma ${cls.name} tem aulas seguidas: ${aulasDoDia.map(a => a.texto).join(' e ')}. Pergunte ao Cadu se o conteúdo vale para todas ou só para uma, e informe os números das aulas.`);
      }
      item.descricao += `, ${escolhidas.map(a => a.texto).join(' e ')}`;

      const feriado = getHolidayName(getSafeDate(d));
      if (feriado) throw new ConsultaError(`${formatDateBR(d)} é feriado (${feriado}).`);
      for (const a of escolhidas) {
        if (isLessonBlocked(data, d, school.id, a.shiftId, cls.id)) {
          throw new ConsultaError(`${formatDateBR(d)} está sem aula nessa escola (recesso ou evento que suspende as aulas).`);
        }
      }
      if (d > hoje) item.avisos.push('A aula ainda não aconteceu: fica registrado como planejamento.');

      const novos: Item[] = [];
      const edicoes: NonNullable<Plano['conteudos']> = [];
      for (const a of escolhidas) {
        const chave = `${school.id}|${d}|${a.slotId}`;
        if (aulasNestePedido.has(chave)) throw new ConsultaError(`A ${a.texto} aparece duas vezes neste pedido.`);
        aulasNestePedido.add(chave);

        const registro = (data.logs || []).find(l => !l.studentId && dia(l.date) === d && l.schoolId === school.id && l.slotId === a.slotId);
        if (registro && registro.status === 'removed') {
          throw new ConsultaError(`A ${a.texto} foi marcada como removida no app; não dá para registrar conteúdo nela.`);
        }
        if (registro && registro.classId && !eDaTurma(data, school, cls, registro.classId)) {
          throw new ConsultaError(`A ${a.texto} desse dia já tem registro de outra turma no diário.`);
        }
        if (!registro) {
          novos.push({
            id: novoId(), date: diaISO(d), schoolId: school.id, classId: cls.id, slotId: a.slotId,
            subject: conteudo, homework: tarefa, notes: '', type: 'regular', _m: agora
          });
          continue;
        }
        const antes = { subject: registro.subject || '', homework: registro.homework || '' };
        const depois = { subject: juntar(antes.subject, conteudo, modo), homework: juntar(antes.homework, tarefa, modo) };
        if (depois.subject.length > LIMITE_CONTEUDO) {
          throw new ConsultaError(`Juntando com o que já está no diário da ${a.texto}, o conteúdo passa de ${LIMITE_CONTEUDO} caracteres. Use modo "substituir" ou encurte.`);
        }
        if (depois.subject === antes.subject && depois.homework === antes.homework) {
          item.avisos.push(`A ${a.texto} já tem esse registro; nada muda nela.`);
          continue;
        }
        item.avisos.push(antes.subject
          ? `A ${a.texto} já tinha no diário: "${antes.subject}". Vai ficar: "${depois.subject}".`
          : `A ${a.texto} já tinha um registro sem conteúdo; ele será preenchido.`);
        edicoes.push({ id: registro.id, ...depois, antes, descricao: `${item.descricao}: ${a.texto}` });
      }

      if (!novos.length && !edicoes.length) {
        item.ok = true;
        return;
      }
      plano.criar.logs.push(...novos);
      plano.conteudos!.push(...edicoes);
      const resumo = [conteudo && `"${conteudo}"`, tarefa && `tarefa: "${tarefa}"`].filter(Boolean).join(', ');
      item.descricao += ` — ${resumo}`;
      plano.resumo.push(item.descricao);
      item.ok = true;
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      item.erro = e.message;
    }
  });

  return { itens, plano: plano.resumo.length ? plano : null };
};

// ── Calendário da escola ──────────────────────────────────────────────────────

/** Calendário (um por escola, como o app) sem o carimbo, para comparar. */
const semCarimbo = (c: any) => {
  if (!c) return c;
  const { _m, ...resto } = c;
  return resto;
};

const calendarioDaEscola = (data: AppData, schoolId: string): (AcademicCalendar & { _m?: number }) | undefined =>
  [...(data.calendars || [])]
    .filter(c => c.schoolId === schoolId)
    .sort((a, b) => dia(b.start).localeCompare(dia(a.start)))[0];

const intervaloBR = (a: string, b: string) => `${formatDateBR(a)} a ${formatDateBR(b)}`;

export interface PedidoDeCalendario {
  escola: string;
  divisao?: 'bimestres' | 'trimestres' | 'personalizado';
  /** Início e fim do ano letivo */
  inicio?: string;
  fim?: string;
  periodos?: { nome?: string; inicio: string; fim: string }[];
  /** null apaga o recesso de meio de ano */
  recesso_meio_ano?: { inicio: string; fim: string } | null;
}

/** Junta as mudanças de calendário de um mesmo pedido (cada escola entra uma vez no plano). */
const registrarCalendario = (plano: Plano, antes: any, novo: any, descricao: string) => {
  plano.calendarios ??= [];
  const ja = plano.calendarios.find(c => c.id === novo.id);
  if (ja) {
    ja.novo = novo;
    ja.descricao += `; ${descricao}`;
  } else {
    plano.calendarios.push({ id: novo.id, novo, antes: antes ? semCarimbo(antes) : null, descricao });
  }
};

/** Calendário atual da escola, já com as mudanças anteriores deste mesmo pedido. */
const calendarioEmPreparo = (data: AppData, plano: Plano, schoolId: string) => {
  const atual = calendarioDaEscola(data, schoolId);
  const emPreparo = plano.calendarios?.find(c => c.novo.schoolId === schoolId);
  return { atual, base: emPreparo ? emPreparo.novo : atual };
};

export const prepararCalendarios = (data: AppData, pedidos: PedidoDeCalendario[], agora = Date.now()) => {
  if (!pedidos.length) throw new ConsultaError('Nenhum calendário informado.');
  if (pedidos.length > 10) throw new ConsultaError('Envie no máximo 10 escolas por vez.');
  const plano: Plano = { resumo: [], criar: { events: [], logs: [] }, situacoes: [] };
  const itens: ItemDaPrevia[] = [];

  pedidos.forEach((p, i) => {
    const item: ItemDaPrevia = { pedido: i + 1, ok: false, descricao: p.escola, avisos: [] };
    itens.push(item);
    try {
      const school = encontrarEscola(data, p.escola);
      item.descricao = `Calendário da ${school.name}`;
      const { atual, base } = calendarioEmPreparo(data, plano, school.id);
      const inicio = validarData(p.inicio, 'inicio');
      const fim = validarData(p.fim, 'fim');
      if (!base && (!inicio || !fim)) {
        throw new ConsultaError(`A ${school.name} ainda não tem calendário. Para criar, informe o início e o fim do ano letivo.`);
      }
      const novo: any = base
        ? JSON.parse(JSON.stringify(semCarimbo(base)))
        : { id: novoId(), schoolId: school.id, year: Number(inicio!.slice(0, 4)), division: 'trimestres', start: inicio, end: fim,
            terms: [], midYearBreak: { start: '', end: '' }, extraRecesses: [] };
      const mudancas: string[] = [];
      if (!base) mudancas.push('calendário novo');

      if (inicio) novo.start = inicio;
      if (fim) novo.end = fim;
      if (dia(novo.start) > dia(novo.end)) throw new ConsultaError('O início do ano letivo vem depois do fim.');
      if (base && (dia(base.start) !== dia(novo.start) || dia(base.end) !== dia(novo.end))) {
        mudancas.push(`ano letivo: ${intervaloBR(novo.start, novo.end)} (era ${intervaloBR(base.start, base.end)})`);
      } else if (!base) {
        mudancas.push(`ano letivo: ${intervaloBR(novo.start, novo.end)}`);
      }
      novo.year = Number(dia(novo.start).slice(0, 4));

      if (p.divisao && p.divisao !== novo.division) {
        mudancas.push(`divisão: ${p.divisao}${base ? ` (era ${base.division})` : ''}`);
        novo.division = p.divisao;
      }
      const esperado = novo.division === 'bimestres' ? 4 : novo.division === 'trimestres' ? 3 : 0;
      const rotulo = novo.division === 'bimestres' ? 'Bimestre' : novo.division === 'trimestres' ? 'Trimestre' : 'Período';

      if (p.periodos) {
        const periodos = p.periodos.map((t, k) => ({
          name: (t.nome || '').trim() || `${k + 1}º ${rotulo}`,
          start: validarData(t.inicio, `periodos[${k + 1}].inicio`)!,
          end: validarData(t.fim, `periodos[${k + 1}].fim`)!
        }));
        periodos.forEach((t, k) => {
          if (t.start > t.end) throw new ConsultaError(`${t.name}: o início vem depois do fim.`);
          if (k > 0 && t.start <= periodos[k - 1].end) throw new ConsultaError(`${t.name} começa antes do fim de ${periodos[k - 1].name}.`);
          if (t.start < dia(novo.start) || t.end > dia(novo.end)) item.avisos.push(`${t.name} sai do ano letivo (${intervaloBR(novo.start, novo.end)}).`);
        });
        if (esperado && periodos.length !== esperado) item.avisos.push(`Foram informados ${periodos.length} períodos para ${novo.division} (o normal são ${esperado}).`);
        const antesTermos = JSON.stringify((base?.terms || []).map((t: any) => [t.name, dia(t.start), dia(t.end)]));
        if (antesTermos !== JSON.stringify(periodos.map(t => [t.name, t.start, t.end]))) {
          mudancas.push(`períodos: ${periodos.map(t => `${t.name} ${intervaloBR(t.start, t.end)}`).join('; ')}`);
          if (base && (base.terms || []).length !== periodos.length && (data.gradingConfigs || []).some(g => g.schoolId === school.id)) {
            item.avisos.push('O número de períodos mudou e há configurações de notas nessa escola, que usam a posição do período. Confira as notas no app.');
          }
        }
        novo.terms = periodos;
      } else if (p.divisao && esperado && (novo.terms || []).length !== esperado) {
        item.avisos.push(`Os períodos não foram informados e continuam ${(novo.terms || []).length}. Informe as datas de cada ${rotulo.toLowerCase()}.`);
      }

      if (p.recesso_meio_ano !== undefined) {
        const r = p.recesso_meio_ano;
        const anterior = novo.midYearBreak?.start ? intervaloBR(novo.midYearBreak.start, novo.midYearBreak.end) : 'nenhum';
        if (r === null) {
          if (novo.midYearBreak?.start) mudancas.push(`recesso de meio de ano removido (era ${anterior})`);
          novo.midYearBreak = { start: '', end: '' };
        } else {
          const ri = validarData(r.inicio, 'recesso_meio_ano.inicio')!;
          const rf = validarData(r.fim, 'recesso_meio_ano.fim')!;
          if (ri > rf) throw new ConsultaError('O recesso de meio de ano começa depois de terminar.');
          if (ri !== dia(novo.midYearBreak?.start) || rf !== dia(novo.midYearBreak?.end)) {
            mudancas.push(`recesso de meio de ano: ${intervaloBR(ri, rf)} (era ${anterior})`);
          }
          novo.midYearBreak = { start: ri, end: rf };
        }
      }

      if (!mudancas.length) {
        item.avisos.push('Nada muda no calendário.');
        item.ok = true;
        return;
      }
      item.descricao += `: ${mudancas.join('; ')}`;
      registrarCalendario(plano, atual, novo, item.descricao);
      plano.resumo.push(item.descricao);
      item.ok = true;
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      item.erro = e.message;
    }
  });

  return { itens, plano: plano.resumo.length ? plano : null };
};

// ── Recessos e feriados da escola ─────────────────────────────────────────────

export interface PedidoDeRecesso {
  /** Sem escola = vale para todas (ex.: feriado municipal) */
  escola?: string;
  data: string;
  nome: string;
}

const temConteudoDeAula = (subject?: string) =>
  !!(subject || '').trim() && !/^(Avaliação|Evento):/.test(subject || '');

export const prepararRecessos = (data: AppData, pedidos: PedidoDeRecesso[]) => {
  if (!pedidos.length) throw new ConsultaError('Nenhum recesso informado.');
  if (pedidos.length > 40) throw new ConsultaError('Envie no máximo 40 recessos por vez.');
  const plano: Plano = { resumo: [], criar: { events: [], logs: [] }, situacoes: [] };
  const itens: ItemDaPrevia[] = [];

  pedidos.forEach((p, i) => {
    const item: ItemDaPrevia = { pedido: i + 1, ok: false, descricao: `${p.nome} (${p.data})`, avisos: [] };
    itens.push(item);
    try {
      const d = validarData(p.data, 'data')!;
      const nome = (p.nome || '').trim();
      if (!nome) throw new ConsultaError('Informe o nome do recesso ou feriado.');
      const feriado = getHolidayName(getSafeDate(d));
      if (feriado) throw new ConsultaError(`${formatDateBR(d)} já é feriado nacional no app (${feriado}); não precisa cadastrar.`);
      const escolas = p.escola ? [encontrarEscola(data, p.escola)] : escolasAtivas(data);
      item.descricao = `"${nome}" em ${quando(d)}`;

      const incluidas: string[] = [];
      for (const school of escolas) {
        const { atual, base } = calendarioEmPreparo(data, plano, school.id);
        if (!base) {
          item.avisos.push(`${school.name}: ainda não tem calendário cadastrado; não incluída.`);
          continue;
        }
        if ((base.extraRecesses || []).some((r: any) => dia(r.date) === d)) {
          item.avisos.push(`${school.name}: já tem recesso nesse dia; não incluída.`);
          continue;
        }
        if (d < dia(base.start) || d > dia(base.end)) item.avisos.push(`${school.name}: a data está fora do ano letivo.`);
        const doDia = (data.logs || []).filter(l => !l.studentId && l.schoolId === school.id && dia(l.date) === d && l.status !== 'removed');
        const comConteudo = doDia.filter(l => temConteudoDeAula(l.subject)).length;
        if (comConteudo) item.avisos.push(`${school.name}: há ${comConteudo} registro(s) de conteúdo no diário nesse dia; eles continuam lá, mas o dia passa a contar como sem aula.`);
        const provas = avaliacoesDe(data, school).filter(e => dia(e.date) === d);
        if (provas.length) item.avisos.push(`${school.name}: há avaliação nesse dia (${provas.map(e => `"${e.title}"`).join(', ')}); remarque no app.`);
        const novo = JSON.parse(JSON.stringify(semCarimbo(base)));
        novo.extraRecesses = [...(novo.extraRecesses || []), { id: novoId(), name: nome, date: d }];
        registrarCalendario(plano, atual, novo, `recesso "${nome}" em ${formatDateBR(d)}`);
        incluidas.push(school.name);
      }
      if (!incluidas.length) throw new ConsultaError('Nenhuma escola pôde receber este recesso (veja os avisos).');
      item.descricao += ` — ${incluidas.join(', ')}`;
      plano.resumo.push(`Recesso ${item.descricao}`);
      item.ok = true;
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      item.erro = e.message;
    }
  });

  return { itens, plano: plano.resumo.length ? plano : null };
};

// ── Eventos (reunião, festa, passeio…) ────────────────────────────────────────

const TIPOS_EVENTO: Record<string, { tipo: string; rotulo: string }> = {
  reuniao: { tipo: 'meeting', rotulo: 'Reunião' },
  festividade: { tipo: 'festivity', rotulo: 'Festividade' },
  passeio: { tipo: 'trip', rotulo: 'Passeio' },
  material: { tipo: 'material', rotulo: 'Material' },
  outro: { tipo: 'other', rotulo: 'Outro' }
};

export interface PedidoDeEvento {
  escola: string;
  data: string;
  tipo: keyof typeof TIPOS_EVENTO;
  titulo: string;
  descricao?: string;
  /** Suspende as aulas (da escola toda, de um turno ou de uma turma) */
  suspende_aulas?: boolean;
  turno?: string;
  turma?: string;
}

export const prepararEventos = (data: AppData, pedidos: PedidoDeEvento[], hoje: string, agora = Date.now()) => {
  if (!pedidos.length) throw new ConsultaError('Nenhum evento informado.');
  if (pedidos.length > 40) throw new ConsultaError('Envie no máximo 40 eventos por vez.');
  const plano: Plano = { resumo: [], criar: { events: [], logs: [] }, situacoes: [] };
  const itens: ItemDaPrevia[] = [];

  pedidos.forEach((p, i) => {
    const item: ItemDaPrevia = { pedido: i + 1, ok: false, descricao: `${p.titulo} (${p.data})`, avisos: [] };
    itens.push(item);
    try {
      const d = validarData(p.data, 'data')!;
      const titulo = (p.titulo || '').trim();
      if (!titulo) throw new ConsultaError('Informe o título do evento.');
      const tipo = TIPOS_EVENTO[p.tipo];
      if (!tipo) throw new ConsultaError('Tipo deve ser reuniao, festividade, passeio, material ou outro.');
      const school = encontrarEscola(data, p.escola);
      const cls = p.turma ? encontrarTurma(data, p.turma, school.name).cls : undefined;
      let shift: School['shifts'][number] | undefined;
      if (p.turno) {
        const alvo = normalizar(p.turno);
        const achados = school.shifts.filter(s => normalizar(s.name).includes(alvo));
        if (achados.length !== 1) throw new ConsultaError(`Turno "${p.turno}" não encontrado. Turnos da ${school.name}: ${school.shifts.map(s => s.name).join(', ')}.`);
        shift = achados[0];
      }
      if (cls && shift) throw new ConsultaError('Informe a turma ou o turno, não os dois.');
      const suspende = !!p.suspende_aulas;
      const alcance = cls ? `turma ${cls.name}` : shift ? `turno ${shift.name}` : 'escola toda';
      item.descricao = `${tipo.rotulo} "${titulo}" — ${school.name}, ${quando(d)}${suspende ? `, suspende as aulas (${alcance})` : cls ? `, turma ${cls.name}` : ''}`;

      const feriado = getHolidayName(getSafeDate(d));
      if (feriado) item.avisos.push(`${formatDateBR(d)} é feriado (${feriado}).`);
      if ((data.calendars || []).some(c => c.schoolId === school.id) && !calendarioNaData(data, school.id, d)) {
        item.avisos.push('A data está fora do ano letivo cadastrado para essa escola.');
      }
      if (d < hoje) item.avisos.push('A data já passou.');
      const repetido = (data.events || []).some(e =>
        e.schoolId === school.id && dia(e.date) === d && e.type !== 'test' && e.type !== 'work' && normalizar(e.title) === normalizar(titulo));
      if (repetido || plano.criar.events.some(e => e.schoolId === school.id && dia(e.date) === d && normalizar(e.title) === normalizar(titulo))) {
        throw new ConsultaError(`Já existe "${titulo}" nesse dia nessa escola.`);
      }

      const novosLogs: Item[] = [];
      if (suspende) {
        const semana = diaDaSemana(d);
        const aulas = getSchedulesForDate(data, d).filter(s =>
          s.schoolId === school.id && Number(s.dayOfWeek) === semana && s.classId !== 'window' &&
          (cls ? eDaTurma(data, school, cls, s.classId) : shift ? s.shiftId === shift.id : true));
        const slotsAfetados = new Set(aulas.map(s => s.slotId));
        const doDia = (data.logs || []).filter(l => !l.studentId && l.schoolId === school.id && dia(l.date) === d && slotsAfetados.has(l.slotId) && l.status !== 'removed');
        if (doDia.some(l => temConteudoDeAula(l.subject) || (l.homework || '').trim())) {
          throw new ConsultaError('Já há conteúdo registrado no diário nas aulas desse dia (no alcance do evento). Como no app, remova esses registros antes de suspender as aulas.');
        }
        const provas = avaliacoesDe(data, school, cls).filter(e => dia(e.date) === d && (!shift || shift.slots.some(sl => sl.id === e.slotId)));
        if (provas.length) item.avisos.push(`Há avaliação nesse dia (${provas.map(e => `"${e.title}"`).join(', ')}); remarque no app.`);
        for (const s of aulas) {
          if ((data.logs || []).some(l => !l.studentId && l.schoolId === school.id && dia(l.date) === d && l.slotId === s.slotId)) continue;
          const turma = turmasAtivas(school).find(c => eDaTurma(data, school, c, s.classId));
          novosLogs.push({
            id: novoId(), date: diaISO(d), schoolId: school.id, classId: turma ? turma.id : s.classId, slotId: s.slotId,
            subject: `Evento: ${titulo}`, homework: '', notes: 'Aula substituída por evento escolar.', _m: agora
          });
        }
        if (!aulas.length) item.avisos.push('Não há aulas na grade nesse dia (no alcance do evento).');
        else item.avisos.push(`${aulas.length} aula(s) desse dia ficam marcadas como "Evento: ${titulo}" no diário.`);
      }

      plano.criar.events.push(removeUndefined({
        id: novoId(), schoolId: school.id, date: diaISO(d), type: tipo.tipo, title: titulo,
        description: (p.descricao || '').trim(), blocksClasses: suspende,
        blocksShift: suspende && !cls,
        slotId: suspende && shift ? shift.id : undefined,
        classId: cls ? cls.id : undefined,
        _m: agora
      }));
      plano.criar.logs.push(...novosLogs);
      plano.resumo.push(item.descricao);
      item.ok = true;
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      item.erro = e.message;
    }
  });

  return { itens, plano: plano.resumo.length ? plano : null };
};

// ── Aplicar e desfazer ────────────────────────────────────────────────────────

/** Campos do documento que a gravação altera (o resto do documento não é tocado). */
export type Alteracoes = Partial<Record<'events' | 'logs' | 'calendars' | '_deleted', unknown>>;

const lapides = (raw: any): Record<string, number> => ({ ...(raw._deleted || {}) });
const semCarimboItem = (i: any) => {
  const { _m, ...resto } = i || {};
  return resto;
};

/** Grava o plano no documento lido agora (dentro de uma transação). Confirmar de novo não duplica. */
export const aplicarPlano = (raw: any, plano: Plano, agora = Date.now()) => {
  const mortos = lapides(raw);
  const todos = [...plano.criar.events, ...plano.criar.logs].map(i => i.id);
  if (todos.some(id => mortos[id] !== undefined)) {
    throw new ConsultaError('Esta prévia já foi gravada e desfeita. Prepare de novo.');
  }
  const events: Item[] = [...(raw.events || [])];
  const logs: Item[] = [...(raw.logs || [])];
  const existentes = new Set([...events, ...logs].map(i => i?.id));
  const jaGravado = todos.length > 0 && todos.every(id => existentes.has(id));

  const lote: Lote = { em: agora, resumo: [], criados: { events: [], logs: [] }, situacoesAnteriores: [] };
  for (const ev of plano.criar.events) {
    if (existentes.has(ev.id)) continue;
    events.push({ ...ev, _m: agora });
    lote.criados.events.push(ev.id);
  }
  for (const log of plano.criar.logs) {
    if (existentes.has(log.id)) continue;
    logs.push({ ...log, _m: agora });
    lote.criados.logs.push(log.id);
  }
  for (const s of plano.situacoes) {
    const idx = events.findIndex(e => e?.id === s.id);
    if (idx < 0) {
      lote.resumo.push(`Não encontrada (talvez apagada no app): ${s.descricao}`);
      continue;
    }
    const ev = events[idx];
    if (situacaoDe(ev) === s.situacao) continue;
    lote.situacoesAnteriores.push({ id: s.id, prepared: !!ev.prepared, scheduled: !!ev.scheduled, descricao: s.descricao });
    events[idx] = { ...ev, ...camposDaSituacao(s.situacao), _m: agora };
  }

  const conteudosAnteriores: NonNullable<Lote['conteudosAnteriores']> = [];
  let conteudoJaGravado = false;
  for (const c of plano.conteudos || []) {
    const idx = logs.findIndex(l => l?.id === c.id);
    if (idx < 0) {
      lote.resumo.push(`Não gravado (o registro foi apagado no app depois da prévia): ${c.descricao}`);
      continue;
    }
    const log = logs[idx];
    const atual = { subject: log.subject || '', homework: log.homework || '' };
    if (atual.subject === c.subject && atual.homework === c.homework) {
      conteudoJaGravado = true;
      continue;
    }
    if (atual.subject !== c.antes.subject || atual.homework !== c.antes.homework) {
      lote.resumo.push(`Não gravado (o registro mudou no app depois da prévia; prepare de novo): ${c.descricao}`);
      continue;
    }
    conteudosAnteriores.push({ id: c.id, ...atual, descricao: c.descricao });
    logs[idx] = { ...log, subject: c.subject, homework: c.homework, _m: agora };
  }
  if (conteudosAnteriores.length) lote.conteudosAnteriores = conteudosAnteriores;

  const calendars: Item[] = [...(raw.calendars || [])];
  const calendariosAnteriores: NonNullable<Lote['calendariosAnteriores']> = [];
  let calendarioJaGravado = false;
  for (const c of plano.calendarios || []) {
    const idx = calendars.findIndex(x => x?.id === c.id);
    const atual = idx >= 0 ? semCarimboItem(calendars[idx]) : null;
    if (atual && deepEqual(atual, c.novo)) { calendarioJaGravado = true; continue; }
    if (c.antes === null ? atual !== null : !atual || !deepEqual(atual, c.antes)) {
      lote.resumo.push(`Não gravado (o calendário mudou no app depois da prévia; prepare de novo): ${c.descricao}`);
      continue;
    }
    if (c.antes === null && mortos[c.id] !== undefined) {
      throw new ConsultaError('Esta prévia já foi gravada e desfeita. Prepare de novo.');
    }
    calendariosAnteriores.push({ id: c.id, antes: atual, descricao: c.descricao });
    if (idx >= 0) calendars[idx] = { ...c.novo, _m: agora };
    else calendars.push({ ...c.novo, _m: agora });
  }
  if (calendariosAnteriores.length) lote.calendariosAnteriores = calendariosAnteriores;

  lote.resumo.unshift(...plano.resumo);
  const mudouEventos = lote.criados.events.length + lote.situacoesAnteriores.length > 0;
  const mudouLogs = lote.criados.logs.length + conteudosAnteriores.length > 0;
  const mudouCalendarios = calendariosAnteriores.length > 0;
  const alteracoes: Alteracoes = {};
  if (mudouEventos) alteracoes.events = events;
  if (mudouLogs) alteracoes.logs = logs;
  if (mudouCalendarios) alteracoes.calendars = calendars;
  const mudou = mudouEventos || mudouLogs || mudouCalendarios;
  return { alteracoes, lote, jaGravado: !mudou && (jaGravado || plano.situacoes.length > 0 || conteudoJaGravado || calendarioJaGravado) };
};

/** Desfaz um lote: apaga o que foi criado (com lápide) e volta as situações anteriores. */
export const desfazerLote = (raw: any, lote: Lote, agora = Date.now()) => {
  const mortos = lapides(raw);
  const avisos: string[] = [];
  let events: Item[] = [...(raw.events || [])];
  let logs: Item[] = [...(raw.logs || [])];
  let mudouEventos = false;
  let mudouLogs = false;

  const remover = (lista: Item[], ids: string[], nome: string) => {
    const alvo = new Set(ids);
    return lista.filter(i => {
      if (!i || !alvo.has(i.id)) return true;
      if ((i._m ?? 0) > lote.em) {
        avisos.push(`Um ${nome} foi alterado no app depois da gravação e foi mantido.`);
        return true;
      }
      mortos[i.id] = agora;
      return false;
    });
  };
  const antesE = events.length;
  events = remover(events, lote.criados.events, 'item de avaliação');
  mudouEventos = events.length !== antesE;
  const antesL = logs.length;
  logs = remover(logs, lote.criados.logs, 'registro do diário');
  mudouLogs = logs.length !== antesL;

  for (const s of lote.situacoesAnteriores) {
    const idx = events.findIndex(e => e?.id === s.id);
    if (idx < 0) { avisos.push(`Não encontrada: ${s.descricao}`); continue; }
    if ((events[idx]._m ?? 0) > lote.em) { avisos.push(`Alterada no app depois; mantida: ${s.descricao}`); continue; }
    events[idx] = { ...events[idx], prepared: s.prepared, scheduled: s.scheduled, _m: agora };
    mudouEventos = true;
  }

  for (const c of lote.conteudosAnteriores || []) {
    const idx = logs.findIndex(l => l?.id === c.id);
    if (idx < 0) { avisos.push(`Registro não encontrado: ${c.descricao}`); continue; }
    if ((logs[idx]._m ?? 0) > lote.em) { avisos.push(`Registro alterado no app depois; mantido: ${c.descricao}`); continue; }
    logs[idx] = { ...logs[idx], subject: c.subject, homework: c.homework, _m: agora };
    mudouLogs = true;
  }

  let calendars: Item[] = [...(raw.calendars || [])];
  let mudouCalendarios = false;
  for (const c of lote.calendariosAnteriores || []) {
    const idx = calendars.findIndex(x => x?.id === c.id);
    if (idx < 0) { avisos.push(`Calendário não encontrado: ${c.descricao}`); continue; }
    if ((calendars[idx]._m ?? 0) > lote.em) { avisos.push(`Calendário alterado no app depois; mantido: ${c.descricao}`); continue; }
    if (c.antes === null) {
      mortos[c.id] = agora;
      calendars = calendars.filter((_, k) => k !== idx);
    } else {
      calendars[idx] = { ...c.antes, _m: agora };
    }
    mudouCalendarios = true;
  }

  const alteracoes: Alteracoes = {};
  if (mudouEventos) alteracoes.events = events;
  if (mudouLogs) alteracoes.logs = logs;
  if (mudouCalendarios) alteracoes.calendars = calendars;
  const desfeito = mudouEventos || mudouLogs || mudouCalendarios;
  if (desfeito) alteracoes._deleted = mortos;
  return { alteracoes, avisos, desfeito };
};
