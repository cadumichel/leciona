import { describe, it, expect } from 'vitest';
import { criarRotas } from '../connector/servidor';
import { dadosDoArquivo } from '../connector/arquivo';
import { archivedAssessments, archivedClassNames, archivedLessons } from '../utils/archivedYear';
import { buildNewSchoolYear, defaultPlan } from '../utils/newSchoolYear';

// Dados inventados (nenhum nome real)
const dia = (d: string) => `${d}T00:00:00.000Z`;
const ano2026 = (): any => ({
  profile: { name: 'Prof' }, settings: {}, students: [], classRecords: [], schedules: [], scheduleVersions: [],
  calendars: [], reminders: [], grades: [], customAssessments: [], gradingConfigs: [],
  schools: [
    { id: 'C', name: 'Escola C', classes: [{ id: 'c1', name: '183' }, { id: 'c2', name: '184' }], shifts: [] },
    { id: 'U', name: 'Escola U', classes: [{ id: 'u1', name: '1ª Série' }], shifts: [] }
  ],
  logs: [
    { id: 'l2', date: dia('2026-05-12'), schoolId: 'C', classId: 'c1', slotId: 's', subject: 'Revolução Francesa', homework: '', notes: '' },
    { id: 'l1', date: dia('2026-03-10'), schoolId: 'C', classId: 'c1', slotId: 's', subject: 'Iluminismo', homework: 'Ler o capítulo 3', notes: '' },
    { id: 'l3', date: dia('2026-03-11'), schoolId: 'C', classId: '184', slotId: 's', subject: 'Iluminismo', homework: '', notes: '' },
    { id: 'l4', date: dia('2026-03-12'), schoolId: 'U', classId: 'u1', slotId: 's', subject: 'Grécia Antiga', homework: '', notes: '' },
    { id: 'l5', date: dia('2026-03-13'), schoolId: 'C', classId: 'c1', slotId: 's', subject: 'Apagada', homework: '', notes: '', status: 'removed' },
    { id: 'l6', date: dia('2026-03-13'), schoolId: 'C', classId: 'window', slotId: 's', subject: '', homework: '', notes: '' }
  ],
  events: [
    { id: 'p1', type: 'test', date: dia('2026-04-02'), schoolId: 'C', classId: 'c1', title: 'P1 Iluminismo', description: '', blocksClasses: false },
    { id: 'f1', type: 'festivity', date: dia('2026-06-20'), schoolId: 'C', title: 'Festa junina', description: '', blocksClasses: true }
  ],
  _deleted: { x: 1 }, _fieldM: { profile: { name: 1 } }, updatedAt: { seconds: 1 }
});

const guardados = new Map<number, any>();
let agora = new Date('2026-12-18T15:00:00Z');
const rotas = () => criarRotas({
  chave: new Uint8Array(32).fill(7),
  emailPermitido: 'prof@exemplo.com',
  agora: () => agora,
  verificarLogin: async t => {
    if (t === 'login-do-prof') return { uid: 'uid-prof', email: 'Prof@Exemplo.com', email_verified: true };
    if (t === 'login-de-outro') return { uid: 'uid-outro', email: 'outro@exemplo.com', email_verified: true };
    throw new Error('token inválido');
  },
  carregarDados: async () => ano2026(),
  alterarDados: async () => { throw new Error('não usado'); },
  substituirDados: async () => { throw new Error('não usado'); },
  copias: { listar: async () => [], ler: async () => null, gravar: async () => { }, apagar: async () => { } },
  anos: {
    listar: async () => [...guardados.values()].map(d => d._arquivo),
    ler: async (_uid, ano) => (guardados.has(ano) ? JSON.parse(JSON.stringify(guardados.get(ano))) : null),
    gravar: async (uid, ano, dados) => { expect(uid).toBe('uid-prof'); guardados.set(ano, JSON.parse(JSON.stringify(dados))); }
  },
  uidDoProfessor: async () => 'uid-prof'
});

