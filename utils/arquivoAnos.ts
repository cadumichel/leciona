import { auth } from '../services/firebaseConnection';
import { AppData } from '../types';

/**
 * Anos anteriores (rota /api/arquivo, connector/arquivo.ts): na virada do ano letivo o app guarda
 * o ano que terminou na nuvem do Leciona, sem prazo, e depois só consulta (Ajustes → Anos anteriores).
 */

export interface AnoGuardado {
  ano: number;
  guardadoEm: string;
  resumo: { escolas: number; turmas: number; avaliacoes: number; eventos: number; registrosDoDiario: number; lembretes: number; notas: number };
}

export class ErroDoArquivo extends Error {
  constructor(message: string, public codigo: string, public existente?: AnoGuardado) { super(message); }
}

const chamar = async (corpo: Record<string, unknown>) => {
  const usuario = auth.currentUser;
  if (!usuario) throw new ErroDoArquivo('Conecte sua conta Google (Ajustes → Conta) para usar a nuvem do Leciona.', 'sem_login');
  let resposta: Response;
  try {
    resposta = await fetch('/api/arquivo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await usuario.getIdToken()}` },
      body: JSON.stringify(corpo)
    });
  } catch {
    throw new ErroDoArquivo('Sem conexão com a internet. Tente de novo quando estiver conectado.', 'sem_internet');
  }
  const json = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    if (json?.error === 'exists') throw new ErroDoArquivo('Este ano já está guardado.', 'existe', json.existente);
    throw new ErroDoArquivo(json?.error_description || 'A nuvem do Leciona não respondeu. Tente de novo em instantes.', json?.error || 'erro');
  }
  return json;
};

export const listarAnos = async (): Promise<AnoGuardado[]> => (await chamar({ acao: 'listar' })).anos || [];

/** Guarda o ano na nuvem. Se já existir e `substituir` for falso, falha com o código "existe". */
export const guardarAno = async (ano: number, dados: AppData, substituir = false): Promise<AnoGuardado> =>
  (await chamar({ acao: 'guardar', ano, dados, substituir })).guardado;

export const lerAno = async (ano: number): Promise<AppData> => {
  const { dados } = await chamar({ acao: 'ler', ano });
  // Campos que faltarem viram listas vazias, para as telas de consulta não quebrarem
  return {
    schools: [], students: [], classRecords: [], schedules: [], scheduleVersions: [], logs: [], events: [],
    calendars: [], reminders: [], grades: [], customAssessments: [], gradingConfigs: [], ...dados
  } as AppData;
};

/** Baixa um arquivo .json com os dados (cópia extra, restaurável em Ajustes → Restaurar dados). */
export const baixarCopiaDoAno = (dados: AppData, ano: number) => {
  const { _arquivo, ...semInfo } = dados as any;
  const backup = { metadata: { version: '1.0', timestamp: new Date().toISOString(), app: 'LecionaApp', schoolYear: ano }, data: semInfo };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `leciona_arquivo_${ano}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
