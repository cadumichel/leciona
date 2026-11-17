import { describe, it, expect, beforeEach } from 'vitest';
import webpush from 'web-push';
import { criarRotas } from '../connector/servidor';
import { Aparelho, ArmazemDeAvisos, EstadoDosAvisos, MAX_APARELHOS, MensagemPush, derivarChavesPush } from '../connector/avisosPush';

// Dados inventados (nenhum nome real). Terça 20/10/2026: duas aulas de manhã, até 09:00.
const dados = (): any => ({
  profile: {}, settings: { isPrivateTeacher: false, alertAfterShift: true }, students: [], classRecords: [], grades: [], schedules: [],
  reminders: [], customAssessments: [], gradingConfigs: [], logs: [], events: [],
  schools: [{ id: 'E', name: 'Escola Teste', classes: [{ id: 'c6', name: '6º Ano' }],
    shifts: [{ id: 'm', name: 'Matutino', slots: [
      { id: 's1', startTime: '07:30', endTime: '08:15', type: 'class', label: '1' },
      { id: 's2', startTime: '08:15', endTime: '09:00', type: 'class', label: '2' }] }] }],
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 2, schoolId: 'E', shiftId: 'm', slotId: 's1', classId: '6º Ano' },
    { id: 'e2', dayOfWeek: 2, schoolId: 'E', shiftId: 'm', slotId: 's2', classId: '6º Ano' }] }],
  calendars: []
});

const ORIGEM = 'https://leciona.exemplo';
const SEGREDO = 'segredo-de-teste';
let doc: any;
let carimbo: string;
let leituras: number;
let aparelhos: Aparelho[];
let estado: EstadoDosAvisos;
let enviadas: { para: string; mensagem: MensagemPush }[];
let respostaDoEnvio: (a: Aparelho) => 'ok' | 'expirado' | 'erro';
let agora: Date;
let segredoDoCron: string | undefined;

const armazem = (): ArmazemDeAvisos => ({
  chavePublica: 'chave-publica-de-teste',
  lerAparelhos: async () => aparelhos,
  gravarAparelhos: async (_uid, lista) => { aparelhos = lista; },
  lerEstado: async () => estado,
  gravarEstado: async (_uid, e) => { estado = JSON.parse(JSON.stringify(e)); },
  carimboDosDados: async () => carimbo,
  enviar: async (a, mensagem) => {
    const r = respostaDoEnvio(a);
    if (r === 'ok') enviadas.push({ para: a.endpoint, mensagem });
    return r;
  }
});

const rotas = () => criarRotas({
  chave: new Uint8Array(32).fill(7),
  emailPermitido: 'prof@exemplo.com',
  agora: () => agora,
  verificarLogin: async t => {
    if (t === 'login-do-prof') return { uid: 'uid-prof', email: 'Prof@Exemplo.com', email_verified: true };
    if (t === 'login-de-outro') return { uid: 'uid-outro', email: 'outro@exemplo.com', email_verified: true };
    throw new Error('token inválido');
  },
  carregarDados: async () => { leituras++; return doc; },
  alterarDados: async () => { throw new Error('não usado'); },
  substituirDados: async () => { throw new Error('não usado'); },
  copias: { listar: async () => [], ler: async () => null, gravar: async () => {}, apagar: async () => {} },
  uidDoProfessor: async () => 'uid-prof',
  segredoDoCron,
  avisos: armazem()
});

