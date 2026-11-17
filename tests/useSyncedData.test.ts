// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

// --- Firebase simulado: controlamos login, snapshots e o resultado de cada gravação ---
const fb = vi.hoisted(() => ({
  authCb: null as null | ((u: any) => void),
  snapCb: null as null | ((s: any) => void),
  setDoc: vi.fn(),
  getDocFromServer: vi.fn(),
  signOut: vi.fn(async () => {})
}));

vi.mock('../services/firebaseConnection', () => ({ auth: {}, db: {}, googleProvider: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: any, cb: any) => { fb.authCb = cb; return () => {}; },
  signOut: (...args: any[]) => (fb.signOut as any)(...args)
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: any, ...path: string[]) => ({ path: path.join('/') }),
  setDoc: (...args: any[]) => fb.setDoc(...args),
  // Transação: lê o servidor (fb.getDocFromServer) e grava (fb.setDoc); falha de um dos dois = falha do envio
  runTransaction: async (_db: any, fn: any) => {
    const writes: any[][] = [];
    const result = await fn({ get: (ref: any) => fb.getDocFromServer(ref), set: (...args: any[]) => { writes.push(args); } });
    for (const w of writes) await fb.setDoc(...w);
    return result;
  },
  onSnapshot: (_ref: any, cb: any) => { fb.snapCb = cb; return () => {}; },
  Timestamp: { now: () => ({ toDate: () => new Date('2026-10-17T12:00:00Z') }) }
}));

import { useSyncedData, deduplicateLogs, STORAGE_KEY, PENDING_KEY, OWNER_KEY, stashKey } from '../hooks/useSyncedData';
import { setDialogListener } from '../utils/dialogs';
import { INITIAL_DATA } from '../initialData';

const USER = { uid: 'cadu', email: 'cadu@example.com' };
const snap = (data: any, opts: { fromCache?: boolean; pending?: boolean } = {}) => ({
  exists: () => data !== null,
  data: () => data,
  metadata: { fromCache: !!opts.fromCache, hasPendingWrites: !!opts.pending }
});
const cloudDoc = (over: any = {}) => ({ ...JSON.parse(JSON.stringify(INITIAL_DATA)), profile: { name: 'Cadu', subjects: [], setupCompleted: true }, ...over });
const log = (id: string, subject = 'conteúdo') => ({ id, date: '2026-10-16T00:00:00.000Z', schoolId: 'S1', classId: 'C1', slotId: 'slot-' + id, subject, homework: '', notes: '' });
const savedLocal = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
const lastSetDocPayload = () => fb.setDoc.mock.calls[fb.setDoc.mock.calls.length - 1][1];

const opts = { showError: vi.fn(), showWarning: vi.fn(), cloudDelayMs: 10, localDelayMs: 5, retryDelayMs: 40 };

const setOnline = (on: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => on });

const login = async () => {
  await waitFor(() => expect(fb.authCb).toBeTruthy());
  act(() => fb.authCb!(USER));
  await waitFor(() => expect(fb.snapCb).toBeTruthy());
};

beforeEach(() => {
  localStorage.clear();
  fb.authCb = null;
  fb.snapCb = null;
  fb.setDoc.mockReset();
  fb.setDoc.mockImplementation(async () => {});
  // Padrão: o servidor ainda não tem o documento, então o envio grava direto
  fb.getDocFromServer.mockReset();
  fb.getDocFromServer.mockImplementation(async () => snap(null));
  fb.signOut.mockClear();
  setOnline(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); setOnline(true); });

