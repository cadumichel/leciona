import { describe, it, expect } from 'vitest';
import { base64url } from 'jose';
import { criarRotas } from '../connector/servidor';
import { redirecionamentoPermitido } from '../connector/oauth';

// Dados inventados (nenhum nome real)
const dados: any = {
  profile: {}, settings: {}, students: [], calendars: [], logs: [], classRecords: [], grades: [], schedules: [],
  schools: [{ id: 'C', name: 'Cônsul', color: '#f00', classes: [{ id: 'c183', name: '183' }],
    shifts: [{ id: 'cv', name: 'Vespertino', slots: [{ id: 's1', startTime: '13:30', endTime: '14:15', type: 'class', label: '1' }] }] }],
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 2, schoolId: 'C', shiftId: 'cv', slotId: 's1', classId: '183' }] }],
  events: [{ id: 'p', type: 'test', schoolId: 'C', classId: 'c183', slotId: 's1', date: '2026-10-27T00:00:00.000Z',
    title: 'P2 Era Napoleônica', description: '', blocksClasses: false, prepared: false }]
};

const ORIGEM = 'https://leciona.vercel.app';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const EMAIL = 'prof@exemplo.com';
let agora = new Date('2026-10-21T15:00:00Z');

const rotas = (emailPermitido = EMAIL) => criarRotas({
  chave: new Uint8Array(32).fill(7),
  emailPermitido,
  agora: () => agora,
  verificarLogin: async t => {
    if (t === 'login-do-prof') return { uid: 'uid-prof', email: 'Prof@Exemplo.com', email_verified: true };
    if (t === 'login-de-outro') return { uid: 'uid-outro', email: 'outro@exemplo.com', email_verified: true };
    throw new Error('token inválido');
  },
  carregarDados: async uid => {
    expect(uid).toBe('uid-prof');
    return dados;
  }
});

const VERIFICADOR = 'verificador-pkce-de-teste-com-mais-de-43-caracteres-0123456789';
const desafio = async () =>
  base64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFICADOR))));

const pedido = async (extra: Record<string, string> = {}) => ({
  response_type: 'code', client_id: 'cliente-claude', redirect_uri: CALLBACK,
  code_challenge: await desafio(), code_challenge_method: 'S256', state: 'abc"<x>', resource: `${ORIGEM}/api/mcp`, ...extra
});

const form = (url: string, campos: Record<string, string>) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos) });

/** Faz o login completo e devolve os tokens. */
const entrar = async (r = rotas()) => {
  const resp = await r.autorizarPost(form(`${ORIGEM}/api/oauth/authorize`, { ...(await pedido()), id_token: 'login-do-prof' }));
  const volta = new URL(resp.headers.get('location')!);
  const t = await r.token(form(`${ORIGEM}/api/oauth/token`, {
    grant_type: 'authorization_code', code: volta.searchParams.get('code')!, redirect_uri: CALLBACK,
    client_id: 'cliente-claude', code_verifier: VERIFICADOR
  }));
  return t.json();
};

