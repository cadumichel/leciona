import { createECDH, createHash } from 'node:crypto';
import { AppData } from '../types';
import { Aviso, calcularAvisos, momentoEmBrasilia } from '../utils/avisos';

/**
 * Avisos no celular mesmo com o app fechado (Web Push).
 *
 * Um agendador externo (cron-job.org) chama /api/avisos a cada 5 minutos com o CRON_SECRET. O
 * servidor confere a grade e o diário (utils/avisos.ts) e manda a notificação para os aparelhos
 * em que o professor ativou os avisos (Ajustes → Avisos).
 *
 * Guardado em users/{uid}/avisos (só o servidor acessa; as regras do Firestore bloqueiam o app):
 * - `aparelhos`: os endereços de notificação de cada aparelho;
 * - `estado`: o que já foi enviado (cada aviso sai uma vez só) e quando conferir de novo.
 *
 * Para gastar pouco da cota gratuita do Firestore, o documento do professor (até 1 MB) só é lido
 * quando ele mudou ou quando chegou a hora de algum aviso.
 */

export interface Aparelho {
  /** Endereço de notificação criado pelo navegador (identifica o aparelho) */
  endpoint: string;
  keys: { p256dh: string; auth: string };
  nome: string;
  desde: string;
}

export interface EstadoDosAvisos {
  /** chave do aviso → quando foi enviado (ISO) */
  enviados: Record<string, string>;
  /** Carimbo (updatedAt) do documento na última conferência completa */
  carimbo?: string;
  /** "AAAA-MM-DDTHH:MM" (Brasília): antes disso, sem mudança nos dados, não há o que avisar */
  proximo?: string;
  /** Última vez que o agendador chamou (ISO) */
  ultimaConferencia?: string;
  /** Último envio de verdade (ISO) e o resultado */
  ultimoEnvio?: { quando: string; titulo: string; entregues: number };
}

export interface ArmazemDeAvisos {
  lerAparelhos: (uid: string) => Promise<Aparelho[]>;
  gravarAparelhos: (uid: string, lista: Aparelho[]) => Promise<void>;
  lerEstado: (uid: string) => Promise<EstadoDosAvisos>;
  gravarEstado: (uid: string, estado: EstadoDosAvisos) => Promise<void>;
  /** Carimbo de atualização do documento do professor (leitura leve, só esse campo) */
  carimboDosDados: (uid: string) => Promise<string>;
  /** Manda a notificação; 'expirado' = o aparelho cancelou os avisos (apagar da lista) */
  enviar: (aparelho: Aparelho, mensagem: MensagemPush) => Promise<'ok' | 'expirado' | 'erro'>;
  /** Chave pública que o navegador usa para criar o endereço de notificação */
  chavePublica: string;
}

export interface MensagemPush {
  titulo: string;
  texto: string;
  /** Avisos com a mesma marca se substituem na tela do celular */
  marca: string;
  destino: Aviso['destino'] | 'ajustes';
}

export const MAX_APARELHOS = 8;
const DIAS_DE_MEMORIA = 3;

const b64url = (b: Buffer) => b.toString('base64url');

/**
 * Par de chaves das notificações (VAPID), derivado da credencial do Firebase Admin: nada a mais
 * para configurar na Vercel. Trocar a credencial troca as chaves; o app refaz o cadastro sozinho.
 */
export const derivarChavesPush = (segredo: string) => {
  const privada = createHash('sha256').update(`leciona-avisos-v1:${segredo}`).digest();
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(privada);
  return { publica: b64url(ecdh.getPublicKey()), privada: b64url(privada) };
};

const nomeDoAparelho = (userAgent: string) => {
  const sistema = /Android/i.test(userAgent) ? 'Celular Android'
    : /iPhone|iPad/i.test(userAgent) ? 'iPhone/iPad'
    : /Windows/i.test(userAgent) ? 'Computador Windows'
    : /Macintosh/i.test(userAgent) ? 'Mac'
    : /Linux|CrOS/i.test(userAgent) ? 'Computador' : 'Aparelho';
  const navegador = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : '';
  return navegador ? `${sistema} (${navegador})` : sistema;
};

/** Confere o formato do endereço de notificação enviado pelo app (só https, tamanho limitado). */
export const lerInscricao = (corpo: any): Pick<Aparelho, 'endpoint' | 'keys'> | null => {
  const s = corpo?.inscricao;
  const texto = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!s || !texto(s.endpoint, 1000) || !texto(s.keys?.p256dh, 200) || !texto(s.keys?.auth, 100)) return null;
  try { if (new URL(s.endpoint).protocol !== 'https:') return null; } catch { return null; }
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
};