describe('sincronização (hooks/useSyncedData)', () => {
  it('SEM INTERNET: continua gravando no aparelho, nada vai para a fila e nada se perde ao reabrir o app', async () => {
    setOnline(false);
    const first = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));

    act(() => first.result.current.updateData({ logs: [...first.result.current.data.logs, log('A')] }));
    act(() => first.result.current.updateData({ logs: [...first.result.current.data.logs, log('B')] }));
    act(() => first.result.current.updateData({ logs: [...first.result.current.data.logs, log('C')] }));

    await waitFor(() => expect(savedLocal().logs.map((l: any) => l.id)).toEqual(['L0', 'A', 'B', 'C']));
    await new Promise(r => setTimeout(r, 60));
    expect(localStorage.getItem(PENDING_KEY)).toBe('1');
    // Nenhuma gravação fica esperando a conexão (era ela que passava por cima dos outros aparelhos)
    expect(fb.getDocFromServer).not.toHaveBeenCalled();
    expect(fb.setDoc).not.toHaveBeenCalled();
    expect(first.result.current.saveStatus).toBe('pending');
    first.unmount();

    // Reabre o app com internet: a nuvem ainda tem só L0
    setOnline(true);
    const second = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalled());
    expect(lastSetDocPayload().logs.map((l: any) => l.id).sort()).toEqual(['A', 'B', 'C', 'L0']);
    await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBe('0'));
    expect(second.result.current.data.logs).toHaveLength(4);
  });

  it('SEM INTERNET e outro aparelho gravou no meio: ao voltar a conexão junta, sem apagar nada', async () => {
    const hook = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));

    // Celular sem sinal: o professor registra uma aula
    setOnline(false);
    act(() => hook.result.current.updateData({ logs: [...hook.result.current.data.logs, log('CELULAR')] }));
    await new Promise(r => setTimeout(r, 60));
    expect(fb.setDoc).not.toHaveBeenCalled();

    // Enquanto isso, uma prova é cadastrada pelo computador (o celular não ficou sabendo)
    const comProva = cloudDoc({
      logs: [log('L0')],
      events: [{ id: 'prova-do-pc', type: 'test', schoolId: 'S1', classId: 'C1', date: '2026-10-20T00:00:00.000Z', title: 'P3', _m: 5 }]
    });
    fb.getDocFromServer.mockImplementation(async () => snap(comProva));

    // Voltou o sinal
    setOnline(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalled());
    for (const call of fb.setDoc.mock.calls) expect(call[1].events.map((e: any) => e.id)).toEqual(['prova-do-pc']);
    expect(lastSetDocPayload().logs.map((l: any) => l.id).sort()).toEqual(['CELULAR', 'L0']);
  });

  it('item apagado em outro aparelho não volta', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudDoc({ events: [{ id: 'P1', title: 'Prova', date: '2026-10-20T00:00:00.000Z', schoolId: 'S1', type: 'test' }], reminders: [{ id: 'R1', title: 'novo daqui' }] })));
    localStorage.setItem(PENDING_KEY, '1');
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ events: [], _deleted: { P1: Date.now() - 1000 } }))));
    await waitFor(() => expect(result.current.data.events).toHaveLength(0));
    expect(result.current.data.reminders.map((r: any) => r.id)).toEqual(['R1']); // o que é novo daqui fica
  });

  it('sem nada pendente no aparelho, a nuvem é a versão mais nova', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudDoc({ logs: [log('VELHO')] })));
    localStorage.setItem(PENDING_KEY, '0');
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('NOVO')] }))));
    await waitFor(() => expect(result.current.data.logs.map((l: any) => l.id)).toEqual(['NOVO']));
    expect(fb.setDoc).not.toHaveBeenCalled();
  });

  it('"não existe" vindo do cache (sem internet) não cria documento; do servidor, cria', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudDoc({ logs: [log('L1')] })));
    renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(null, { fromCache: true })));
    await new Promise(r => setTimeout(r, 60));
    expect(fb.setDoc).not.toHaveBeenCalled();

    act(() => fb.snapCb!(snap(null)));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalledTimes(1));
    expect(lastSetDocPayload().logs.map((l: any) => l.id)).toEqual(['L1']);
  });

  it('nuvem vazia não apaga os dados do aparelho', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudDoc({ schools: [{ id: 'S1', name: 'Cônsul', classes: [], shifts: [], subjects: [], color: '#000' }] })));
    localStorage.setItem(PENDING_KEY, '0');
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc())));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalled());
    expect(result.current.data.schools).toHaveLength(1);
    expect(lastSetDocPayload().schools).toHaveLength(1);
  });

  it('restaurar backup grava no aparelho e na nuvem antes de terminar', async () => {
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('ATUAL')] }))));
    await waitFor(() => expect(result.current.data.logs).toHaveLength(1));

    await act(async () => { await result.current.restoreData(cloudDoc({ logs: [log('DO_BACKUP')] }) as any); });
    expect(savedLocal().logs.map((l: any) => l.id)).toEqual(['DO_BACKUP']);
    expect(lastSetDocPayload().logs.map((l: any) => l.id)).toEqual(['DO_BACKUP']);
    expect(lastSetDocPayload()._deleted).toHaveProperty('ATUAL');
  });

  it('"Excluir todos os dados" em outro aparelho é aplicado uma única vez', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudDoc({ logs: [log('L1')] })));
    localStorage.setItem(PENDING_KEY, '1');
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap({ ...cloudDoc(), wiped: true, wipedAt: '2026-10-17T10:00:00.000Z', _wipedAt: '2026-10-17T10:00:00.000Z' })));
    await waitFor(() => expect(result.current.data.logs).toHaveLength(0));

    // Depois o outro aparelho volta a cadastrar coisas: aqui não apaga de novo
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('NOVO')], _wipedAt: '2026-10-17T10:00:00.000Z' }))));
    await waitFor(() => expect(result.current.data.logs.map((l: any) => l.id)).toEqual(['NOVO']));
  });

  it('falha no envio tenta de novo sozinho', async () => {
    fb.setDoc.mockImplementationOnce(async () => { throw Object.assign(new Error('unavailable'), { code: 'unavailable' }); });
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc())));
    act(() => result.current.updateData({ logs: [log('A')] }));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'));
  });

  it('avisos de conta: sabe quando está desconectado e desde quando a gravação falha', async () => {
    const { result } = renderHook(() => useSyncedData(opts));
    expect(result.current.authReady).toBe(false); // ainda não sabe: não mostra aviso antes da hora
    await waitFor(() => expect(fb.authCb).toBeTruthy());
    act(() => fb.authCb!(null));
    expect(result.current.authReady).toBe(true);
    expect(result.current.user).toBeNull();

    // Conectado, mas a nuvem recusa: marca o início da falha e mantém enquanto continuar falhando
    fb.setDoc.mockImplementation(async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); });
    act(() => fb.authCb!(USER));
    await waitFor(() => expect(fb.snapCb).toBeTruthy());
    act(() => fb.snapCb!(snap(cloudDoc())));
    act(() => result.current.updateData({ logs: [log('A')] }));
    await waitFor(() => expect(result.current.errorSince).not.toBeNull());
    const since = result.current.errorSince;
    await waitFor(() => expect(fb.setDoc.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(result.current.errorSince).toBe(since);

    // Voltou a gravar: some o aviso
    fb.setDoc.mockImplementation(async () => {});
    await waitFor(() => expect(result.current.saveStatus).toBe('saved'), { timeout: 2000 });
    expect(result.current.errorSince).toBeNull();
  });

  it('dado novo de outro aparelho chegando enquanto há edição local: fica com os dois', async () => {
    fb.setDoc.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc())));
    act(() => result.current.updateData({ logs: [log('DAQUI')] }));
    act(() => fb.snapCb!(snap(cloudDoc({ reminders: [{ id: 'R-PC', title: 'criado no PC' }] }))));
    await waitFor(() => expect(result.current.data.reminders).toHaveLength(1));
    expect(result.current.data.logs.map((l: any) => l.id)).toEqual(['DAQUI']);
  });
});

