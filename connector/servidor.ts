import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { AppData } from '../types';
import {
  ConsultaError, avaliacoesProximas, calendario, conteudoDesdeUltimaAvaliacao, hojeEmBrasilia, listarAvaliacoes, turmasEGrade
} from './consultas';
import {
  Conta, ErroOAuth, emitirCodigo, metadadosDoRecurso, metadadosDoServidor, registrarCliente, trocarToken,
  urlsDoServidor, validarPedido, verificarAcesso
} from './oauth';

/**
 * Rotas do conector: metadados OAuth, login, token e o servidor MCP (só leitura).
 * As dependências externas (Firebase) entram por `Dependencias`, para os testes usarem dados inventados.
 */

export interface Dependencias {
  /** Chave de assinatura dos tokens */
  chave: Uint8Array;
  /** Única conta Google com acesso */
  emailPermitido: string;
  /** Confere o login feito na página de autorização (Firebase Auth) */
  verificarLogin: (idToken: string) => Promise<{ uid: string; email?: string; email_verified?: boolean }>;
  /** Lê o documento do professor no Firestore */
  carregarDados: (uid: string) => Promise<AppData>;
  agora?: () => Date;
}

const origemDe = (req: Request) => {
  const url = new URL(req.url);
  // Atrás do proxy da Vercel o protocolo/host originais vêm nos cabeçalhos
  const host = req.headers.get('x-forwarded-host') || url.host;
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  return `${proto}://${host}`;
};

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version' };

const json = (corpo: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra }
  });

const erroOAuth = (e: unknown) => {
  if (e instanceof ErroOAuth) return json({ error: e.codigo, error_description: e.message }, e.status);
  console.error(e);
  return json({ error: 'server_error', error_description: 'Erro interno.' }, 500);
};

const lerCampos = async (req: Request): Promise<Record<string, string>> => {
  const tipo = req.headers.get('content-type') || '';
  if (tipo.includes('application/json')) return (await req.json()) || {};
  return Object.fromEntries(new URLSearchParams(await req.text()));
};

// ── Página de login ───────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Configuração pública do app web (a mesma de firebase.ts)
const FIREBASE_WEB = {
  apiKey: 'AIzaSyA9aD53AHcErDH0-PK81dfk-Cyaib_An-A',
  authDomain: 'leciona-c93a9.firebaseapp.com',
  projectId: 'leciona-c93a9',
  appId: '1:24660236180:web:8d247c2f58f22ae5cd2181'
};

const pagina = (titulo: string, corpo: string, status = 200) =>
  new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border-radius:16px;padding:32px;max-width:420px;width:100%;box-shadow:0 10px 30px rgba(15,23,42,.08)}
h1{font-size:1.3rem;margin:0 0 12px}p{line-height:1.5;color:#334155}
button{width:100%;padding:14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:1rem;cursor:pointer}
button:disabled{opacity:.6}.erro{color:#b91c1c}
</style></head><body><main>${corpo}</main></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    }
  });

const paginaDeLogin = (pedido: Record<string, string>) => {
  const campos = Object.entries(pedido)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return pagina('Conectar o Claude ao Leciona', `
<h1>Conectar o Claude ao Leciona</h1>
<p>O Claude vai poder <b>ler</b> suas avaliações, o conteúdo do diário, turmas, grade e calendário.
Nomes de alunos, notas e chamada não são compartilhados.</p>
<form id="f" method="post">${campos}<input type="hidden" name="id_token" id="t">
<button type="button" id="b">Entrar com Google e autorizar</button></form>
<p class="erro" id="e"></p>
<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
const auth = getAuth(initializeApp(${JSON.stringify(FIREBASE_WEB)}));
const b = document.getElementById('b');
b.onclick = async () => {
  b.disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const r = await signInWithPopup(auth, provider);
    document.getElementById('t').value = await r.user.getIdToken();
    document.getElementById('f').submit();
  } catch (err) {
    document.getElementById('e').textContent = 'Não foi possível entrar: ' + (err && err.code || err);
    b.disabled = false;
  }
};
</script>`);
};

