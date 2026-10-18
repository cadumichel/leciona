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
const copiasGuardadas = new Map<string, any>();
let segredoDoCron: string | undefined;
const copiaJson = (x: any) => JSON.parse(JSON.stringify(x));

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
  },
  // Firestore em memória: grava só os campos alterados, como a transação de producao.ts
  alterarDados: async (uid, calcular) => {
    expect(uid).toBe('uid-prof');
    const r = calcular(dados);
    Object.assign(dados, JSON.parse(JSON.stringify(r.alteracoes)));
    return r;
  },
  substituirDados: async (uid, calcular) => {
    expect(uid).toBe('uid-prof');
    const novo = copiaJson(calcular(dados));
    Object.keys(dados).forEach(k => delete dados[k]);
    Object.assign(dados, novo);
  },
  copias: {
    listar: async () => [...copiasGuardadas.entries()].map(([id, c]) => ({ id, ...c._copia })),
    ler: async (_uid, id) => (copiasGuardadas.has(id) ? copiaJson(copiasGuardadas.get(id)) : null),
    gravar: async (_uid, id, d) => { copiasGuardadas.set(id, copiaJson(d)); },
    apagar: async (_uid, ids) => { ids.forEach(id => copiasGuardadas.delete(id)); }
  },
  uidDoProfessor: async () => 'uid-prof',
  segredoDoCron
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
    const recusado = await reg(['https://golpe.com/cb?x=1']);
    expect(recusado.status).toBe(400);
    // Mostra o endereço recusado (sem parâmetros), para saber o que liberar
    expect((await recusado.json()).error_description).toBe('Endereço de retorno não permitido: https://golpe.com/cb');
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
  it('lista as ferramentas de leitura e de gravação', async () => {
    const { access_token } = await entrar();
    const resp = await rotas().mcp(mcp(access_token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(resp.status).toBe(200);
    const { result } = await resp.json();
    expect(result.tools.map((t: any) => t.name).sort()).toEqual([
      'aulas_restantes', 'avaliacoes_proximas', 'calendario', 'confirmar_gravacao', 'conteudo_desde_ultima_avaliacao', 'desfazer_gravacao',
      'listar_avaliacoes', 'listar_copias', 'preparar_alteracao_avaliacoes', 'preparar_avaliacoes', 'preparar_calendario', 'preparar_conteudo', 'preparar_eventos',
      'preparar_recessos', 'preparar_restauracao', 'preparar_situacao', 'turmas_e_grade'
    ]);
    const gravam = result.tools.filter((t: any) => !t.annotations?.readOnlyHint).map((t: any) => t.name).sort();
    expect(gravam).toEqual(['confirmar_gravacao', 'desfazer_gravacao']);
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

describe('conector: gravação pelo servidor MCP', () => {
  const chamar = async (token: string, name: string, args: unknown) => {
    const resp = await rotas().mcp(mcp(token, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }));
    const { result } = await resp.json();
    return { erro: !!result.isError, texto: result.content[0].text as string, json: () => JSON.parse(result.content[0].text) };
  };

  it('prepara, confirma e desfaz uma avaliação', async () => {
    const { access_token } = await entrar();
    const antes = dados.events.length;

    const previa = (await chamar(access_token, 'preparar_avaliacoes', {
      avaliacoes: [{ turma: '183', data: '2026-11-10', tipo: 'prova', titulo: 'P3', descricao: 'Cap. 15' }]
    })).json();
    expect(previa.vai_gravar).toEqual(['Prova "P3" — 183 (Cônsul), terça 10/11/2026, 1ª aula (13:30) — Pendente']);
    expect(dados.events.length).toBe(antes); // a prévia não grava

    const gravou = (await chamar(access_token, 'confirmar_gravacao', { codigo: previa.codigo_confirmacao })).json();
    expect(gravou.gravado).toBe(true);
    expect(dados.events.length).toBe(antes + 1);
    expect(dados.logs.some((l: any) => l.subject === 'Avaliação: P3')).toBe(true);

    const deNovo = (await chamar(access_token, 'confirmar_gravacao', { codigo: previa.codigo_confirmacao })).json();
    expect(deNovo.gravado).toBe(false);
    expect(dados.events.length).toBe(antes + 1);

    const desfez = (await chamar(access_token, 'desfazer_gravacao', { codigo_desfazer: gravou.codigo_desfazer })).json();
    expect(desfez.desfeito).toBe(true);
    expect(dados.events.length).toBe(antes);
    expect(dados.logs.some((l: any) => l.subject === 'Avaliação: P3')).toBe(false);
  });

  it('não aceita código de confirmação adulterado nem código de desfazer no lugar dele', async () => {
    const { access_token } = await entrar();
    const previa = (await chamar(access_token, 'preparar_situacao', {
      avaliacoes: [{ turma: '183', data: '2026-10-27', situacao: 'Pronta' }]
    })).json();
    const adulterado = await chamar(access_token, 'confirmar_gravacao', { codigo: previa.codigo_confirmacao.slice(0, -3) + 'abc' });
    expect(adulterado.erro).toBe(true);
    expect(adulterado.texto).toMatch(/inválido ou vencido/);
    const ok = (await chamar(access_token, 'confirmar_gravacao', { codigo: previa.codigo_confirmacao })).json();
    const trocado = await chamar(access_token, 'confirmar_gravacao', { codigo: ok.codigo_desfazer });
    expect(trocado.erro).toBe(true);
    await chamar(access_token, 'desfazer_gravacao', { codigo_desfazer: ok.codigo_desfazer });
    expect(dados.events.find((e: any) => e.id === 'p')).toMatchObject({ prepared: false });
  });
});

describe('conector: cópias de segurança', () => {
  const chamar = async (token: string, name: string, args: unknown) => {
    const resp = await rotas().mcp(mcp(token, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }));
    const { result } = await resp.json();
    return { erro: !!result.isError, texto: result.content[0].text as string, json: () => JSON.parse(result.content[0].text) };
  };
  const cron = (auth?: string) => rotas().copiaDiaria(new Request(`${ORIGEM}/api/backup`, { headers: auth ? { Authorization: auth } : {} }));

  it('faz uma cópia por dia e apaga as com mais de 30 dias', async () => {
    copiasGuardadas.set('2026-09-01', { _copia: { criadaEm: '2026-09-01T06:00:00.000Z', tipo: 'diaria', resumo: {} } });
    const r1 = await (await cron()).json();
    expect(r1).toMatchObject({ ok: true, copia: '2026-10-21', feita: true, apagadas: 1 });
    expect(copiasGuardadas.has('2026-09-01')).toBe(false);
    expect(copiasGuardadas.get('2026-10-21')._copia).toMatchObject({ tipo: 'diaria', resumo: { avaliacoes: 1, turmas: 1 } });
    expect(copiasGuardadas.get('2026-10-21')).not.toHaveProperty('updatedAt');
    expect((await (await cron()).json()).feita).toBe(false);
  });

  it('com CRON_SECRET, só roda com o segredo', async () => {
    segredoDoCron = 'segredo-de-teste';
    expect((await cron()).status).toBe(401);
    expect((await cron('Bearer segredo-de-teste')).status).toBe(200);
    segredoDoCron = undefined;
  });

  it('lista, mostra a prévia em números, restaura e desfaz', async () => {
    const { access_token } = await entrar();
    // Depois da cópia de hoje, entra uma avaliação nova
    dados.events.push({ id: 'nova', type: 'test', schoolId: 'C', classId: 'c183', slotId: 's1', date: '2026-11-03T00:00:00.000Z',
      title: 'P3', description: '', blocksClasses: false, _m: 1 });

    const lista = (await chamar(access_token, 'listar_copias', {})).json();
    expect(lista.copias).toEqual([expect.objectContaining({ id: '2026-10-21', descricao: 'cópia automática de 21/10/2026' })]);
    expect(JSON.stringify(lista)).not.toMatch(/P2 Era|Cônsul/);

    const previa = (await chamar(access_token, 'preparar_restauracao', { copia: '2026-10-21' })).json();
    expect(previa.previa[0].avisos).toContain('avaliações: 2 agora → 1 depois de restaurar');
    expect(dados.events).toHaveLength(2); // a prévia não grava

    const feito = (await chamar(access_token, 'confirmar_gravacao', { codigo: previa.codigo_confirmacao })).json();
    expect(feito.gravado).toBe(true);
    expect(dados.events.map((e: any) => e.id)).toEqual(['p']);
    expect(dados._deleted.nova).toBeGreaterThan(0); // some também dos outros aparelhos
    expect([...copiasGuardadas.keys()].some(k => k.startsWith('antes-de-restaurar-'))).toBe(true);

    const desfeito = (await chamar(access_token, 'desfazer_gravacao', { codigo_desfazer: feito.codigo_desfazer })).json();
    expect(desfeito.desfeito).toBe(true);
    expect(dados.events.map((e: any) => e.id).sort()).toEqual(['nova', 'p']);
  });

  it('recusa cópia que não existe', async () => {
    const { access_token } = await entrar();
    const r = await chamar(access_token, 'preparar_restauracao', { copia: '2025-01-01' });
    expect(r.erro).toBe(true);
    expect(r.texto).toMatch(/Não há cópia/);
  });
});
