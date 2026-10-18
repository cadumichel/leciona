import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { AppData } from '../types';
import { estimateDocBytes, FIRESTORE_DOC_LIMIT, removeUndefined } from '../utils/sync';
import { ConsultaError } from './consultas';
import { CAMPO_COPIA, InfoDaCopia } from './copias';
import { derivarChave } from './oauth';
import { criarRotas } from './servidor';

/**
 * Liga as rotas do conector ao Firebase de verdade, com as variáveis de ambiente da Vercel:
 * - FIREBASE_SERVICE_ACCOUNT: o JSON da credencial do Firebase Admin (nunca no código)
 * - LECIONA_EMAIL: a única conta Google com acesso
 */

const variavel = (nome: string) => {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável de ambiente ${nome} não configurada na Vercel.`);
  return valor;
};

let rotas: Promise<ReturnType<typeof criarRotas>> | undefined;

const montar = async () => {
  const credencial = JSON.parse(variavel('FIREBASE_SERVICE_ACCOUNT'));
  const emailPermitido = variavel('LECIONA_EMAIL');
  const app = getApps()[0] || initializeApp({ credential: cert(credencial) });
  const db = getFirestore(app);
  const usuario = (uid: string) => db.collection('users').doc(uid);
  const copias = (uid: string) => usuario(uid).collection('backups');
  let uidCache: string | undefined;

  return criarRotas({
    chave: await derivarChave(credencial.private_key),
    emailPermitido,
    verificarLogin: async idToken => {
      const t = await getAuth(app).verifyIdToken(idToken);
      return { uid: t.uid, email: t.email, email_verified: t.email_verified };
    },
    carregarDados: async uid => {
      const doc = await db.collection('users').doc(uid).get();
      if (!doc.exists) throw new Error('Documento do professor não encontrado.');
      return doc.data() as AppData;
    },
    alterarDados: (uid, calcular) => db.runTransaction(async tx => {
      const ref = db.collection('users').doc(uid);
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('Documento do professor não encontrado.');
      const raw = doc.data()!;
      const r = calcular(raw);
      const campos = removeUndefined(r.alteracoes);
      if (Object.keys(campos).length) {
        if (estimateDocBytes({ ...raw, ...campos }) > FIRESTORE_DOC_LIMIT * 0.95) {
          throw new ConsultaError('Os dados do Leciona estão perto do limite da nuvem (1 MB). Nada foi gravado.');
        }
        // updatedAt como o app grava; os outros aparelhos recebem e juntam item a item
        tx.update(ref, { ...campos, updatedAt: Timestamp.now() });
      }
      return r;
    }),
    substituirDados: (uid, calcular) => db.runTransaction(async tx => {
      const ref = usuario(uid);
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error('Documento do professor não encontrado.');
      const novo = removeUndefined(calcular(doc.data()));
      if (estimateDocBytes(novo) > FIRESTORE_DOC_LIMIT * 0.98) {
        throw new ConsultaError('A cópia é grande demais para o limite da nuvem (1 MB). Nada foi restaurado.');
      }
      tx.set(ref, { ...novo, updatedAt: Timestamp.now() });
    }),
    copias: {
      // Só o campo de informações (as cópias inteiras podem ter quase 1 MB cada)
      listar: async uid => (await copias(uid).select(CAMPO_COPIA).get()).docs
        .map(d => ({ id: d.id, ...(d.get(CAMPO_COPIA) || {}) }) as InfoDaCopia)
        .filter(c => c.criadaEm && c.resumo),
      ler: async (uid, id) => {
        const d = await copias(uid).doc(id).get();
        return d.exists ? d.data() : null;
      },
      gravar: async (uid, id, dados) => { await copias(uid).doc(id).set(removeUndefined(dados)); },
      apagar: async (uid, ids) => {
        const lote = db.batch();
        ids.forEach(id => lote.delete(copias(uid).doc(id)));
        await lote.commit();
      }
    },
    uidDoProfessor: async () => (uidCache ??= (await getAuth(app).getUserByEmail(emailPermitido)).uid),
    segredoDoCron: process.env.CRON_SECRET || undefined
  });
};

/** Rotas prontas (montadas uma vez por instância da função). */
export const obterRotas = () => {
  rotas ??= montar().catch(e => { rotas = undefined; throw e; });
  return rotas;
};

/** Embrulha um tratador: erro de configuração vira resposta 500 legível (sem detalhes sensíveis). */
export const tratar = (escolher: (r: Awaited<ReturnType<typeof obterRotas>>) => (req: Request) => Response | Promise<Response>) =>
  async (req: Request) => {
    try {
      return await escolher(await obterRotas())(req);
    } catch (e) {
      console.error(e);
      const configuracao = e instanceof Error && e.message.startsWith('Variável de ambiente');
      return Response.json(
        { error: 'server_error', error_description: configuracao ? e.message : 'Erro interno do conector.' },
        { status: 500 }
      );
    }
  };