const paginaDeErro = (mensagem: string, status = 400) =>
  pagina('Leciona', `<h1>Não foi possível conectar</h1><p class="erro">${esc(mensagem)}</p>`, status);

// ── Servidor MCP ──────────────────────────────────────────────────────────────

const INSTRUCOES = `Dados do Leciona, app de rotina docente do prof. Cadu (professor de História em escolas de Brusque/SC).
Só leitura. Datas no formato AAAA-MM-DD, no fuso de Brasília; cada resposta informa "hoje".
Turmas e escolas podem ser escritas pelo nome (ex.: "183", "3ª Série", "Cônsul"); se o nome existir em mais de uma escola, informe a escola.
Responda ao Cadu em português simples. Não há dados de alunos (nomes, notas, chamada) neste conector.`;

const somenteLeitura = { readOnlyHint: true, openWorldHint: false };

export const criarServidorMcp = (dados: AppData, hoje: string) => {
  const servidor = new McpServer({ name: 'leciona', version: '1.0.0' }, { instructions: INSTRUCOES });

  const responder = (consulta: () => unknown) => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ hoje, resultado: consulta() }, null, 1) }] };
    } catch (e) {
      if (e instanceof ConsultaError) return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      throw e;
    }
  };

  const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');

  servidor.registerTool('listar_avaliacoes', {
    title: 'Listar avaliações',
    description: 'Provas e trabalhos cadastrados, com data, turma, aula e situação (Pendente, Agendada = alunos avisados, Pronta = elaborada, enviada e alunos avisados). Filtre por período, escola, turma ou pelas que faltam elaborar.',
    inputSchema: {
      de: data.optional().describe('Data inicial (AAAA-MM-DD)'),
      ate: data.optional().describe('Data final (AAAA-MM-DD)'),
      escola: z.string().optional().describe('Nome da escola'),
      turma: z.string().optional().describe('Nome da turma, ex.: "183"'),
      elaborada: z.boolean().optional().describe('true = só as já elaboradas; false = só as que faltam elaborar')
    },
    annotations: somenteLeitura
  }, async args => responder(() => listarAvaliacoes(dados, args)));

  servidor.registerTool('conteudo_desde_ultima_avaliacao', {
    title: 'Conteúdo desde a última avaliação',
    description: 'Conteúdo e tarefas registrados no diário de uma turma desde a última avaliação (prova ou trabalho), com a próxima avaliação e as aulas que ficaram sem registro.',
    inputSchema: {
      turma: z.string().describe('Nome da turma, ex.: "183"'),
      escola: z.string().optional().describe('Nome da escola (necessário se a turma existir em mais de uma)'),
      ate: data.optional().describe('Data de referência (padrão: hoje)')
    },
    annotations: somenteLeitura
  }, async args => responder(() => conteudoDesdeUltimaAvaliacao(dados, { ...args, hoje })));

  servidor.registerTool('avaliacoes_proximas', {
    title: 'Avaliações próximas',
    description: 'Avaliações de hoje até alguns dias à frente, cada uma com o conteúdo que vai cair (desde a avaliação anterior da turma). Útil para alertas.',
    inputSchema: {
      dias: z.number().int().min(0).max(60).optional().describe('Quantos dias à frente (padrão 7)'),
      escola: z.string().optional().describe('Nome da escola')
    },
    annotations: somenteLeitura
  }, async args => responder(() => avaliacoesProximas(dados, { ...args, hoje })));

  servidor.registerTool('turmas_e_grade', {
    title: 'Turmas e grade',
    description: 'Escolas, turmas, horários dos turnos e grade semanal em vigor na data (aulas seguidas aparecem separadas).',
    inputSchema: { data: data.optional().describe('Data de referência (padrão: hoje)') },
    annotations: somenteLeitura
  }, async args => responder(() => turmasEGrade(dados, { data: args.data || hoje })));

  servidor.registerTool('calendario', {
    title: 'Calendário',
    description: 'Feriados, bimestres/trimestres, recessos e eventos (reuniões, festas, passeios) num período de até um ano.',
    inputSchema: {
      de: data.describe('Data inicial (AAAA-MM-DD)'),
      ate: data.describe('Data final (AAAA-MM-DD)'),
      escola: z.string().optional().describe('Nome da escola')
    },
    annotations: somenteLeitura
  }, async args => responder(() => calendario(dados, args)));

  return servidor;
};