describe('virada do ano letivo entre aparelhos', () => {
  it('outro aparelho aplica a virada uma vez, sem juntar com o ano anterior', async () => {
    // Aparelho com 2026 e até uma edição pendente
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudDoc({ logs: [log('L2026')], events: [{ id: 'P2026', date: '2026-10-20T00:00:00.000Z', schoolId: 'S1', type: 'test', title: 'Prova' }] })));
    localStorage.setItem(PENDING_KEY, '1');
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    const mark = '2026-12-20T15:00:00.000Z';
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [], events: [], _schoolYear: 2027, _yearResetAt: mark }))));
    await waitFor(() => expect(result.current.data._schoolYear).toBe(2027));
    expect(result.current.data.logs).toHaveLength(0);
    expect(result.current.data.events).toHaveLength(0);
    expect(localStorage.getItem('leciona-year-reset-seen')).toBe(mark);

    // Depois, aulas novas de 2027 chegam normalmente (não aplica a virada de novo)
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L2027')], _schoolYear: 2027, _yearResetAt: mark }))));
    await waitFor(() => expect(result.current.data.logs.map((l: any) => l.id)).toEqual(['L2027']));
  });

  it('o aparelho que faz a virada grava no aparelho e na nuvem', async () => {
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L2026')] }))));
    await waitFor(() => expect(result.current.data.logs).toHaveLength(1));

    const newYear = { ...cloudDoc(), logs: [], _schoolYear: 2027, _yearResetAt: '2026-12-20T15:00:00.000Z' } as any;
    let synced = false;
    await act(async () => { synced = await result.current.startNewSchoolYear(newYear); });
    expect(synced).toBe(true);
    expect(savedLocal()._schoolYear).toBe(2027);
    expect(lastSetDocPayload()._yearResetAt).toBe('2026-12-20T15:00:00.000Z');
    expect(lastSetDocPayload().logs).toEqual([]);
    expect(localStorage.getItem('leciona-year-reset-seen')).toBe('2026-12-20T15:00:00.000Z');
  });
});