const mcp = (token: string | null, corpo: unknown) => new Request(`${ORIGEM}/api/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(corpo)
});

describe('conector: endereços de retorno', () => {
  it('aceita só o Claude e o próprio computador', () => {
    expect(redirecionamentoPermitido(CALLBACK)).toBe(true);
    expect(redirecionamentoPermitido('https://claude.com/api/mcp/auth_callback')).toBe(true);
    expect(redirecionamentoPermitido('http://localhost:33418/callback')).toBe(true);
    expect(redirecionamentoPermitido('https://claude.ai.golpe.com/api/mcp/auth_callback')).toBe(false);
    expect(redirecionamentoPermitido('https://claude.ai/outra-coisa')).toBe(false);
    expect(redirecionamentoPermitido('http://claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(redirecionamentoPermitido('javascript:alert(1)')).toBe(false);
  });
});

describe('conector: metadados e registro', () => {
  it('sem login, o servidor responde 401 apontando para os metadados', async () => {
    const resp = await rotas().mcp(mcp(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(resp.status).toBe(401);
    expect(resp.headers.get('www-authenticate')).toContain(`resource_metadata="${ORIGEM}/.well-known/oauth-protected-resource"`);
  });

  it('publica os metadados do recurso e do servidor de autorização', async () => {
    const recurso = await rotas().metadadosRecurso(new Request(`${ORIGEM}/.well-known/oauth-protected-resource`)).json();
    expect(recurso).toMatchObject({ resource: `${ORIGEM}/api/mcp`, authorization_servers: [ORIGEM] });
    const servidor = await rotas().metadadosServidor(new Request(`${ORIGEM}/.well-known/oauth-authorization-server`)).json();
    expect(servidor).toMatchObject({
      issuer: ORIGEM, token_endpoint: `${ORIGEM}/api/oauth/token`, code_challenge_methods_supported: ['S256']
    });
  });

  it('registra cliente só com endereço de retorno permitido', async () => {
    const reg = (uris: string[]) => rotas().registrar(new Request(`${ORIGEM}/api/oauth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: uris, client_name: 'Claude' })
    }));
    const ok = await reg([CALLBACK]);
    expect(ok.status).toBe(201);
    expect((await ok.json()).client_id).toMatch(/^leciona-/);
    expect((await reg(['https://golpe.com/cb'])).status).toBe(400);
  });
});

describe('conector: login', () => {
  it('mostra a página de login com os parâmetros escapados', async () => {
    const url = new URL(`${ORIGEM}/api/oauth/authorize`);
    Object.entries(await pedido()).forEach(([k, v]) => url.searchParams.set(k, v));
    const resp = await rotas().autorizarGet(new Request(url));
    expect(resp.status).toBe(200);
    expect(resp.headers.get('x-frame-options')).toBe('DENY');
    const html = await resp.text();
    expect(html).toContain('value="abc&quot;&lt;x&gt;"');
    expect(html).not.toContain('abc"<x>');
  });

  it('com endereço de retorno estranho, mostra erro e não redireciona', async () => {
    const url = new URL(`${ORIGEM}/api/oauth/authorize`);
    Object.entries(await pedido({ redirect_uri: 'https://golpe.com/cb' })).forEach(([k, v]) => url.searchParams.set(k, v));
    const resp = await rotas().autorizarGet(new Request(url));
    expect(resp.status).toBe(400);
    expect(resp.headers.get('location')).toBeNull();
  });

  it('exige PKCE', async () => {
    const url = new URL(`${ORIGEM}/api/oauth/authorize`);
    Object.entries(await pedido({ code_challenge_method: 'plain' })).forEach(([k, v]) => url.searchParams.set(k, v));
    expect((await rotas().autorizarGet(new Request(url))).status).toBe(400);
  });

  it('recusa outra conta Google e login inválido', async () => {
    const outra = await rotas().autorizarPost(form(`${ORIGEM}/api/oauth/authorize`, { ...(await pedido()), id_token: 'login-de-outro' }));
    expect(outra.status).toBe(403);
    const invalido = await rotas().autorizarPost(form(`${ORIGEM}/api/oauth/authorize`, { ...(await pedido()), id_token: 'falso' }));
    expect(invalido.status).toBe(401);
  });

  it('com a conta certa, volta ao Claude com código e state', async () => {
    const resp = await rotas().autorizarPost(form(`${ORIGEM}/api/oauth/authorize`, { ...(await pedido()), id_token: 'login-do-prof' }));
    expect(resp.status).toBe(302);
    const volta = new URL(resp.headers.get('location')!);
    expect(volta.origin + volta.pathname).toBe(CALLBACK);
    expect(volta.searchParams.get('state')).toBe('abc"<x>');
    expect(volta.searchParams.get('code')).toBeTruthy();
  });
});

