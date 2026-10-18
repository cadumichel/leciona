// Empacota o código do conector (connector/ + utils do app) em api/_lib/conector.js.
// Esse arquivo fica no repositório: a Vercel prepara as funções de api/ antes de rodar o build,
// então ele precisa existir já no commit. Rode `npm run build:conector` depois de mudar connector/ ou utils/
// (o teste tests/conectorPacote.test.ts avisa se esquecer).
import { build } from 'esbuild';
import { opcoesDoConector } from './conector-esbuild.mjs';

await build({ ...opcoesDoConector, logLevel: 'info' });
