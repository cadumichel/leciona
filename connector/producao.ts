import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { AppData } from '../types';
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
    }
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
