// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

// --- Firebase simulado: controlamos login, snapshots e o resultado de cada gravação ---
const fb = vi.hoisted(() => ({
  authCb: null as null | ((u: any) => void),
  snapCb: null as null | ((s: any) => void),
  setDoc: vi.fn(),
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
  onSnapshot: (_ref: any, cb: any) => { fb.snapCb = cb; return () => {}; },
  Timestamp: { now: () => ({ toDate: () => new Date('2026-10-17T12:00:00Z') }) }
}));

import { useSyncedData, STORAGE_KEY, PENDING_KEY } from '../hooks/useSyncedData';
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
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('sincronização (hooks/useSyncedData)', () => {
  it('SEM INTERNET: continua gravando no aparelho e nada se perde ao fechar e reabrir o app', async () => {
    fb.setDoc.mockImplementation(() => new Promise(() => {})); // offline: o envio nunca termina
    const first = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));

    act(() => first.result.current.updateData({ logs: [...first.result.current.data.logs, log('A')] }));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalledTimes(1));
    act(() => first.result.current.updateData({ logs: [...first.result.current.data.logs, log('B')] }));
    act(() => first.result.current.updateData({ logs: [...first.result.current.data.logs, log('C')] }));

    // Antes da correção, A ficava "travado" no envio e B e C não eram salvos em lugar nenhum
    await waitFor(() => expect(savedLocal().logs.map((l: any) => l.id)).toEqual(['L0', 'A', 'B', 'C']));
    expect(localStorage.getItem(PENDING_KEY)).toBe('1');
    expect(fb.setDoc).toHaveBeenCalledTimes(1); // não empilha envios na memória
    first.unmount();

    // Reabre o app com internet: a nuvem ainda tem só L0
    fb.setDoc.mockReset();
    fb.setDoc.mockImplementation(async () => {});
    const second = renderHook(() => useSyncedData(opts));
    await login();
    act(() => fb.snapCb!(snap(cloudDoc({ logs: [log('L0')] }))));
    await waitFor(() => expect(fb.setDoc).toHaveBeenCalled());
    expect(lastSetDocPayload().logs.map((l: any) => l.id).sort()).toEqual(['A', 'B', 'C', 'L0']);
    await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBe('0'));
    expect(second.result.current.data.logs).toHaveLength(4);
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
