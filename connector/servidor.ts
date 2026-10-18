import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { AppData } from '../types';
import {
  ConsultaError, aulasRestantes, avaliacoesProximas, calendario, conteudoDesdeUltimaAvaliacao, hojeEmBrasilia, listarAvaliacoes, turmasEGrade
} from './consultas';
import {
  CAMPO_COPIA, InfoDaCopia, copiasVencidas, dadosDaCopia, documentoRestaurado, idAntesDeRestaurar, idDaCopiaDiaria,
  listarParaOClaude, previaDaRestauracao
} from './copias';
import { Alteracoes, Lote, Plano, SITUACOES, aplicarPlano, desfazerLote, prepararAlteracoes, prepararAvaliacoes, prepararCalendarios, prepararConteudos, prepararEventos, prepararRecessos, prepararSituacoes } from './escrita';
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
  /** Troca o documento inteiro (restauração), numa transação */
  substituirDados: (uid: string, calcular: (raw: any) => any) => Promise<void>;
  /** Cópias de segurança em users/{uid}/backups */
  copias: {
    listar: (uid: string) => Promise<InfoDaCopia[]>;
    ler: (uid: string, id: string) => Promise<any | null>;
    gravar: (uid: string, id: string, dados: any) => Promise<void>;
    apagar: (uid: string, ids: string[]) => Promise<void>;
  };
  /** uid da conta em LECIONA_EMAIL (para a cópia diária, que roda sem login) */
  uidDoProfessor: () => Promise<string>;
  /** CRON_SECRET da Vercel: se existir, a cópia diária só roda com ele */
  segredoDoCron?: string;
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
Calendário: ano letivo, bimestres/trimestres e recesso de meio de ano com preparar_calendario. Feriados nacionais já estão no app; feriado municipal, da escola ou dia sem aula entram como recesso (preparar_recessos; sem escola = todas as escolas). Reuniões, festas, passeios etc. com preparar_eventos; pergunte se o evento suspende as aulas quando não estiver claro.
Recuperação e 2ª chamada: cada escola tem a sua regra. Na escola com REC paralela, cadastrar uma prova já cria a REC junto (data sugerida pelo app); se a data não servir, pergunte ao Cadu a data (data_rec) ou se não quer REC (criar_rec: false). REC avulsa, REC trimestral e 2ª chamada: preparar_avaliacoes com "especie"; REC e 2ª chamada precisam da avaliação original (original_data).
Remarcar, corrigir ou apagar avaliações: preparar_alteracao_avaliacoes. Ao apagar, a REC e a 2ª chamada ligadas saem junto; avaliação com notas lançadas só se apaga pelo app.
Depois de gravar, diga que dá para desfazer e guarde o "codigo_desfazer" para usar em "desfazer_gravacao" se ele pedir.
Cópias de segurança: o Leciona faz uma cópia automática por dia (guardada por 30 dias). listar_copias mostra as cópias; preparar_restauracao só se o Cadu pedir para voltar os dados a uma data. Restaurar apaga o que foi feito depois da cópia: deixe isso claro na prévia.
Situação das avaliações: Pendente (vai acontecer, alunos ainda não avisados) → Agendada (comunicada aos alunos) → Pronta (enviada para a coordenação e impressão; os alunos já sabem). "Falta elaborar" = ainda não está Pronta.`;

const somenteLeitura = { readOnlyHint: true, openWorldHint: false };

/** O que o servidor MCP precisa para gravar (sem isso, só as ferramentas de leitura). */
export interface Escrita {
  uid: string;
  assinatura: Assinatura;
  alterarDados: Dependencias['alterarDados'];
  substituirDados: Dependencias['substituirDados'];
  carregarDados: Dependencias['carregarDados'];
  copias: Dependencias['copias'];
  agora: () => Date;
}

/** Restaura uma cópia, guardando antes o estado atual (para desfazer). */
const restaurarCopia = async (escrita: Escrita, copiaId: string, descricao: string): Promise<Lote> => {
  const copia = await escrita.copias.ler(escrita.uid, copiaId);
  if (!copia) throw new ConsultaError('Essa cópia não existe mais (as cópias são guardadas por 30 dias).');
  const agora = escrita.agora();
  const atual = await escrita.carregarDados(escrita.uid);
  const antesId = idAntesDeRestaurar(agora);
  await escrita.copias.gravar(escrita.uid, antesId, dadosDaCopia(atual, { criadaEm: agora.toISOString(), tipo: 'antes-de-restaurar' }));
  await escrita.substituirDados(escrita.uid, raw => documentoRestaurado(raw, copia, agora.getTime()));
  return {
    em: agora.getTime(), resumo: [descricao], criados: { events: [], logs: [] }, situacoesAnteriores: [],
    restauracao: { desfazerCom: antesId }
  };
};

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
    description: 'Provas e trabalhos cadastrados, com data, turma, aula e situação (Pendente = vai acontecer, alunos ainda não avisados; Agendada = comunicada aos alunos; Pronta = enviada para a coordenação e impressão). Filtre por período, escola, turma ou pelas que faltam elaborar.',
    inputSchema: {
      de: data.optional().describe('Data inicial (AAAA-MM-DD)'),
      ate: data.optional().describe('Data final (AAAA-MM-DD)'),
      escola: z.string().optional().describe('Nome da escola'),
      turma: z.string().optional().describe('Nome da turma, ex.: "183"'),
      elaborada: z.boolean().optional().describe('true = só as Prontas (enviadas para a coordenação e impressão); false = só as que ainda não estão prontas')
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

  servidor.registerTool('aulas_restantes', {
    title: 'Aulas que faltam',
    description: 'Quantas aulas ainda faltam com uma turma (de hoje até o fim do bimestre/trimestre atual, ou até uma data), sem feriados, recessos e eventos que suspendem aula, com as datas e a próxima avaliação. Útil para planejar o ritmo do conteúdo.',
    inputSchema: {
      turma: z.string().describe('Nome da turma, ex.: "183"'),
      escola: z.string().optional().describe('Nome da escola (necessário se a turma existir em mais de uma)'),
      ate: data.optional().describe('Data final (padrão: fim do período atual)')
    },
    annotations: somenteLeitura
  }, async args => responder(() => aulasRestantes(dados, { ...args, hoje })));

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
    description: 'Confere e mostra a prévia do cadastro de uma ou várias provas/trabalhos (ex.: a partir de uma lista, foto ou PDF do calendário da escola), inclusive REC e 2ª chamada. Valida se a turma tem aula no dia, feriado, recesso e repetição. Na escola com REC paralela, a prova ganha a REC junto. NÃO grava: devolve um código para confirmar_gravacao.',
    inputSchema: {
      avaliacoes: z.array(z.object({
        turma: z.string().describe('Nome da turma, ex.: "183"'),
        escola: z.string().optional().describe('Nome da escola (necessário se a turma existir em mais de uma)'),
        data: data.describe('Data da avaliação (AAAA-MM-DD)'),
        tipo: z.enum(['prova', 'trabalho']).optional().describe('Obrigatório na avaliação regular (REC e 2ª chamada seguem a original)'),
        titulo: z.string().optional().describe('Título curto, ex.: "P3" ou "Trabalho Iluminismo". REC e 2ª chamada têm título padrão'),
        descricao: z.string().optional().describe('Conteúdo ou capítulos, ex.: "Cap. 12, 13 e 14"'),
        aula: z.number().int().min(1).max(12).optional().describe('Número da aula no turno (1ª, 2ª…). Obrigatório quando a turma tem aulas seguidas no dia'),
        situacao: situacao.optional().describe('Padrão: Pendente'),
        especie: z.enum(['regular', 'rec', 'rec_trimestral', 'segunda_chamada']).optional()
          .describe('Padrão: regular. rec = recuperação de uma prova; rec_trimestral = recuperação do trimestre (o conteúdo vem das provas do trimestre); segunda_chamada = para quem faltou'),
        original_data: data.optional().describe('REC e 2ª chamada: data da avaliação original'),
        original_titulo: z.string().optional().describe('REC e 2ª chamada: título da original, se a turma tiver mais de uma avaliação nesse dia'),
        criar_rec: z.boolean().optional().describe('Escola com REC paralela: false para cadastrar a prova sem a REC'),
        data_rec: data.optional().describe('Escola com REC paralela: data da REC, se não for a sugerida'),
        aula_rec: z.number().int().min(1).max(12).optional().describe('Escola com REC paralela: aula da REC, se a turma tiver aulas seguidas nesse dia')
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ avaliacoes }) => previa(() => prepararAvaliacoes(dados, avaliacoes as any, hoje)));

  servidor.registerTool('preparar_alteracao_avaliacoes', {
    title: 'Preparar remarcação, correção ou exclusão de avaliações',
    description: 'Mostra a prévia de remarcar (nova data ou aula), corrigir (título, conteúdo, tipo) ou apagar avaliações. O registro "Avaliação: X" do diário acompanha a avaliação; registros editados pelo Cadu nunca são apagados. Apagar leva junto a REC e a 2ª chamada ligadas; avaliação com notas lançadas não pode ser apagada pelo conector. NÃO grava: devolve um código para confirmar_gravacao.',
    inputSchema: {
      avaliacoes: z.array(z.object({
        turma: z.string(),
        escola: z.string().optional(),
        data: data.describe('Data atual da avaliação (AAAA-MM-DD)'),
        titulo: z.string().optional().describe('Só se a turma tiver mais de uma avaliação no dia'),
        acao: z.enum(['alterar', 'apagar']),
        nova_data: data.optional(),
        nova_aula: z.number().int().min(1).max(12).optional().describe('Número da aula no turno, se a turma tiver aulas seguidas na nova data'),
        novo_titulo: z.string().optional(),
        nova_descricao: z.string().optional().describe('Novo conteúdo (substitui o atual)'),
        novo_tipo: z.enum(['prova', 'trabalho']).optional()
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ avaliacoes }) => previa(() => prepararAlteracoes(dados, avaliacoes as any, hoje)));

  servidor.registerTool('preparar_situacao', {
    title: 'Preparar mudança de situação',
    description: 'Mostra a prévia da mudança de situação de avaliações (Pendente = vai acontecer, alunos ainda não avisados; Agendada = comunicada aos alunos; Pronta = enviada para a coordenação e impressão). NÃO grava: devolve um código para confirmar_gravacao.',
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

  servidor.registerTool('preparar_calendario', {
    title: 'Preparar calendário da escola',
    description: 'Prévia da criação ou mudança do calendário de uma escola: início e fim do ano letivo, divisão (bimestres/trimestres), datas de cada período e recesso de meio de ano. Só os campos informados mudam. NÃO grava: devolve um código para confirmar_gravacao.',
    inputSchema: {
      calendarios: z.array(z.object({
        escola: z.string(),
        divisao: z.enum(['bimestres', 'trimestres', 'personalizado']).optional(),
        inicio: data.optional().describe('Início do ano letivo'),
        fim: data.optional().describe('Fim do ano letivo'),
        periodos: z.array(z.object({
          nome: z.string().optional().describe('Padrão: "1º Trimestre", "2º Bimestre"…'),
          inicio: data,
          fim: data
        })).max(8).optional().describe('Todos os períodos, em ordem (substitui a lista atual)'),
        recesso_meio_ano: z.object({ inicio: data, fim: data }).nullable().optional().describe('null remove o recesso de meio de ano')
      })).min(1).max(10)
    },
    annotations: preparo
  }, async ({ calendarios }) => previa(() => prepararCalendarios(dados, calendarios as any)));

  servidor.registerTool('preparar_recessos', {
    title: 'Preparar recessos e feriados da escola',
    description: 'Prévia do cadastro de dias sem aula no calendário das escolas: feriado municipal, feriado ou recesso da escola, ponto facultativo. Sem escola, vale para todas. Feriados nacionais já estão no app. NÃO grava: devolve um código para confirmar_gravacao.',
    inputSchema: {
      recessos: z.array(z.object({
        escola: z.string().optional().describe('Omitir = todas as escolas'),
        data,
        nome: z.string().describe('Ex.: "Aniversário de Brusque"')
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ recessos }) => previa(() => prepararRecessos(dados, recessos as any)));

  servidor.registerTool('preparar_eventos', {
    title: 'Preparar eventos',
    description: 'Prévia do cadastro de eventos na agenda (reunião, festividade, passeio, material, outro). Se o evento suspende as aulas (da escola toda, de um turno ou de uma turma), marca as aulas do dia no diário como "Evento: X", como o app. NÃO grava: devolve um código para confirmar_gravacao.',
    inputSchema: {
      eventos: z.array(z.object({
        escola: z.string(),
        data,
        tipo: z.enum(['reuniao', 'festividade', 'passeio', 'material', 'outro']),
        titulo: z.string(),
        descricao: z.string().optional(),
        suspende_aulas: z.boolean().optional().describe('Padrão: false'),
        turno: z.string().optional().describe('Ex.: "Vespertino" — só esse turno'),
        turma: z.string().optional().describe('Só essa turma')
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ eventos }) => previa(() => prepararEventos(dados, eventos as any, hoje)));

  servidor.registerTool('listar_copias', {
    title: 'Listar cópias de segurança',
    description: 'Cópias de segurança do Leciona (uma automática por dia, guardadas por 30 dias), com as quantidades de cada uma. Só leitura.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async () => texto({ hoje, copias: listarParaOClaude(await escrita.copias.listar(escrita.uid)) }));

  servidor.registerTool('preparar_restauracao', {
    title: 'Preparar restauração de cópia',
    description: 'Prévia de voltar os dados do Leciona a uma cópia de segurança (por data ou id da cópia). Mostra o que muda em números. Use só se o Cadu pedir. NÃO grava: devolve um código para confirmar_gravacao.',
    inputSchema: { copia: z.string().describe('Data (AAAA-MM-DD) da cópia automática ou o id de listar_copias') },
    annotations: preparo
  }, async ({ copia }) => {
    const copias = await escrita.copias.listar(escrita.uid);
    const info = copias.find(c => c.id === copia) || copias.find(c => c.tipo === 'diaria' && c.criadaEm.slice(0, 10) === copia);
    if (!info) return falha(`Não há cópia "${copia}". Use listar_copias para ver as disponíveis.`);
    const atual = await escrita.carregarDados(escrita.uid);
    const p = previaDaRestauracao(atual, info);
    const plano: Plano = { resumo: [p.descricao], criar: { events: [], logs: [] }, situacoes: [], restaurar: { copia: info.id, descricao: p.descricao } };
    return texto({
      hoje,
      previa: [{ pedido: 1, ok: true, descricao: p.descricao, avisos: [...p.avisos, ...p.diferencas] }],
      vai_gravar: plano.resumo,
      codigo_confirmacao: await assinarPlano(escrita.assinatura, escrita.uid, plano),
      proximo_passo: 'Mostre a prévia ao Cadu, deixando claro que o que foi feito depois da cópia será perdido. Só confirme se ele concordar. O código vale 1 hora.'
    });
  });

  servidor.registerTool('confirmar_gravacao', {
    title: 'Confirmar gravação',
    description: 'Grava no Leciona exatamente o que a prévia mostrou. Use SÓ depois que o Cadu confirmar a prévia. Devolve um codigo_desfazer.',
    inputSchema: { codigo: z.string().describe('codigo_confirmacao recebido na prévia') },
    annotations: gravacao
  }, async ({ codigo }) => {
    const plano = await lerPlano(escrita.assinatura, escrita.uid, codigo) as Plano | null;
    if (!plano) return falha('Código de confirmação inválido ou vencido (vale 1 hora). Prepare a prévia de novo.');
    if (plano.restaurar) {
      try {
        const lote = await restaurarCopia(escrita, plano.restaurar.copia, plano.restaurar.descricao);
        return texto({
          gravado: true,
          resumo: lote.resumo,
          codigo_desfazer: await assinarLote(escrita.assinatura, escrita.uid, lote),
          proximo_passo: 'Avise o Cadu que os dados foram restaurados e aparecem nos aparelhos em instantes. Dá para desfazer com o codigo_desfazer.'
        });
      } catch (e) {
        if (e instanceof ConsultaError) return falha(e.message);
        throw e;
      }
    }
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
    description: 'Desfaz uma gravação feita pelo conector: apaga o que ela criou e volta situações, conteúdos, calendários e avaliações remarcadas, corrigidas ou apagadas. Itens alterados no app depois da gravação são mantidos.',
    inputSchema: { codigo_desfazer: z.string() },
    annotations: { ...gravacao, destructiveHint: true }
  }, async ({ codigo_desfazer }) => {
    const lote = await lerLote(escrita.assinatura, escrita.uid, codigo_desfazer) as Lote | null;
    if (!lote) return falha('Código para desfazer inválido ou vencido (vale 30 dias).');
    if (lote.restauracao) {
      try {
        await restaurarCopia(escrita, lote.restauracao.desfazerCom, 'Desfazer a restauração');
        return texto({ desfeito: true, o_que_era: lote.resumo, avisos: ['Os dados voltaram ao estado de antes da restauração.'] });
      } catch (e) {
        if (e instanceof ConsultaError) return falha(e.message);
        throw e;
      }
    }
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

    /** Cópia diária (Vercel Cron). Só faz uma por dia; apaga as com mais de 30 dias. */
    copiaDiaria: async (req: Request) => {
      if (deps.segredoDoCron && req.headers.get('authorization') !== `Bearer ${deps.segredoDoCron}`) {
        return json({ error: 'unauthorized' }, 401);
      }
      const agora = deps.agora?.() ?? new Date();
      const hoje = hojeEmBrasilia(agora);
      const uid = await deps.uidDoProfessor();
      const id = idDaCopiaDiaria(hoje);
      const copias = await deps.copias.listar(uid);
      let feita = false;
      if (!copias.some(c => c.id === id)) {
        const dados = await deps.carregarDados(uid);
        await deps.copias.gravar(uid, id, dadosDaCopia(dados, { criadaEm: agora.toISOString(), tipo: 'diaria' }));
        feita = true;
      }
      const vencidas = copiasVencidas(copias, hoje);
      if (vencidas.length) await deps.copias.apagar(uid, vencidas);
      return json({ ok: true, copia: id, feita, apagadas: vencidas.length });
    },

    mcp: async (req: Request) => {
      const conta = await verificarAcesso(assinatura(req), deps.emailPermitido, req.headers.get('authorization'));
      if (!conta) return naoAutorizado(req);
      if (req.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
      }
      const dados = await deps.carregarDados(conta.uid);
      const servidor = criarServidorMcp(dados, hojeEmBrasilia(deps.agora?.()), {
        uid: conta.uid, assinatura: assinatura(req), alterarDados: deps.alterarDados,
        substituirDados: deps.substituirDados, carregarDados: deps.carregarDados, copias: deps.copias,
        agora: () => deps.agora?.() ?? new Date()
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
