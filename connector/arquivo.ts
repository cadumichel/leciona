import { estimateDocBytes, FIRESTORE_DOC_LIMIT } from '../utils/sync';
import { Resumo, resumoDosDados } from './copias';

/**
 * Anos anteriores: na virada do ano letivo o app guarda o ano que terminou em
 * users/{uid}/anos/{ano}, sem prazo para apagar. Só o servidor acessa (as regras do Firestore
 * bloqueiam o app), pela rota /api/arquivo com o login do app. O app só consulta (tela
 * "Anos anteriores", em Ajustes); nada do arquivo volta para os dados em uso.
 */

/** Campo com as informações do arquivo, guardado junto dos dados do ano. */
export const CAMPO_ARQUIVO = '_arquivo';

export interface InfoDoAno {
  ano: number;
  guardadoEm: string;
  resumo: Resumo;
}

export interface ArmazemDeAnos {
  listar: (uid: string) => Promise<InfoDoAno[]>;
  ler: (uid: string, ano: number) => Promise<any | null>;
  gravar: (uid: string, ano: number, dados: any) => Promise<void>;
}

export const anoValido = (ano: unknown): ano is number =>
  typeof ano === 'number' && Number.isInteger(ano) && ano >= 2000 && ano <= 2100;

/**
 * Dados prontos para arquivar: sem as marcas de sincronização do documento em uso (lápides de
 * exclusão, marcas de atualização), que não servem para consulta e ocupam espaço.
 */
export const dadosDoArquivo = (raw: any, ano: number, guardadoEm: string) => {
  const { updatedAt, _deleted, _fieldM, [CAMPO_ARQUIVO]: _antigo, ...dados } = raw || {};
  return { ...dados, [CAMPO_ARQUIVO]: { ano, guardadoEm, resumo: resumoDosDados(dados) } };
};

/** O que veio do app parece mesmo os dados do Leciona? (evita guardar um arquivo vazio ou errado) */
export const pareceDadosDoLeciona = (dados: any) =>
  !!dados && typeof dados === 'object' && !Array.isArray(dados) && Array.isArray(dados.schools) && Array.isArray(dados.logs);

export const cabeNoArquivo = (dados: any) => estimateDocBytes(dados) <= FIRESTORE_DOC_LIMIT * 0.98;

export const ordenarAnos = (anos: InfoDoAno[]) => [...anos].sort((a, b) => b.ano - a.ano);
