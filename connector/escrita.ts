import { AppData, School, SchoolClass, SchoolEvent } from '../types';
import { formatDateBR, getHolidayName, getSafeDate } from '../utils';
import { getSchedulesForDate } from '../utils/schedule';
import { isLessonBlocked } from '../utils/lessonStats';
import { lessonNumberInShift } from '../utils/dashboardWeb';
import { removeUndefined } from '../utils/sync';
import {
  ConsultaError, DIAS_SEMANA, avaliacoesDe, calendarioNaData, dia, diaDaSemana, eDaTurma, encontrarTurma, normalizar,
  validarData
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
}

/** O que foi gravado, para desfazer. */
export interface Lote {
  em: number;
  resumo: string[];
  criados: { events: string[]; logs: string[] };
  situacoesAnteriores: { id: string; prepared: boolean; scheduled: boolean; descricao: string }[];
  conteudosAnteriores?: { id: string; subject: string; homework: string; descricao: string }[];
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

// ── Aplicar e desfazer ────────────────────────────────────────────────────────

/** Campos do documento que a gravação altera (o resto do documento não é tocado). */
export type Alteracoes = Partial<Record<'events' | 'logs' | '_deleted', unknown>>;

const lapides = (raw: any): Record<string, number> => ({ ...(raw._deleted || {}) });

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

  lote.resumo.unshift(...plano.resumo);
  const mudouEventos = lote.criados.events.length + lote.situacoesAnteriores.length > 0;
  const mudouLogs = lote.criados.logs.length + conteudosAnteriores.length > 0;
  const alteracoes: Alteracoes = {};
  if (mudouEventos) alteracoes.events = events;
  if (mudouLogs) alteracoes.logs = logs;
  const mudou = mudouEventos || mudouLogs;
  return { alteracoes, lote, jaGravado: !mudou && (jaGravado || plano.situacoes.length > 0 || conteudoJaGravado) };
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

  const alteracoes: Alteracoes = {};
  if (mudouEventos) alteracoes.events = events;
  if (mudouLogs) alteracoes.logs = logs;
  if (mudouEventos || mudouLogs) alteracoes._deleted = mortos;
  return { alteracoes, avisos, desfeito: mudouEventos || mudouLogs };
};
