import { AppData } from '../types';
import { deepEqual } from '../utils';

/**
 * Sincronização entre aparelhos.
 *
 * Problemas que este módulo resolve (versão anterior em App.tsx):
 * 1. Itens apagados em um aparelho voltavam pelo outro, porque um item que só existia
 *    na cópia local era sempre mantido. Agora toda exclusão deixa uma "lápide" (_deleted)
 *    que viaja junto com os dados.
 * 2. Edições feitas sem internet em registros já existentes eram descartadas, porque a
 *    nuvem sempre vencia. Agora cada item editado recebe a hora da edição (_m) e vence a
 *    versão editada por último.
 */

/** Coleções sincronizadas item a item (todas têm `id`). */
export const SYNCED_COLLECTIONS = [
  'schools', 'students', 'classRecords', 'schedules', 'scheduleVersions', 'logs', 'events',
  'calendars', 'reminders', 'grades', 'customAssessments', 'gradingConfigs'
] as const;

export type SyncedCollection = typeof SYNCED_COLLECTIONS[number];

/** Campos que são um objeto único (não lista). */
const SINGLE_FIELDS = ['profile', 'settings'] as const;

/** Lápides são guardadas por este tempo e depois descartadas (para não crescer para sempre). */
export const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

type Item = { id: string; _m?: number; deleted?: boolean; [k: string]: any };
export type Tombstones = Record<string, number>;

export interface SyncMeta {
  /** id → quando foi apagado (epoch ms) */
  _deleted?: Tombstones;
  /** campo único → quando foi alterado (epoch ms) */
  _fieldM?: Partial<Record<typeof SINGLE_FIELDS[number], number>>;
  /** marca de "Excluir todos os dados" */
  _wipedAt?: string;
  /** marca da virada do ano letivo (cada aparelho aplica uma vez) */
  _yearResetAt?: string;
  /** ano letivo em uso */
  _schoolYear?: number;
}

export type SyncedData = AppData & SyncMeta;

const withoutM = (item: any) => {
  if (!item || typeof item !== 'object') return item;
  const { _m, ...rest } = item;
  return rest;
};

/**
 * Compara o estado anterior com o novo (após uma alteração feita no app) e registra:
 * - itens alterados → `_m` = agora
 * - itens removidos → lápide em `_deleted`
 * - itens recriados com um id que tinha lápide → remove a lápide
 * - profile/settings alterados → `_fieldM`
 * Itens que não mudaram mantêm a mesma referência (os componentes fazem map/filter).
 */
export const trackChanges = (prev: SyncedData, next: SyncedData, now: number = Date.now()): SyncedData => {
  let tombstones: Tombstones | undefined = next._deleted ?? prev._deleted;
  let tombstonesCopied = false;
  const ensureTombstones = () => {
    if (!tombstonesCopied) {
      tombstones = { ...(tombstones || {}) };
      tombstonesCopied = true;
    }
    return tombstones!;
  };

  const result: any = { ...next };

  for (const key of SYNCED_COLLECTIONS) {
    const prevArr = ((prev as any)[key] || []) as Item[];
    const nextArr = ((next as any)[key] || []) as Item[];
    if (prevArr === nextArr) continue;

    const prevById = new Map<string, Item>();
    prevArr.forEach(it => it && it.id && prevById.set(it.id, it));
    const nextIds = new Set<string>();

    let changed = false;
    const stamped = nextArr.map(it => {
      if (!it || !it.id) return it;
      nextIds.add(it.id);
      if (tombstones && tombstones[it.id] !== undefined) {
        delete ensureTombstones()[it.id];
      }
      const before = prevById.get(it.id);
      if (before && before !== it && !deepEqual(withoutM(before), withoutM(it))) {
        changed = true;
        return { ...it, _m: now };
      }
      return it;
    });
    if (changed) result[key] = stamped;

    prevById.forEach((_, id) => {
      if (!nextIds.has(id)) ensureTombstones()[id] = now;
    });
  }

  let fieldM = next._fieldM ?? prev._fieldM;
  for (const field of SINGLE_FIELDS) {
    const a = (prev as any)[field];
    const b = (next as any)[field];
    if (a !== b && !deepEqual(a, b)) {
      fieldM = { ...(fieldM || {}), [field]: now };
    }
  }
  if (fieldM) result._fieldM = fieldM;
  if (tombstones && Object.keys(tombstones).length > 0) result._deleted = tombstones;
  else delete result._deleted;

  return result as SyncedData;
};

/** Junta as lápides dos dois lados (fica a mais recente) e descarta as vencidas. */
export const mergeTombstones = (a: Tombstones = {}, b: Tombstones = {}, now: number = Date.now()): Tombstones => {
  const out: Tombstones = {};
  const add = (src: Tombstones) => {
    for (const [id, t] of Object.entries(src)) {
      if (now - t > TOMBSTONE_TTL_MS) continue;
      if (out[id] === undefined || t > out[id]) out[id] = t;
    }
  };
  add(a);
  add(b);
  return out;
};

