import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { AppData } from '../types';
import {
  ConsultaError, avaliacoesProximas, calendario, conteudoDesdeUltimaAvaliacao, hojeEmBrasilia, listarAvaliacoes, turmasEGrade
} from './consultas';
import { Alteracoes, Lote, Plano, SITUACOES, aplicarPlano, desfazerLote, prepararAvaliacoes, prepararConteudos, prepararSituacoes } from './escrita';
import {
  Assinatura, Conta, ErroOAuth, assinarLote, assinarPlano, emitirCodigo, lerLote, lerPlano, metadadosDoRecurso, metadadosDoServidor, registrarCliente, trocarToken,
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
  /**
   * Lê o documento, calcula as alterações e grava só os campos alterados, numa transação
   * (se o app gravar no meio, a transação recomeça com os dados novos).
   */
  alterarDados: <R extends { alteracoes: Alteracoes }>(uid: string, calcular: (raw: any) => R) => Promise<R>;
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
Datas no formato AAAA-MM-DD, no fuso de Brasília; cada resposta informa "hoje".
Turmas e escolas podem ser escritas pelo nome (ex.: "183", "3ª Série", "Cônsul"); se o nome existir em mais de uma escola, informe a escola.
Responda ao Cadu em português simples. Não há dados de alunos (nomes, notas, chamada) neste conector.

Gravação (sempre em dois passos):
1. Use uma ferramenta "preparar_..." e mostre ao Cadu a prévia completa: o que será gravado, os avisos e os itens com erro.
2. Só chame "confirmar_gravacao" depois que o Cadu disser claramente que pode gravar. Nunca confirme por conta própria.
Se faltar informação (ex.: a turma tem aulas seguidas e é preciso escolher a aula), pergunte ao Cadu antes de preparar de novo.
Conteúdo de aula ("hoje na 183 dei…"): use preparar_conteudo. Se a turma tiver aulas seguidas no dia, pergunte se o conteúdo vale para todas ou só para uma. Por padrão o texto é acrescentado ao que já estiver no diário; só use modo "substituir" se o Cadu pedir.
Depois de gravar, diga que dá para desfazer e guarde o "codigo_desfazer" para usar em "desfazer_gravacao" se ele pedir.
Situação das avaliações: Pendente → Agendada (alunos avisados) → Pronta (elaborada, enviada e alunos avisados).`;

const somenteLeitura = { readOnlyHint: true, openWorldHint: false };

/** O que o servidor MCP precisa para gravar (sem isso, só as ferramentas de leitura). */
export interface Escrita {
  uid: string;
  assinatura: Assinatura;
  alterarDados: Dependencias['alterarDados'];
}

export const criarServidorMcp = (dados: AppData, hoje: string, escrita?: Escrita) => {
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

  if (escrita) registrarEscrita(servidor, dados, hoje, escrita);

  return servidor;
};

// ── Ferramentas de gravação ───────────────────────────────────────────────────

const texto = (corpo: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(corpo, null, 1) }] });
const falha = (mensagem: string) => ({ content: [{ type: 'text' as const, text: mensagem }], isError: true });

const registrarEscrita = (servidor: McpServer, dados: AppData, hoje: string, escrita: Escrita) => {
  const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
  const situacao = z.enum(SITUACOES as [string, ...string[]]);
  const gravacao = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const preparo = { readOnlyHint: true, openWorldHint: false };

  const previa = async (calcular: () => { itens: unknown[]; plano: Plano | null }) => {
    try {
      const { itens, plano } = calcular();
      return texto({
        hoje,
        previa: itens,
        ...(plano
          ? {
              vai_gravar: plano.resumo,
              codigo_confirmacao: await assinarPlano(escrita.assinatura, escrita.uid, plano),
              proximo_passo: 'Mostre a prévia ao Cadu. Só chame confirmar_gravacao com este código depois que ele confirmar. O código vale 1 hora.'
            }
          : { vai_gravar: [], proximo_passo: 'Nada a gravar. Resolva os erros com o Cadu e prepare de novo.' })
      });
    } catch (e) {
      if (e instanceof ConsultaError) return falha(e.message);
      throw e;
    }
  };

  servidor.registerTool('preparar_avaliacoes', {
    title: 'Preparar cadastro de avaliações',
    description: 'Confere e mostra a prévia do cadastro de uma ou várias provas/trabalhos (ex.: a partir de uma lista, foto ou PDF do calendário da escola). Valida se a turma tem aula no dia, feriado, recesso e repetição. NÃO grava: devolve um código para confirmar_gravacao.',
    inputSchema: {
      avaliacoes: z.array(z.object({
        turma: z.string().describe('Nome da turma, ex.: "183"'),
        escola: z.string().optional().describe('Nome da escola (necessário se a turma existir em mais de uma)'),
        data: data.describe('Data da avaliação (AAAA-MM-DD)'),
        tipo: z.enum(['prova', 'trabalho']),
        titulo: z.string().describe('Título curto, ex.: "P3" ou "Trabalho Iluminismo"'),
        descricao: z.string().optional().describe('Conteúdo ou capítulos, ex.: "Cap. 12, 13 e 14"'),
        aula: z.number().int().min(1).max(12).optional().describe('Número da aula no turno (1ª, 2ª…). Obrigatório quando a turma tem aulas seguidas no dia'),
        situacao: situacao.optional().describe('Padrão: Pendente')
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ avaliacoes }) => previa(() => prepararAvaliacoes(dados, avaliacoes as any, hoje)));

  servidor.registerTool('preparar_situacao', {
    title: 'Preparar mudança de situação',
    description: 'Mostra a prévia da mudança de situação de avaliações (Pendente, Agendada = alunos avisados, Pronta = elaborada, enviada e alunos avisados). NÃO grava: devolve um código para confirmar_gravacao.',
    inputSchema: {
      avaliacoes: z.array(z.object({
        turma: z.string(),
        escola: z.string().optional(),
        data: data.describe('Data da avaliação (AAAA-MM-DD)'),
        titulo: z.string().optional().describe('Só se a turma tiver mais de uma avaliação no dia'),
        situacao
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ avaliacoes }) => previa(() => prepararSituacoes(dados, avaliacoes as any)));

  servidor.registerTool('preparar_conteudo', {
    title: 'Preparar registro de conteúdo de aula',
    description: 'Mostra a prévia do registro do conteúdo (e da tarefa) de aulas no diário, ex.: "hoje na 183 dei Revolução Industrial". Confere se a turma tem aula no dia, feriado e recesso; se a aula já tiver registro, mostra como vai ficar. NÃO grava: devolve um código para confirmar_gravacao.',
    inputSchema: {
      registros: z.array(z.object({
        turma: z.string().describe('Nome da turma, ex.: "183"'),
        escola: z.string().optional().describe('Nome da escola (necessário se a turma existir em mais de uma)'),
        data: data.describe('Data da aula (AAAA-MM-DD); "hoje" vem nas respostas do conector'),
        aulas: z.array(z.number().int().min(1).max(12)).optional().describe('Números das aulas no turno (ex.: [3, 4]). Obrigatório quando a turma tem aulas seguidas no dia'),
        conteudo: z.string().optional().describe('O que foi dado na aula'),
        tarefa: z.string().optional().describe('Tarefa de casa, se houver'),
        modo: z.enum(['acrescentar', 'substituir']).optional().describe('Padrão: acrescentar ao que já estiver no diário')
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ registros }) => previa(() => prepararConteudos(dados, registros as any, hoje)));

  servidor.registerTool('confirmar_gravacao', {
    title: 'Confirmar gravação',
    description: 'Grava no Leciona exatamente o que a prévia mostrou. Use SÓ depois que o Cadu confirmar a prévia. Devolve um codigo_desfazer.',
    inputSchema: { codigo: z.string().describe('codigo_confirmacao recebido na prévia') },
    annotations: gravacao
  }, async ({ codigo }) => {
    const plano = await lerPlano(escrita.assinatura, escrita.uid, codigo) as Plano | null;
    if (!plano) return falha('Código de confirmação inválido ou vencido (vale 1 hora). Prepare a prévia de novo.');
    try {
      const r = await escrita.alterarDados(escrita.uid, raw => aplicarPlano(raw, plano));
      if (r.jaGravado) return texto({ gravado: false, mensagem: 'Isso já tinha sido gravado; nada foi duplicado.' });
      return texto({
        gravado: true,
        resumo: r.lote.resumo,
        codigo_desfazer: await assinarLote(escrita.assinatura, escrita.uid, r.lote),
        proximo_passo: 'Avise o Cadu que foi gravado e aparece no app em instantes. Guarde o codigo_desfazer (vale 30 dias).'
      });
    } catch (e) {
      if (e instanceof ConsultaError) return falha(e.message);
      throw e;
    }
  });

  servidor.registerTool('desfazer_gravacao', {
    title: 'Desfazer gravação',
    description: 'Desfaz uma gravação feita pelo conector: apaga o que ela criou e volta situações e conteúdos anteriores. Itens alterados no app depois da gravação são mantidos.',
    inputSchema: { codigo_desfazer: z.string() },
    annotations: { ...gravacao, destructiveHint: true }
  }, async ({ codigo_desfazer }) => {
    const lote = await lerLote(escrita.assinatura, escrita.uid, codigo_desfazer) as Lote | null;
    if (!lote) return falha('Código para desfazer inválido ou vencido (vale 30 dias).');
    const r = await escrita.alterarDados(escrita.uid, raw => desfazerLote(raw, lote));
    return texto({ desfeito: r.desfeito, o_que_era: lote.resumo, avisos: r.avisos });
  });
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
      const servidor = criarServidorMcp(dados, hojeEmBrasilia(deps.agora?.()), {
        uid: conta.uid, assinatura: assinatura(req), alterarDados: deps.alterarDados
      });
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
