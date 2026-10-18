import { SignJWT, jwtVerify, base64url } from 'jose';

/**
 * Login do conector (OAuth 2.1 com PKCE), sem banco de dados: códigos e tokens são JWTs assinados
 * com uma chave derivada da credencial do Firebase Admin. Trocar essa credencial na Vercel
 * invalida todos os acessos já concedidos.
 *
 * Quem entra: só a conta Google do Cadu (variável LECIONA_EMAIL), verificada pelo Firebase.
 */

export const ESCOPO = 'leciona';
const DURACAO_CODIGO = 5 * 60;
const DURACAO_ACESSO = 60 * 60;
const DURACAO_RENOVACAO = 30 * 24 * 60 * 60;

/** Para onde o login pode voltar: o Claude (web/app) e o próprio computador (Claude Code). */
export const redirecionamentoPermitido = (uri: string): boolean => {
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  if (url.hash) return false;
  if (url.protocol === 'https:' && ['claude.ai', 'claude.com'].includes(url.hostname)) {
    return url.pathname === '/api/mcp/auth_callback';
  }
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
};

/** Endereço recusado, para a mensagem de erro (sem parâmetros), para saber o que liberar. */
const enderecoRecusado = (uri?: string) => {
  if (!uri) return 'Endereço de retorno não permitido.';
  try {
    const url = new URL(uri);
    return `Endereço de retorno não permitido: ${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return `Endereço de retorno não permitido: ${uri.slice(0, 120)}`;
  }
};

export const urlsDoServidor = (origem: string) => ({
  emissor: origem,
  recurso: `${origem}/api/mcp`,
  autorizar: `${origem}/api/oauth/authorize`,
  token: `${origem}/api/oauth/token`,
  registro: `${origem}/api/oauth/register`,
  metadadosRecurso: `${origem}/.well-known/oauth-protected-resource`
});

export const metadadosDoRecurso = (origem: string) => {
  const u = urlsDoServidor(origem);
  return {
    resource: u.recurso,
    authorization_servers: [u.emissor],
    scopes_supported: [ESCOPO],
    bearer_methods_supported: ['header'],
    resource_name: 'Leciona'
  };
};

export const metadadosDoServidor = (origem: string) => {
  const u = urlsDoServidor(origem);
  return {
    issuer: u.emissor,
    authorization_endpoint: u.autorizar,
    token_endpoint: u.token,
    registration_endpoint: u.registro,
    scopes_supported: [ESCOPO],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true
  };
};

export class ErroOAuth extends Error {
  constructor(public codigo: string, mensagem: string, public status = 400) {
    super(mensagem);
  }
}

/** Parâmetros do pedido de autorização, já validados. */
export interface PedidoDeAutorizacao {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state?: string;
  resource?: string;
  scope?: string;
}

/**
 * Valida o pedido de autorização. Erro no redirect_uri não pode voltar para ele (seria um
 * redirecionamento aberto), então vira página de erro; os demais voltam para o cliente.
 */
export const validarPedido = (p: Record<string, string | undefined>, origem: string): PedidoDeAutorizacao => {
  if (!p.client_id) throw new ErroOAuth('invalid_request', 'Falta client_id.');
  if (!p.redirect_uri || !redirecionamentoPermitido(p.redirect_uri)) {
    throw new ErroOAuth('invalid_request', enderecoRecusado(p.redirect_uri));
  }
  if (p.response_type !== 'code') throw new ErroOAuth('unsupported_response_type', 'Use response_type=code.');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') {
    throw new ErroOAuth('invalid_request', 'PKCE (S256) é obrigatório.');
  }
  if (p.resource && p.resource !== urlsDoServidor(origem).recurso) {
    throw new ErroOAuth('invalid_target', 'Recurso desconhecido.');
  }
  return {
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    state: p.state,
    resource: p.resource,
    scope: p.scope
  };
};

// ── Tokens ────────────────────────────────────────────────────────────────────

type TipoDeToken = 'codigo' | 'acesso' | 'renovacao' | 'plano' | 'lote';

export interface Assinatura { chave: Uint8Array; origem: string; agora?: Date }

const emitir = (a: Assinatura, tipo: TipoDeToken, dados: Record<string, unknown>, sub: string, duracao: number) => {
  const agora = Math.floor((a.agora ?? new Date()).getTime() / 1000);
  return new SignJWT({ ...dados, tipo })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(a.origem)
    .setAudience(urlsDoServidor(a.origem).recurso)
    .setSubject(sub)
    .setIssuedAt(agora)
    .setExpirationTime(agora + duracao)
    .sign(a.chave);
};

const ler = async (a: Assinatura, tipo: TipoDeToken, token: string) => {
  try {
    const { payload } = await jwtVerify(token, a.chave, {
      issuer: a.origem,
      audience: urlsDoServidor(a.origem).recurso,
      algorithms: ['HS256'],
      currentDate: a.agora
    });
    if (payload.tipo !== tipo || !payload.sub) throw new Error('tipo');
    return payload as typeof payload & { sub: string; email?: string };
  } catch {
    return null;
  }
};

export interface Conta { uid: string; email: string }

/**
 * Prévias de gravação (plano) e lotes gravados (para desfazer) viajam assinados: o Claude só
 * consegue gravar exatamente o que foi mostrado ao Cadu, e só desfazer o que o conector gravou.
 */
const DURACAO_PLANO = 60 * 60;
const DURACAO_LOTE = 30 * 24 * 60 * 60;

export const assinarPlano = (a: Assinatura, uid: string, plano: unknown) =>
  emitir(a, 'plano', { plano }, uid, DURACAO_PLANO);

export const assinarLote = (a: Assinatura, uid: string, lote: unknown) =>
  emitir(a, 'lote', { lote }, uid, DURACAO_LOTE);

export const lerPlano = async (a: Assinatura, uid: string, codigo: string) => {
  const t = await ler(a, 'plano', codigo);
  return t && t.sub === uid ? (t.plano as unknown) : null;
};

export const lerLote = async (a: Assinatura, uid: string, codigo: string) => {
  const t = await ler(a, 'lote', codigo);
  return t && t.sub === uid ? (t.lote as unknown) : null;
};

export const emitirCodigo = (a: Assinatura, pedido: PedidoDeAutorizacao, conta: Conta) =>
  emitir(a, 'codigo', {
    email: conta.email,
    cid: pedido.client_id,
    ru: pedido.redirect_uri,
    cc: pedido.code_challenge
  }, conta.uid, DURACAO_CODIGO);

const emitirPar = async (a: Assinatura, conta: Conta) => ({
  access_token: await emitir(a, 'acesso', { email: conta.email, scope: ESCOPO }, conta.uid, DURACAO_ACESSO),
  token_type: 'Bearer',
  expires_in: DURACAO_ACESSO,
  refresh_token: await emitir(a, 'renovacao', { email: conta.email }, conta.uid, DURACAO_RENOVACAO),
  scope: ESCOPO
});

const desafioPKCE = async (verificador: string) =>
  base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador))));

const mesmoEmail = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Endpoint de token: troca código (com PKCE) ou token de renovação por um novo par de tokens. */
export const trocarToken = async (a: Assinatura, emailPermitido: string, p: Record<string, string | undefined>) => {
  if (p.grant_type === 'authorization_code') {
    const codigo = p.code && await ler(a, 'codigo', p.code);
    if (!codigo) throw new ErroOAuth('invalid_grant', 'Código inválido ou vencido.');
    if (p.redirect_uri !== codigo.ru) throw new ErroOAuth('invalid_grant', 'redirect_uri diferente do pedido.');
    if (p.client_id && p.client_id !== codigo.cid) throw new ErroOAuth('invalid_grant', 'client_id diferente do pedido.');
    if (!p.code_verifier || await desafioPKCE(p.code_verifier) !== codigo.cc) {
      throw new ErroOAuth('invalid_grant', 'Verificação PKCE falhou.');
    }
    if (!mesmoEmail(codigo.email, emailPermitido)) throw new ErroOAuth('invalid_grant', 'Conta sem acesso.');
    return emitirPar(a, { uid: codigo.sub, email: codigo.email! });
  }
  if (p.grant_type === 'refresh_token') {
    const renovacao = p.refresh_token && await ler(a, 'renovacao', p.refresh_token);
    if (!renovacao) throw new ErroOAuth('invalid_grant', 'Token de renovação inválido ou vencido.');
    if (!mesmoEmail(renovacao.email, emailPermitido)) throw new ErroOAuth('invalid_grant', 'Conta sem acesso.');
    return emitirPar(a, { uid: renovacao.sub, email: renovacao.email! });
  }
  throw new ErroOAuth('unsupported_grant_type', 'Tipo de concessão não suportado.');
};

/** Confere o token de acesso de uma chamada ao conector. Devolve a conta ou null. */
export const verificarAcesso = async (a: Assinatura, emailPermitido: string, cabecalho: string | null): Promise<Conta | null> => {
  const token = cabecalho?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const acesso = await ler(a, 'acesso', token);
  if (!acesso || !mesmoEmail(acesso.email, emailPermitido)) return null;
  return { uid: acesso.sub, email: acesso.email! };
};

/** Registro dinâmico de cliente (RFC 7591): não guarda nada, só confere os endereços de retorno. */
export const registrarCliente = (corpo: any) => {
  const uris: unknown = corpo?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || !uris.every(u => typeof u === 'string' && redirecionamentoPermitido(u))) {
    const recusado = Array.isArray(uris) ? uris.find(u => typeof u !== 'string' || !redirecionamentoPermitido(u)) : undefined;
    throw new ErroOAuth('invalid_redirect_uri', enderecoRecusado(typeof recusado === 'string' ? recusado : undefined));
  }
  return {
    client_id: `leciona-${crypto.randomUUID()}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: typeof corpo.client_name === 'string' ? corpo.client_name : undefined,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none'
  };
};

/** Chave de assinatura derivada de um segredo (a chave privada da credencial do Firebase Admin). */
export const derivarChave = async (segredo: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`leciona-conector-v1:${segredo}`)));