describe('conector: tokens', () => {
  it('troca código por token só com o verificador PKCE certo', async () => {
    const r = rotas();
    const resp = await r.autorizarPost(form(`${ORIGEM}/api/oauth/authorize`, { ...(await pedido()), id_token: 'login-do-prof' }));
    const code = new URL(resp.headers.get('location')!).searchParams.get('code')!;
    const trocar = (verificador: string, redirect = CALLBACK) => r.token(form(`${ORIGEM}/api/oauth/token`, {
      grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verificador
    }));
    expect((await (await trocar('verificador-errado')).json()).error).toBe('invalid_grant');
    expect((await trocar(VERIFICADOR, 'http://localhost:1/cb')).status).toBe(400);
    const ok = await (await trocar(VERIFICADOR)).json();
    expect(ok).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    expect(ok.access_token).toBeTruthy();
  });

  it('código vencido não vale', async () => {
    const r = rotas();
    const resp = await r.autorizarPost(form(`${ORIGEM}/api/oauth/authorize`, { ...(await pedido()), id_token: 'login-do-prof' }));
    const code = new URL(resp.headers.get('location')!).searchParams.get('code')!;
    agora = new Date('2026-10-21T15:10:00Z');
    const t = await r.token(form(`${ORIGEM}/api/oauth/token`, {
      grant_type: 'authorization_code', code, redirect_uri: CALLBACK, code_verifier: VERIFICADOR
    }));
    agora = new Date('2026-10-21T15:00:00Z');
    expect(t.status).toBe(400);
  });

  it('renova o acesso com o token de renovação', async () => {
    const { refresh_token, access_token } = await entrar();
    const novo = await (await rotas().token(form(`${ORIGEM}/api/oauth/token`, { grant_type: 'refresh_token', refresh_token }))).json();
    expect(novo.access_token).toBeTruthy();
    // Token de acesso não serve como token de renovação
    const errado = await rotas().token(form(`${ORIGEM}/api/oauth/token`, { grant_type: 'refresh_token', refresh_token: access_token }));
    expect(errado.status).toBe(400);
  });
});

describe('conector: servidor MCP', () => {
  it('lista as ferramentas de leitura', async () => {
    const { access_token } = await entrar();
    const resp = await rotas().mcp(mcp(access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(resp.status).toBe(200);
    const { result } = await resp.json();
    expect(result.tools.map((t: any) => t.name).sort()).toEqual([
      'avaliacoes_proximas', 'calendario', 'conteudo_desde_ultima_avaliacao', 'listar_avaliacoes', 'turmas_e_grade'
    ]);
    expect(result.tools.every((t: any) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it('responde a uma consulta com a data de hoje em Brasília', async () => {
    const { access_token } = await entrar();
    const resp = await rotas().mcp(mcp(access_token, {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'avaliacoes_proximas', arguments: { dias: 7 } }
    }));
    const { result } = await resp.json();
    const corpo = JSON.parse(result.content[0].text);
    expect(corpo.hoje).toBe('2026-10-21');
    expect(corpo.resultado.map((a: any) => a.titulo)).toEqual(['P2 Era Napoleônica']);
  });

  it('erros de consulta voltam como mensagem para o Claude', async () => {
    const { access_token } = await entrar();
    const resp = await rotas().mcp(mcp(access_token, {
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'conteudo_desde_ultima_avaliacao', arguments: { turma: '999' } }
    }));
    const { result } = await resp.json();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/não encontrada/);
  });

  it('recusa token vencido, adulterado ou de conta que perdeu o acesso', async () => {
    const { access_token } = await entrar();
    const lista = { jsonrpc: '2.0', id: 4, method: 'tools/list' };
    expect((await rotas('outra@exemplo.com').mcp(mcp(access_token, lista))).status).toBe(401);
    expect((await rotas().mcp(mcp(access_token.slice(0, -2) + 'xx', lista))).status).toBe(401);
    agora = new Date('2026-10-21T17:00:00Z');
    const vencido = await rotas().mcp(mcp(access_token, lista));
    agora = new Date('2026-10-21T15:00:00Z');
    expect(vencido.status).toBe(401);
  });
});
