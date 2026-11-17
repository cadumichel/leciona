import { AppData } from '../types';
import { parseTimeToMinutes } from '../utils';
import { getLessonDisplayItems } from './lessonStats';
import { getClassName } from './classRefs';

/**
 * Avisos do Leciona (fim de turno, resumo do dia e lembretes com alarme).
 *
 * A mesma regra vale no servidor (que manda a notificação para o celular, mesmo com o app
 * fechado: connector/avisosPush.ts) e no app aberto num aparelho sem notificações (aviso na tela).
 * Usa as aulas do Diário (`getLessonDisplayItems`): feriado, recesso, aula cancelada por evento e
 * aula marcada como "Não houve aula" ficam de fora.
 */

export interface Aviso {
  /** Identifica o aviso: cada chave é enviada uma vez só */
  chave: string;
  titulo: string;
  texto: string;
  /** Tela que abre ao tocar na notificação */
  destino: 'pendencias' | 'lembretes';
}

export interface Momento {
  /** Dia no fuso de Brasília, "AAAA-MM-DD" */
  hoje: string;
  /** Minutos desde a meia-noite, no fuso de Brasília */
  minutos: number;
}

export interface AvisosCalculados {
  avisos: Aviso[];
  /** Próximo momento ("AAAA-MM-DDTHH:MM") em que pode haver aviso; antes disso nada muda se os dados não mudarem */
  proximo: string;
}

/** Depois da hora marcada, o aviso ainda vale por este tempo (cobre atraso ou falha do agendador). */
export const JANELA_MINUTOS = 120;

export const RESUMO_PADRAO = '18:00';

const dois = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutos: number) => `${dois(Math.floor(minutos / 60))}:${dois(minutos % 60)}`;

/** Dia e hora de Brasília de um instante (o servidor roda em UTC). */
export const momentoEmBrasilia = (agora: Date = new Date()): Momento => {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(agora);
  const p = (tipo: string) => partes.find(x => x.type === tipo)?.value || '00';
  return { hoje: `${p('year')}-${p('month')}-${p('day')}`, minutos: Number(p('hour')) * 60 + Number(p('minute')) };
};

const diaSeguinte = (dia: string) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Minutos entre dois horários locais "AAAA-MM-DDTHH:MM" (b - a). */
const minutosEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b.slice(0, 16)}:00Z`) - Date.parse(`${a.slice(0, 16)}:00Z`)) / 60000);

const plural = (n: number) => (n === 1 ? '1 aula sem registro' : `${n} aulas sem registro`);

export const calcularAvisos = (data: AppData, momento: Momento): AvisosCalculados => {
  const { hoje, minutos } = momento;
  const agoraLocal = `${hoje}T${hhmm(minutos)}`;
  const settings = data.settings || ({} as AppData['settings']);
  const avisos: Aviso[] = [];
  // Na virada do dia tudo é recalculado
  let proximo = `${diaSeguinte(hoje)}T00:00`;
  const lembrar = (quando: string) => { if (quando > agoraLocal && quando < proximo) proximo = quando; };
  const naJanela = (gatilho: number) => minutos >= gatilho && minutos < gatilho + JANELA_MINUTOS;

  const querTurno = settings.alertAfterShift !== false;
  const querResumo = !!settings.alertDailySummary;

  if (querTurno || querResumo) {
    const aulas = getLessonDisplayItems(data, {
      start: hoje, end: hoje, schoolId: 'all', classId: 'all', showWithContent: true, showWithoutContent: true
    }).filter(a => a.date === hoje && !a.isExtra && !a.isSubstitution)
      .map(a => {
        const particular = a.schedule.shiftId === 'private';
        return {
          fim: parseTimeToMinutes(a.slot.endTime),
          semRegistro: !a.hasContent,
          grupo: particular ? 'particulares' : `${a.schedule.schoolId}|${a.schedule.shiftId || ''}`,
          local: particular ? 'Aulas particulares' : a.institution.name,
          turma: particular ? a.institution.name : getClassName(data, a.schedule.schoolId, a.schedule.classId, '')
        };
      });

    if (querTurno) {
      const atraso = Number(settings.alertAfterShiftDelay) || 0;
      const grupos = new Map<string, typeof aulas>();
      aulas.forEach(a => grupos.set(a.grupo, [...(grupos.get(a.grupo) || []), a]));
      grupos.forEach((lista, grupo) => {
        const gatilho = Math.max(...lista.map(a => a.fim)) + atraso;
        lembrar(`${hoje}T${hhmm(Math.min(gatilho, 1439))}`);
        if (!naJanela(gatilho)) return;
        const pendentes = lista.filter(a => a.semRegistro);
        if (!pendentes.length) return;
        const turmas = [...new Set(pendentes.map(a => a.turma).filter(Boolean))];
        avisos.push({
          chave: `turno|${hoje}|${grupo}`,
          titulo: `${lista[0].local}: ${plural(pendentes.length)}`,
          texto: `O turno terminou.${turmas.length ? ` Falta registrar: ${turmas.join(', ')}.` : ''} Toque para abrir as pendências.`,
          destino: 'pendencias'
        });
      });
    }

    if (querResumo) {
      const hora = /^\d{2}:\d{2}$/.test(settings.alertDailySummaryTime || '') ? settings.alertDailySummaryTime! : RESUMO_PADRAO;
      const gatilho = parseTimeToMinutes(hora);
      lembrar(`${hoje}T${hora}`);
      if (naJanela(gatilho)) {
        const pendentes = aulas.filter(a => a.semRegistro && a.fim <= minutos);
        if (pendentes.length) {
          const porLocal = new Map<string, number>();
          pendentes.forEach(a => porLocal.set(a.local, (porLocal.get(a.local) || 0) + 1));
          avisos.push({
            chave: `resumo|${hoje}`,
            titulo: `Hoje: ${plural(pendentes.length)}`,
            texto: `${[...porLocal].map(([local, n]) => `${local}: ${n}`).join(' · ')}. Toque para abrir as pendências.`,
            destino: 'pendencias'
          });
        }
      }
    }
  }

  // Lembretes com alarme (a hora é a do relógio do professor, sem fuso)
  (data.reminders || []).forEach(r => {
    if (!r.alarmTime || r.alarmTime.length < 16) return;
    const quando = r.alarmTime.slice(0, 16);
    lembrar(quando);
    const atraso = minutosEntre(quando, agoraLocal);
    if (atraso < 0 || atraso >= JANELA_MINUTOS) return;
    avisos.push({
      chave: `lembrete|${r.id}|${quando}`,
      titulo: `Lembrete: ${r.title || 'sem título'}`,
      texto: r.content || 'Toque para abrir os lembretes.',
      destino: 'lembretes'
    });
  });

  return { avisos, proximo };
};