describe('gravação do app não apaga o que outro aparelho ou o conector gravou', () => {
  it('se a nuvem mudou e o app ainda não viu, junta antes de enviar', async () => {
    const hook = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));

    // O conector grava uma prova na nuvem; o app (em segundo plano) não recebeu o aviso
    const comProva = cloudDoc({
      logs: [log('L0')],
      events: [{ id: 'prova-do-claude', type: 'test', schoolId: 'S1', classId: 'C1', date: '2026-10-20T00:00:00.000Z', title: 'P3', _m: 5 }]
    });
    fb.getDocFromServer.mockImplementation(async () => snap(comProva));

    // O professor edita no app
    act(() => hook.result.current.updateData({ logs: [...hook.result.current.data.logs, log('A')] }));

    await waitFor(() => expect(fb.setDoc).toHaveBeenCalled());
    const enviado = lastSetDocPayload();
    expect(enviado.events.map((e: any) => e.id)).toEqual(['prova-do-claude']);
    expect(enviado.logs.map((l: any) => l.id).sort()).toEqual(['A', 'L0']);
    expect(hook.result.current.data.events.map((e: any) => e.id)).toEqual(['prova-do-claude']);
  });

  it('sem novidade na nuvem, envia direto (uma consulta, uma gravação)', async () => {
    const hook = renderHook(() => useSyncedData(opts));
    await login();
    const nuvem = cloudDoc({ logs: [log('L0')] });
    act(() => fb.snapCb!(snap(nuvem)));
    fb.getDocFromServer.mockImplementation(async () => snap(nuvem));
    act(() => hook.result.current.updateData({ logs: [...hook.result.current.data.logs, log('A')] }));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalledTimes(1));
    expect(lastSetDocPayload().logs.map((l: any) => l.id)).toEqual(['L0', 'A']);
  });
});

describe('sair da conta e troca de conta no mesmo aparelho', () => {
  const OUTRO = { uid: 'colega', email: 'colega@example.com' };
  afterEach(() => setDialogListener(null));
  const answer = (ok: boolean) => setDialogListener(req => { if (req.kind === 'confirm') req.resolve(ok); });

  it('sair com tudo enviado: os dados saem do aparelho', async () => {
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));
    await waitFor(() => expect(result.current.data.logs).toHaveLength(1));
    expect(localStorage.getItem(OWNER_KEY)).toBe('cadu');

    await act(async () => { await result.current.logout(); });
    expect(fb.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.data.logs).toHaveLength(0);
    expect(result.current.data.profile.setupCompleted).toBeFalsy();
    await new Promise(r => setTimeout(r, 30));
    expect(JSON.stringify(localStorage)).not.toContain('"L0"');
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it('sair com alteração pendente: envia antes e só então limpa', async () => {
    const { result } = renderHook(() => useSyncedData({ ...opts, cloudDelayMs: 5000 }));
    await login();
    const nuvem = cloudDoc({ logs: [log('L0')] });
    act(() => fb.snapCb!(snap(nuvem)));
    fb.getDocFromServer.mockImplementation(async () => snap(nuvem));
    act(() => result.current.updateData({ logs: [...result.current.data.logs, log('A')] }));

    await act(async () => { await result.current.logout(); });
    expect(lastSetDocPayload().logs.map((l: any) => l.id)).toEqual(['L0', 'A']);
    expect(fb.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.data.logs).toHaveLength(0);
  });

  it('sair sem conseguir enviar: pergunta; cancelando, continua conectado com os dados', async () => {
    setOnline(false);
    answer(false);
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));
    act(() => result.current.updateData({ logs: [...result.current.data.logs, log('A')] }));

    await act(async () => { await result.current.logout(); });
    expect(fb.signOut).not.toHaveBeenCalled();
    expect(result.current.data.logs.map((l: any) => l.id)).toEqual(['L0', 'A']);
  });

  it('sair sem conseguir enviar e confirmar: fica guardado e volta quando a mesma conta entra', async () => {
    setOnline(false);
    answer(true);
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));
    act(() => result.current.updateData({ logs: [...result.current.data.logs, log('A')] }));

    await act(async () => { await result.current.logout(); });
    expect(fb.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.data.logs).toHaveLength(0); // nada na tela para quem usar depois
    expect(localStorage.getItem(stashKey('cadu'))).toContain('"A"');

    // Um colega entra no meio: não vê nem recebe nada
    setOnline(true);
    act(() => fb.authCb!(OUTRO));
    act(() => fb.snapCb!(snap(null)));
    await new Promise(r => setTimeout(r, 60));
    for (const call of fb.setDoc.mock.calls) expect(call[1].logs).toEqual([]);
    expect(result.current.data.logs).toHaveLength(0);
    await act(async () => { await result.current.logout(); });
    fb.setDoc.mockClear();

    // O dono volta: a alteração guardada reaparece e é enviada
    act(() => fb.authCb!(USER));
    await waitFor(() => expect(result.current.data.logs.map((l: any) => l.id)).toEqual(['L0', 'A']));
    expect(localStorage.getItem(stashKey('cadu'))).toBeNull();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalled());
    expect(fb.setDoc.mock.calls[0][0].path).toBe('users/cadu');
    expect(lastSetDocPayload().logs.map((l: any) => l.id).sort()).toEqual(['A', 'L0']);
  });

  it('outra conta entra num aparelho com dados de alguém: os dados não vão para a conta nova', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudDoc({ logs: [log('DO-CADU')], students: [{ id: 'al1', name: 'Aluno Inventado' }] })));
    localStorage.setItem(PENDING_KEY, '0');
    localStorage.setItem(OWNER_KEY, 'cadu');
    const { result } = renderHook(() => useSyncedData(opts));
    await waitFor(() => expect(fb.authCb).toBeTruthy());
    act(() => fb.authCb!(OUTRO));
    expect(result.current.data.logs).toHaveLength(0);
    expect(result.current.data.students).toHaveLength(0);

    // Primeiro uso da conta nova: o documento criado não leva nada do dono anterior
    act(() => fb.snapCb!(snap(null)));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalled());
    expect(fb.setDoc.mock.calls[0][0].path).toBe('users/colega');
    expect(JSON.stringify(lastSetDocPayload())).not.toContain('DO-CADU');
    expect(JSON.stringify(lastSetDocPayload())).not.toContain('Aluno Inventado');
    expect(localStorage.getItem(OWNER_KEY)).toBe('colega');
  });

  it('aparelho sem dono marcado (instalação antiga ou uso antes de entrar): a conta que entra fica com os dados', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudDoc({ logs: [log('L1')] })));
    const { result } = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(null)));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalled());
    expect(lastSetDocPayload().logs.map((l: any) => l.id)).toEqual(['L1']);
    expect(result.current.data.logs).toHaveLength(1);
  });
});