const inscricao = (n = 1) => ({ endpoint: `https://push.exemplo/aparelho-${n}`, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } });
const app = (corpo: any, login = 'login-do-prof') => rotas().avisos(new Request(`${ORIGEM}/api/avisos`, {
  method: 'POST', headers: { Authorization: `Bearer ${login}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0' },
  body: JSON.stringify(corpo)
}));
const agendador = (segredo: string | null = SEGREDO) => rotas().avisos(new Request(`${ORIGEM}/api/avisos?acao=conferir`, {
  headers: segredo ? { Authorization: `Bearer ${segredo}` } : {}
}));
// Horário de Brasília da terça 20/10/2026
const hora = (hhmm: string) => { agora = new Date(`2026-10-20T${hhmm}:00-03:00`); };

beforeEach(() => {
  doc = dados(); carimbo = '1'; leituras = 0; aparelhos = []; estado = { enviados: {} }; enviadas = [];
  respostaDoEnvio = () => 'ok'; segredoDoCron = SEGREDO; hora('08:00');
});

describe('avisos: cadastro dos aparelhos', () => {
  it('a chave pública e a situação do agendador são públicas; o resto exige o login do professor', async () => {
    const publico = await (await rotas().avisos(new Request(`${ORIGEM}/api/avisos`))).json();
    expect(publico).toEqual({ chavePublica: 'chave-publica-de-teste', agendadorConfigurado: true });
    expect((await app({ acao: 'inscrever', inscricao: inscricao() }, 'login-de-outro')).status).toBe(403);
    expect((await app({ acao: 'inscrever', inscricao: inscricao() }, 'qualquer')).status).toBe(401);
    expect(aparelhos).toEqual([]);
  });

  it('ativa, mostra a situação e desativa neste aparelho', async () => {
    const r = await (await app({ acao: 'inscrever', inscricao: inscricao() })).json();
    expect(r).toMatchObject({ ok: true, esteAparelho: true, aparelhos: [{ nome: 'Celular Android (Chrome)', este: true }] });
    // Ativar de novo não duplica
    await app({ acao: 'inscrever', inscricao: inscricao() });
    expect(aparelhos).toHaveLength(1);
    expect((await (await app({ acao: 'situacao', inscricao: inscricao(2) })).json()).esteAparelho).toBe(false);
    expect((await (await app({ acao: 'remover', inscricao: inscricao() })).json()).aparelhos).toEqual([]);
  });

  it('recusa endereço de notificação malformado e limita a quantidade de aparelhos', async () => {
    expect((await app({ acao: 'inscrever', inscricao: { endpoint: 'http://sem-https', keys: { p256dh: 'x', auth: 'y' } } })).status).toBe(400);
    expect((await app({ acao: 'inscrever' })).status).toBe(400);
    for (let i = 1; i <= MAX_APARELHOS + 2; i++) await app({ acao: 'inscrever', inscricao: inscricao(i) });
    expect(aparelhos).toHaveLength(MAX_APARELHOS);
    expect(aparelhos.at(-1)!.endpoint).toBe(inscricao(MAX_APARELHOS + 2).endpoint);
  });

  it('o aviso de teste chega a todos os aparelhos e tira da lista os que cancelaram', async () => {
    await app({ acao: 'inscrever', inscricao: inscricao(1) });
    await app({ acao: 'inscrever', inscricao: inscricao(2) });
    respostaDoEnvio = a => (a.endpoint.endsWith('-2') ? 'expirado' : 'ok');
    const r = await (await app({ acao: 'teste', inscricao: inscricao(1) })).json();
    expect(r).toMatchObject({ entregues: 1, esteAparelho: true });
    expect(enviadas[0].mensagem).toMatchObject({ destino: 'ajustes', marca: 'teste' });
    expect(aparelhos.map(a => a.endpoint)).toEqual([inscricao(1).endpoint]);
  });
});

describe('avisos: conferência do agendador', () => {
  it('só roda com o CRON_SECRET; sem a variável na Vercel responde que falta configurar', async () => {
    expect((await agendador(null)).status).toBe(401);
    expect((await agendador('errado')).status).toBe(401);
    segredoDoCron = undefined;
    expect((await agendador(null)).status).toBe(503);
    expect((await agendador(SEGREDO)).status).toBe(503);
  });

  it('manda o aviso de fim de turno uma vez só', async () => {
    await app({ acao: 'inscrever', inscricao: inscricao() });
    hora('08:55');
    expect(await (await agendador()).json()).toMatchObject({ conferido: true, enviados: 0 });
    hora('09:00');
    expect(await (await agendador()).json()).toMatchObject({ conferido: true, enviados: 1 });
    expect(enviadas).toEqual([{ para: inscricao().endpoint, mensagem: expect.objectContaining({ titulo: 'Escola Teste: 2 aulas sem registro', destino: 'pendencias' }) }]);
    hora('09:05');
    carimbo = '2'; // o professor mexeu no app: confere de novo, mas não repete o aviso
    expect(await (await agendador()).json()).toMatchObject({ conferido: true, enviados: 0 });
    expect(enviadas).toHaveLength(1);
    expect(estado.ultimoEnvio).toMatchObject({ titulo: 'Escola Teste: 2 aulas sem registro', entregues: 1 });
  });

  it('não lê o documento do professor quando nada mudou e ainda não é hora de aviso', async () => {
    await app({ acao: 'inscrever', inscricao: inscricao() });
    hora('07:00');
    await agendador();
    expect(leituras).toBe(1);
    expect(estado.proximo).toBe('2026-10-20T09:00');
    hora('07:05'); await agendador();
    hora('08:55'); await agendador();
    expect(leituras).toBe(1);
    expect(estado.ultimaConferencia).toBe(agora.toISOString());
    hora('09:00'); await agendador(); // chegou a hora
    expect(leituras).toBe(2);
    hora('09:05'); carimbo = '2'; await agendador(); // os dados mudaram
    expect(leituras).toBe(3);
  });

  it('sem aparelho cadastrado não lê os dados nem marca nada; ao ativar, o aviso ainda na janela chega', async () => {
    hora('09:00');
    expect(await (await agendador()).json()).toMatchObject({ conferido: false, semAparelhos: true });
    expect(leituras).toBe(0);
    await app({ acao: 'inscrever', inscricao: inscricao() });
    hora('09:10');
    expect((await (await agendador()).json()).enviados).toBe(1);
  });

  it('se o envio falhar, tenta de novo na conferência seguinte', async () => {
    await app({ acao: 'inscrever', inscricao: inscricao() });
    hora('09:00');
    respostaDoEnvio = () => 'erro';
    expect((await (await agendador()).json()).enviados).toBe(0);
    expect(estado.enviados).toEqual({});
    respostaDoEnvio = () => 'ok';
    hora('09:05');
    expect((await (await agendador()).json()).enviados).toBe(1);
  });

  it('esquece avisos enviados há mais de 3 dias', async () => {
    await app({ acao: 'inscrever', inscricao: inscricao() });
    estado = { enviados: { 'turno|2026-10-10|E|m': '2026-10-10T12:00:00.000Z', 'turno|2026-10-19|E|m': '2026-10-19T12:00:00.000Z' } };
    hora('09:00');
    await agendador();
    expect(Object.keys(estado.enviados).sort()).toEqual(['turno|2026-10-19|E|m', 'turno|2026-10-20|E|m']);
  });
});

describe('avisos: chaves das notificações', () => {
  it('são derivadas da credencial (sempre as mesmas) e aceitas pela biblioteca de envio', () => {
    const chaves = derivarChavesPush('credencial-de-teste');
    expect(derivarChavesPush('credencial-de-teste')).toEqual(chaves);
    expect(derivarChavesPush('outra')).not.toEqual(chaves);
    // Aparelho inventado, com chaves no formato real
    const aparelho = webpush.generateVAPIDKeys();
    const pedido = webpush.generateRequestDetails(
      { endpoint: 'https://push.exemplo/x', keys: { p256dh: aparelho.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') } },
      JSON.stringify({ titulo: 'Teste' }),
      { vapidDetails: { subject: 'mailto:prof@exemplo.com', publicKey: chaves.publica, privateKey: chaves.privada }, TTL: 60 }
    );
    expect(pedido.headers.Authorization).toContain('vapid');
  });
});
