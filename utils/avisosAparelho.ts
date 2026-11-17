import { auth } from '../services/firebaseConnection';

/**
 * Avisos neste aparelho: liga e desliga as notificações enviadas pelo servidor
 * (connector/avisosPush.ts, rota /api/avisos). Cada aparelho ativa os seus em Ajustes → Avisos.
 */

export interface SituacaoDosAvisos {
  /** O navegador deste aparelho consegue receber notificações com o app fechado? */
  suportado: boolean;
  permissao: NotificationPermission | 'indisponivel';
  /** Este aparelho está cadastrado no servidor */
  ativo: boolean;
  /** CRON_SECRET configurado na Vercel (sem ele o servidor não confere nada) */
  agendadorConfigurado?: boolean;
  aparelhos?: { nome: string; desde: string; este: boolean }[];
  ultimaConferencia?: string | null;
  ultimoEnvio?: { quando: string; titulo: string; entregues: number } | null;
  /** Mensagem de erro para mostrar (sem internet, conta desconectada…) */
  erro?: string;
}

/** Guarda neste aparelho se os avisos estão ativos (o app aberto usa para não avisar em dobro). */
const CHAVE_ATIVO = 'leciona-avisos-ativos';

export const suportaAvisos = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const avisosAtivosNesteAparelho = () => {
  try {
    return suportaAvisos() && Notification.permission === 'granted' && localStorage.getItem(CHAVE_ATIVO) === '1';
  } catch { return false; }
};

const marcarAtivo = (ativo: boolean) => {
  try { ativo ? localStorage.setItem(CHAVE_ATIVO, '1') : localStorage.removeItem(CHAVE_ATIVO); } catch { /* ignora */ }
};

const paraBytes = (base64url: string) => {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
};

const paraBase64Url = (bytes: ArrayBuffer | null) =>
  bytes ? btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';

const registro = async () => {
  const pronto = navigator.serviceWorker.ready;
  const espera = new Promise<never>((_, falha) => setTimeout(() => falha(new Error('O app ainda não terminou de instalar neste aparelho. Feche, abra de novo e tente outra vez.')), 8000));
  return Promise.race([pronto, espera]);
};

const chamar = async (corpo: Record<string, unknown>) => {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Conecte sua conta Google para usar os avisos.');
  const resposta = await fetch('/api/avisos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await usuario.getIdToken()}` },
    body: JSON.stringify(corpo)
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(json.error_description || 'O servidor dos avisos não respondeu. Tente de novo em instantes.');
  return json;
};

const mensagem = (e: unknown) =>
  navigator.onLine === false ? 'Sem internet. Tente de novo quando a conexão voltar.'
    : e instanceof Error && e.message ? e.message : 'Não foi possível falar com o servidor dos avisos.';

const base = (): SituacaoDosAvisos => ({
  suportado: suportaAvisos(),
  permissao: typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'indisponivel',
  ativo: false
});

/** Situação dos avisos neste aparelho e no servidor. */
export const situacaoDosAvisos = async (): Promise<SituacaoDosAvisos> => {
  const s = base();
  if (!s.suportado) return s;
  try {
    const inscricao = await (await registro()).pushManager.getSubscription();
    const r = await chamar({ acao: 'situacao', inscricao: inscricao?.toJSON() });
    const ativo = !!inscricao && r.esteAparelho && s.permissao === 'granted';
    marcarAtivo(ativo);
    return { ...s, ...r, ativo };
  } catch (e) {
    return { ...s, ativo: avisosAtivosNesteAparelho(), erro: mensagem(e) };
  }
};

/** Ativa os avisos neste aparelho (pede a permissão de notificações; precisa ser num toque do usuário). */
export const ativarAvisos = async (): Promise<SituacaoDosAvisos> => {
  const s = base();
  if (!s.suportado) return s;
  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') return { ...s, permissao };
    const reg = await registro();
    const { chavePublica } = await (await fetch('/api/avisos')).json();
    if (!chavePublica) throw new Error('O servidor dos avisos ainda não está disponível.');
    let inscricao = await reg.pushManager.getSubscription();
    // Cadastro antigo feito com outra chave do servidor (a credencial mudou): refaz
    if (inscricao && paraBase64Url(inscricao.options.applicationServerKey) !== chavePublica) {
      await inscricao.unsubscribe();
      inscricao = null;
    }
    inscricao ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: paraBytes(chavePublica) });
    const r = await chamar({ acao: 'inscrever', inscricao: inscricao.toJSON() });
    marcarAtivo(true);
    return { ...s, permissao, ...r, ativo: true };
  } catch (e) {
    return { ...s, permissao: Notification.permission, erro: mensagem(e) };
  }
};

export const desativarAvisos = async (): Promise<SituacaoDosAvisos> => {
  const s = base();
  if (!s.suportado) return s;
  try {
    const inscricao = await (await registro()).pushManager.getSubscription();
    marcarAtivo(false);
    if (!inscricao) return await situacaoDosAvisos();
    const dados = inscricao.toJSON();
    await inscricao.unsubscribe();
    const r = await chamar({ acao: 'remover', inscricao: dados });
    return { ...s, ...r, ativo: false };
  } catch (e) {
    return { ...s, erro: mensagem(e) };
  }
};

/** Pede ao servidor um aviso de teste para todos os aparelhos. Devolve quantos receberam. */
export const testarAvisos = async (): Promise<{ entregues: number; erro?: string }> => {
  try {
    const inscricao = await (await registro()).pushManager.getSubscription();
    const r = await chamar({ acao: 'teste', inscricao: inscricao?.toJSON() });
    return { entregues: r.entregues || 0 };
  } catch (e) {
    return { entregues: 0, erro: mensagem(e) };
  }
};

/**
 * Ao abrir o app: se este aparelho tem os avisos ativos, confirma o cadastro no servidor (uma vez
 * por dia). Cobre a troca do endereço de notificação pelo navegador e a troca da chave do servidor.
 */
export const manterAvisos = async () => {
  const CHAVE_DIA = 'leciona-avisos-conferido';
  try {
    if (!avisosAtivosNesteAparelho() || !auth.currentUser) return;
    const hoje = new Date().toLocaleDateString('en-CA');
    if (localStorage.getItem(CHAVE_DIA) === hoje) return;
    const r = await ativarAvisos();
    if (!r.erro) localStorage.setItem(CHAVE_DIA, hoje);
  } catch { /* tenta de novo na próxima abertura */ }
};

// ── Avisos já mostrados na tela (app aberto num aparelho sem notificações) ──────────────────────
const CHAVE_VISTOS = 'leciona-avisos-vistos';

export const avisosNaoVistos = <T extends { chave: string }>(avisos: T[]): T[] => {
  try {
    const vistos = JSON.parse(localStorage.getItem(CHAVE_VISTOS) || '{}') as Record<string, number>;
    return avisos.filter(a => !vistos[a.chave]);
  } catch { return avisos; }
};

export const marcarAvisosVistos = (chaves: string[]) => {
  try {
    const vistos = JSON.parse(localStorage.getItem(CHAVE_VISTOS) || '{}') as Record<string, number>;
    const limite = Date.now() - 3 * 86400000;
    Object.keys(vistos).forEach(k => { if (vistos[k] < limite) delete vistos[k]; });
    chaves.forEach(k => { vistos[k] = Date.now(); });
    localStorage.setItem(CHAVE_VISTOS, JSON.stringify(vistos));
  } catch { /* ignora */ }
};
