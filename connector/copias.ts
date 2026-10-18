import { formatDateBR } from '../utils';
import { prepareRestore, SyncedData } from '../utils/sync';
import { somarDias } from './consultas';

/**
 * Cópias de segurança do documento do professor (users/{uid}/backups/{id}), feitas uma vez por
 * dia pela Vercel (api/backup.ts) e guardadas por 30 dias. Só o servidor acessa (as regras do
 * Firestore bloqueiam o app). Restaurar é feito pelo conector, com prévia e confirmação.
 *
 * Privacidade: daqui só saem contagens, nunca o conteúdo (há nomes de alunos no documento).
 */

export const DIAS_GUARDADOS = 30;

/** Campo com as informações da cópia, guardado junto dos dados copiados. */
export const CAMPO_COPIA = '_copia';

export interface Resumo {
  escolas: number;
  turmas: number;
  avaliacoes: number;
  eventos: number;
  registrosDoDiario: number;
  lembretes: number;
  notas: number;
}

export interface InfoDaCopia {
  id: string;
  criadaEm: string;
  tipo: 'diaria' | 'antes-de-restaurar';
  resumo: Resumo;
}

const qtd = (raw: any, campo: string) => (Array.isArray(raw?.[campo]) ? raw[campo].length : 0);

export const resumoDosDados = (raw: any): Resumo => ({
  escolas: (raw?.schools || []).filter((s: any) => s && !s.deleted).length,
  turmas: (raw?.schools || []).filter((s: any) => s && !s.deleted)
    .reduce((n: number, s: any) => n + (s.classes || []).filter((c: any) => typeof c === 'string' || !c.deleted).length, 0),
  avaliacoes: (raw?.events || []).filter((e: any) => e?.type === 'test' || e?.type === 'work').length,
  eventos: (raw?.events || []).filter((e: any) => e && e.type !== 'test' && e.type !== 'work').length,
  registrosDoDiario: qtd(raw, 'logs'),
  lembretes: qtd(raw, 'reminders'),
  notas: qtd(raw, 'grades')
});

/** Id da cópia diária: a data em Brasília ("2026-10-18"). */
export const idDaCopiaDiaria = (hoje: string) => hoje;

/** Id da cópia feita antes de restaurar (permite desfazer a restauração). */
export const idAntesDeRestaurar = (agora: Date) => `antes-de-restaurar-${agora.toISOString().replace(/[:.]/g, '-')}`;

/** Dados prontos para gravar como cópia (sem a marca de atualização do documento). */
export const dadosDaCopia = (raw: any, info: Omit<InfoDaCopia, 'id' | 'resumo'>) => {
  const { updatedAt, [CAMPO_COPIA]: _antiga, ...dados } = raw || {};
  return { ...dados, [CAMPO_COPIA]: { ...info, resumo: resumoDosDados(dados) } };
};

/** Dados de uma cópia, sem o campo de informações. */
export const dadosSemInfo = (copia: any) => {
  const { [CAMPO_COPIA]: _info, updatedAt, ...dados } = copia || {};
  return dados;
};

/** Cópias com mais de 30 dias (pela data de criação), para apagar. */
export const copiasVencidas = (copias: Pick<InfoDaCopia, 'id' | 'criadaEm'>[], hoje: string) => {
  const limite = somarDias(hoje, -DIAS_GUARDADOS);
  return copias.filter(c => c.criadaEm.slice(0, 10) < limite).map(c => c.id);
};

const descreverCopia = (c: InfoDaCopia) =>
  c.tipo === 'diaria'
    ? `cópia automática de ${formatDateBR(c.criadaEm.slice(0, 10))}`
    : `cópia feita antes da restauração de ${formatDateBR(c.criadaEm.slice(0, 10))} às ${c.criadaEm.slice(11, 16)} (UTC)`;

/** Prévia da restauração: o que muda em números. */
export const previaDaRestauracao = (atual: any, copia: InfoDaCopia) => {
  const agora = resumoDosDados(atual);
  const depois = copia.resumo;
  const nomes: Record<keyof Resumo, string> = {
    escolas: 'escolas', turmas: 'turmas', avaliacoes: 'avaliações', eventos: 'eventos',
    registrosDoDiario: 'registros do diário', lembretes: 'lembretes', notas: 'notas lançadas'
  };
  const diferencas = (Object.keys(nomes) as (keyof Resumo)[])
    .filter(k => agora[k] !== depois[k])
    .map(k => `${nomes[k]}: ${agora[k]} agora → ${depois[k]} depois de restaurar`);
  return {
    descricao: `Restaurar a ${descreverCopia(copia)}`,
    avisos: [
      'Tudo o que foi feito no app depois dessa cópia será perdido em todos os aparelhos.',
      'Antes de restaurar, o conector guarda uma cópia do estado atual: dá para desfazer.'
    ],
    diferencas: diferencas.length ? diferencas : ['As quantidades são iguais; podem mudar textos e datas.']
  };
};

/**
 * Documento restaurado: a cópia passa a valer como "editada agora" e o que não está nela ganha
 * lápide, para os outros aparelhos não trazerem de volta (mesma regra do backup do app).
 */
export const documentoRestaurado = (atual: any, copia: any, agora = Date.now()) => {
  const restaurado = prepareRestore(dadosSemInfo(atual) as SyncedData, dadosSemInfo(copia) as SyncedData, agora) as any;
  // Mantém as marcas de "excluir tudo" e "virada do ano" já aplicadas nos aparelhos
  for (const marca of ['_wipedAt', '_yearResetAt', '_schoolYear']) {
    if (atual?.[marca] !== undefined) restaurado[marca] = atual[marca];
  }
  return restaurado;
};

export const listarParaOClaude = (copias: InfoDaCopia[]) =>
  [...copias]
    .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm))
    .map(c => ({ id: c.id, descricao: descreverCopia(c), resumo: c.resumo }));