/** Junta uma coleção da nuvem com a local: vence a edição mais recente; lápides removem. */
export const mergeCollection = <T extends Item>(cloudArr: T[] = [], localArr: T[] = [], tombstones: Tombstones = {}): T[] => {
  const map = new Map<string, T>();
  cloudArr.forEach(item => item && item.id && map.set(item.id, item));

  localArr.forEach(local => {
    if (!local || !local.id) return;
    const cloud = map.get(local.id);
    if (!cloud) {
      map.set(local.id, local);
      return;
    }
    const lm = local._m ?? 0;
    const cm = cloud._m ?? 0;
    if (lm > cm) {
      map.set(local.id, local);
    } else if (lm === 0 && cm === 0 && local.deleted && !cloud.deleted) {
      // Dados antigos sem carimbo: mantém a regra anterior (exclusão local pendente vence)
      map.set(local.id, local);
    }
  });

  const out: T[] = [];
  map.forEach((item, id) => {
    const deletedAt = tombstones[id];
    if (deletedAt !== undefined && (item._m ?? 0) <= deletedAt) return;
    out.push(item);
  });

  // Itens antigos sem id (raros, da grade legada): não dá para casar item a item; mantém os da nuvem
  const cloudNoId = cloudArr.filter(i => i && !i.id);
  out.push(...(cloudNoId.length > 0 ? cloudNoId : localArr.filter(i => i && !i.id)));
  return out;
};

/** Junta os dados completos da nuvem com os locais. */
export const mergeAppData = (cloud: SyncedData, local: SyncedData, now: number = Date.now()): SyncedData => {
  const tombstones = mergeTombstones(cloud._deleted, local._deleted, now);
  const merged: any = { ...cloud };

  for (const key of SYNCED_COLLECTIONS) {
    merged[key] = mergeCollection((cloud as any)[key] || [], (local as any)[key] || [], tombstones);
  }

  const cloudFieldM = cloud._fieldM || {};
  const localFieldM = local._fieldM || {};
  const fieldM: any = { ...cloudFieldM };
  for (const field of SINGLE_FIELDS) {
    if ((localFieldM[field] ?? 0) > (cloudFieldM[field] ?? 0) && (local as any)[field]) {
      merged[field] = (local as any)[field];
      fieldM[field] = localFieldM[field];
    }
  }
  if (Object.keys(fieldM).length > 0) merged._fieldM = fieldM;

  if (Object.keys(tombstones).length > 0) merged._deleted = tombstones;
  else delete merged._deleted;

  return merged as SyncedData;
};

/**
 * Restaurar backup: o backup substitui tudo. Itens que existem agora e não estão no backup
 * ganham lápide, para não voltarem pelos outros aparelhos.
 */
export const prepareRestore = (current: SyncedData, backup: SyncedData, now: number = Date.now()): SyncedData => {
  const tombstones: Tombstones = { ...(backup._deleted || {}) };
  for (const key of SYNCED_COLLECTIONS) {
    const keep = new Set((((backup as any)[key] || []) as Item[]).map(i => i && i.id));
    (((current as any)[key] || []) as Item[]).forEach(i => {
      if (i && i.id && !keep.has(i.id)) tombstones[i.id] = now;
    });
  }
  const restored: any = { ...backup };
  // Itens do backup passam a valer como "editados agora" para vencerem cópias antigas
  for (const key of SYNCED_COLLECTIONS) {
    restored[key] = (((backup as any)[key] || []) as Item[]).map(i => (i && i.id ? { ...i, _m: now } : i));
  }
  restored._fieldM = { profile: now, settings: now };
  if (Object.keys(tombstones).length > 0) restored._deleted = tombstones;
  return restored as SyncedData;
};

/** Remove `undefined` (o Firestore não aceita) mantendo o resto. */
export const removeUndefined = (obj: any): any => {
  if (obj === undefined) return undefined;
  if (obj === null) return null;
  if (Array.isArray(obj)) return obj.map(removeUndefined).filter(v => v !== undefined);
  if (typeof obj === 'object' && obj.constructor === Object) {
    const out: any = {};
    for (const k of Object.keys(obj)) {
      const v = removeUndefined(obj[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return obj;
};

/** Forma normalizada (como JSON) para comparar o que está local com o que está na nuvem. */
export const normalizeForCompare = (data: any) => JSON.parse(JSON.stringify(removeUndefined(data)));

/** Tamanho aproximado do documento no Firestore (o limite é 1 MiB). */
export const estimateDocBytes = (data: any) => new Blob([JSON.stringify(data)]).size;
export const FIRESTORE_DOC_LIMIT = 1048576;
