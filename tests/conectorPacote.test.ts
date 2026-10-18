import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, type BuildOptions } from 'esbuild';
// @ts-ignore: módulo .mjs sem tipos
import { opcoesDoConector } from '../scripts/conector-esbuild.mjs';

describe('conector: pacote para a Vercel', () => {
  it('api/_lib/conector.js está atualizado (senão rode: npm run build:conector)', async () => {
    const r = await build({ ...(opcoesDoConector as BuildOptions), write: false });
    const gerado = r.outputFiles[0].text;
    const noRepositorio = readFileSync(opcoesDoConector.outfile, 'utf8').replace(/\r\n/g, '\n');
    expect(noRepositorio === gerado).toBe(true);
  });
});