describe('mesma aula registrada em dois aparelhos', () => {
  const dup = (id: string, over: any) => ({ id, date: '2026-10-16T00:00:00.000Z', schoolId: 'S1', classId: 'C1', slotId: 's1', subject: '', homework: '', notes: '', ...over });

  it('os textos diferentes são juntados no registro que fica', () => {
    const out = deduplicateLogs([
      dup('a', { subject: 'Revolução Francesa', homework: 'Ler p. 40' }),
      dup('b', { subject: 'Queda da Bastilha', notes: 'Turma agitada' })
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
    expect(out[0].subject).toBe('Revolução Francesa\nQueda da Bastilha');
    expect(out[0].homework).toBe('Ler p. 40');
    expect(out[0].notes).toBe('Turma agitada');
  });

  it('texto igual ou já contido não é repetido, e juntar de novo não muda nada', () => {
    const once = deduplicateLogs([dup('a', { subject: 'Revolução Francesa: causas' }), dup('b', { subject: 'Revolução Francesa' })]);
    expect(once).toHaveLength(1);
    expect(once[0].subject).toBe('Revolução Francesa: causas');
    const joined = deduplicateLogs([dup('a', { subject: 'Iluminismo', homework: 'x' }), dup('b', { subject: 'Voltaire' })]);
    const again = deduplicateLogs([joined[0], dup('b', { subject: 'Voltaire' })]);
    expect(again[0].subject).toBe('Iluminismo\nVoltaire');
  });

  it('o registro automático "Avaliação: X" não é misturado ao texto do professor', () => {
    const out = deduplicateLogs([dup('a', { subject: 'Avaliação: P3' }), dup('b', { subject: 'Correção da prova', homework: 'Refazer a 5' })]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('b');
    expect(out[0].subject).toBe('Correção da prova');
  });

  it('aulas diferentes não são tocadas', () => {
    const logs = [dup('a', { subject: 'x' }), dup('b', { subject: 'y', slotId: 's2' })];
    expect(deduplicateLogs(logs)).toBe(logs);
  });
});