const chamar = (corpo: unknown, login = 'login-do-prof') => rotas().arquivo(new Request('https://leciona.vercel.app/api/arquivo', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login}` }, body: JSON.stringify(corpo)
}));

describe('anos anteriores: rota do servidor', () => {
  it('só aceita o login do professor', async () => {
    expect((await chamar({ acao: 'listar' }, 'qualquer-coisa')).status).toBe(401);
    expect((await chamar({ acao: 'listar' }, 'login-de-outro')).status).toBe(403);
    expect(await (await chamar({ acao: 'listar' })).json()).toEqual({ anos: [] });
  });

  it('guarda o ano, confere e devolve na lista e na leitura', async () => {
    const r = await chamar({ acao: 'guardar', ano: 2026, dados: ano2026() });
    expect(r.status).toBe(200);
    expect((await r.json()).guardado).toMatchObject({ ano: 2026, guardadoEm: '2026-12-18T15:00:00.000Z', resumo: { registrosDoDiario: 6, avaliacoes: 1, turmas: 3 } });

    const lista = await (await chamar({ acao: 'listar' })).json();
    expect(lista.anos.map((a: any) => a.ano)).toEqual([2026]);

    const lido = await (await chamar({ acao: 'ler', ano: 2026 })).json();
    expect(lido.dados.logs).toHaveLength(6);
    // Sem as marcas de sincronização do documento em uso
    expect(lido.dados).not.toHaveProperty('_deleted');
    expect(lido.dados).not.toHaveProperty('_fieldM');
    expect(lido.dados).not.toHaveProperty('updatedAt');
  });

  it('não troca um ano já guardado sem o professor confirmar', async () => {
    agora = new Date('2026-12-20T10:00:00Z');
    const vazio = { ...ano2026(), logs: [] };
    const r = await chamar({ acao: 'guardar', ano: 2026, dados: vazio });
    expect(r.status).toBe(409);
    expect((await r.json()).existente).toMatchObject({ ano: 2026, guardadoEm: '2026-12-18T15:00:00.000Z' });
    expect(guardados.get(2026).logs).toHaveLength(6);

    expect((await chamar({ acao: 'guardar', ano: 2026, dados: vazio, substituir: true })).status).toBe(200);
    expect(guardados.get(2026).logs).toHaveLength(0);
  });

  it('recusa pedido sem ano, dados incompletos, dados grandes demais e ano que não existe', async () => {
    expect((await chamar({ acao: 'guardar', dados: ano2026() })).status).toBe(400);
    expect((await chamar({ acao: 'guardar', ano: 2025, dados: { profile: {} } })).status).toBe(400);
    const enorme = { ...ano2026(), logs: [{ id: 'g', subject: 'x'.repeat(1100000) }] };
    expect((await chamar({ acao: 'guardar', ano: 2025, dados: enorme })).status).toBe(413);
    expect((await chamar({ acao: 'ler', ano: 2019 })).status).toBe(404);
    expect(guardados.has(2025)).toBe(false);
  });
});

describe('anos anteriores: consulta', () => {
  const dados = dadosDoArquivo(ano2026(), 2026, '2026-12-18T15:00:00.000Z') as any;

  it('lista as aulas em ordem de data, sem as removidas e sem janelas', () => {
    expect(archivedLessons(dados).map(l => l.id)).toEqual(['l1', 'l3', 'l4', 'l2']);
  });

  it('filtra por escola, turma (por código ou por nome) e texto sem acento', () => {
    expect(archivedLessons(dados, { schoolId: 'U' }).map(l => l.id)).toEqual(['l4']);
    expect(archivedLessons(dados, { schoolId: 'C', className: '183' }).map(l => l.id)).toEqual(['l1', 'l2']);
    expect(archivedLessons(dados, { className: '184' }).map(l => l.id)).toEqual(['l3']);
    expect(archivedLessons(dados, { search: 'revolucao' }).map(l => l.id)).toEqual(['l2']);
    expect(archivedLessons(dados, { search: 'capítulo 3' }).map(l => l.id)).toEqual(['l1']);
  });

  it('avaliações: só provas e trabalhos', () => {
    expect(archivedAssessments(dados).map(e => e.id)).toEqual(['p1']);
    expect(archivedClassNames(dados, 'C')).toEqual(['183', '184']);
  });
});

describe('virada depois de outra virada', () => {
  it('a marca nova é sempre mais nova que a anterior, mesmo com o relógio atrasado', () => {
    const dados = { ...ano2026(), _yearResetAt: '2027-01-05T10:00:00.000Z', _schoolYear: 2027 };
    const plano = defaultPlan(dados);
    const novo = buildNewSchoolYear(dados, plano, new Date('2026-12-31T10:00:00.000Z'));
    expect(novo._yearResetAt! > dados._yearResetAt).toBe(true);
  });
});