export const inscrever = async (a: ArmazemDeAvisos, uid: string, inscricao: Pick<Aparelho, 'endpoint' | 'keys'>, userAgent: string, agora: Date) => {
  const lista = await a.lerAparelhos(uid);
  const antigo = lista.find(x => x.endpoint === inscricao.endpoint);
  const novo: Aparelho = { ...inscricao, nome: nomeDoAparelho(userAgent), desde: antigo?.desde || agora.toISOString() };
  // Os mais recentes ficam; passa do limite, sai o mais antigo
  const resto = lista.filter(x => x.endpoint !== inscricao.endpoint);
  await a.gravarAparelhos(uid, [...resto, novo].slice(-MAX_APARELHOS));
};

export const remover = async (a: ArmazemDeAvisos, uid: string, endpoint: string) => {
  const lista = await a.lerAparelhos(uid);
  if (lista.some(x => x.endpoint === endpoint)) await a.gravarAparelhos(uid, lista.filter(x => x.endpoint !== endpoint));
};

/** Manda para todos os aparelhos e tira da lista os que cancelaram. Devolve quantos receberam. */
export const enviarParaTodos = async (a: ArmazemDeAvisos, uid: string, mensagem: MensagemPush, aparelhos?: Aparelho[]) => {
  const lista = aparelhos || await a.lerAparelhos(uid);
  const resultados = await Promise.all(lista.map(ap => a.enviar(ap, mensagem).catch(() => 'erro' as const)));
  const vivos = lista.filter((_, i) => resultados[i] !== 'expirado');
  if (vivos.length !== lista.length) await a.gravarAparelhos(uid, vivos);
  return { entregues: resultados.filter(r => r === 'ok').length, aparelhos: vivos };
};

/**
 * Uma conferência (chamada pelo agendador). `carregarDados` só é usado quando é preciso.
 * Um aviso só é marcado como enviado se chegou a pelo menos um aparelho; sem aparelho
 * cadastrado nada é marcado (ao ativar os avisos, o que ainda está na janela chega).
 */
export const conferir = async (
  a: ArmazemDeAvisos, uid: string, carregarDados: (uid: string) => Promise<AppData>, agora: Date
) => {
  const momento = momentoEmBrasilia(agora);
  const agoraLocal = `${momento.hoje}T${String(Math.floor(momento.minutos / 60)).padStart(2, '0')}:${String(momento.minutos % 60).padStart(2, '0')}`;
  const [estado, carimbo] = await Promise.all([a.lerEstado(uid), a.carimboDosDados(uid)]);
  const base: EstadoDosAvisos = { ...estado, enviados: estado.enviados || {}, ultimaConferencia: agora.toISOString() };

  if (estado.carimbo === carimbo && estado.proximo && agoraLocal < estado.proximo) {
    await a.gravarEstado(uid, base);
    return { ok: true, conferido: false, enviados: 0 };
  }

  let aparelhos = await a.lerAparelhos(uid);
  if (!aparelhos.length) {
    // Ninguém para avisar: não lê o documento grande; confere de novo quando houver aparelho
    await a.gravarEstado(uid, { ...base, carimbo: undefined, proximo: undefined });
    return { ok: true, conferido: false, enviados: 0, semAparelhos: true };
  }

  const { avisos, proximo } = calcularAvisos(await carregarDados(uid), momento);
  const enviados = { ...base.enviados };
  const limite = new Date(agora.getTime() - DIAS_DE_MEMORIA * 86400000).toISOString();
  Object.keys(enviados).forEach(k => { if (enviados[k] < limite) delete enviados[k]; });

  let quantos = 0;
  let ultimoEnvio = base.ultimoEnvio;
  let falhou = false;
  for (const aviso of avisos.filter(x => !enviados[x.chave])) {
    const r = await enviarParaTodos(a, uid, { titulo: aviso.titulo, texto: aviso.texto, marca: aviso.chave, destino: aviso.destino }, aparelhos);
    aparelhos = r.aparelhos;
    if (r.entregues > 0) {
      enviados[aviso.chave] = agora.toISOString();
      ultimoEnvio = { quando: agora.toISOString(), titulo: aviso.titulo, entregues: r.entregues };
      quantos++;
    } else {
      falhou = true;
    }
  }
  // Se algum envio falhou, não guarda o "próximo": a conferência seguinte tenta de novo
  await a.gravarEstado(uid, { ...base, enviados, ultimoEnvio, carimbo: falhou ? undefined : carimbo, proximo: falhou ? undefined : proximo });
  return { ok: true, conferido: true, enviados: quantos };
};