// ── Rotas ─────────────────────────────────────────────────────────────────────

export const criarRotas = (deps: Dependencias) => {
  const assinatura = (req: Request) => ({ chave: deps.chave, origem: origemDe(req), agora: deps.agora?.() });

  const naoAutorizado = (req: Request) =>
    json({ error: 'invalid_token', error_description: 'Faça login para usar o conector.' }, 401, {
      'WWW-Authenticate': `Bearer resource_metadata="${urlsDoServidor(origemDe(req)).metadadosRecurso}", scope="leciona"`
    });

  return {
    opcoes: () => new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } }),

    metadadosRecurso: (req: Request) => json(metadadosDoRecurso(origemDe(req))),
    metadadosServidor: (req: Request) => json(metadadosDoServidor(origemDe(req))),

    registrar: async (req: Request) => {
      try { return json(registrarCliente(await req.json().catch(() => null)), 201); } catch (e) { return erroOAuth(e); }
    },

    autorizarGet: (req: Request) => {
      const params = Object.fromEntries(new URL(req.url).searchParams);
      try {
        validarPedido(params, origemDe(req));
      } catch (e) {
        return paginaDeErro(e instanceof Error ? e.message : 'Pedido inválido.');
      }
      return paginaDeLogin(params);
    },

    autorizarPost: async (req: Request) => {
      const campos = await lerCampos(req);
      let pedido;
      try { pedido = validarPedido(campos, origemDe(req)); } catch (e) {
        return paginaDeErro(e instanceof Error ? e.message : 'Pedido inválido.');
      }
      let conta: Conta;
      try {
        const login = await deps.verificarLogin(campos.id_token || '');
        if (!login.email || !login.email_verified) throw new Error('sem email');
        conta = { uid: login.uid, email: login.email };
      } catch {
        return paginaDeErro('Não foi possível confirmar o login. Tente de novo.', 401);
      }
      if (conta.email.toLowerCase() !== deps.emailPermitido.trim().toLowerCase()) {
        return paginaDeErro('Esta conta Google não tem acesso a este conector.', 403);
      }
      const volta = new URL(pedido.redirect_uri);
      volta.searchParams.set('code', await emitirCodigo(assinatura(req), pedido, conta));
      if (pedido.state) volta.searchParams.set('state', pedido.state);
      volta.searchParams.set('iss', origemDe(req));
      return new Response(null, { status: 302, headers: { Location: volta.toString(), 'Cache-Control': 'no-store' } });
    },

    token: async (req: Request) => {
      try {
        return json(await trocarToken(assinatura(req), deps.emailPermitido, await lerCampos(req)));
      } catch (e) {
        return erroOAuth(e);
      }
    },

    mcp: async (req: Request) => {
      const conta = await verificarAcesso(assinatura(req), deps.emailPermitido, req.headers.get('authorization'));
      if (!conta) return naoAutorizado(req);
      if (req.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
      }
      const dados = await deps.carregarDados(conta.uid);
      const servidor = criarServidorMcp(dados, hojeEmBrasilia(deps.agora?.()));
      // Sem sessão: cada chamada é independente (funções da Vercel não guardam estado)
      const transporte = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await servidor.connect(transporte);
      const resposta = await transporte.handleRequest(req);
      const comCors = new Response(resposta.body, resposta);
      Object.entries(CORS).forEach(([k, v]) => comCors.headers.set(k, v));
      return comCors;
    }
  };
};
