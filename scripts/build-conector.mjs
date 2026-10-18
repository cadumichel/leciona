// Empacota o código do conector (connector/ + utils do app) num único arquivo para as funções da Vercel.
// As funções em api/ importam api/_lib/conector.js; as bibliotecas (node_modules) ficam de fora do pacote.
import { build } from 'esbuild';

await build({
  entryPoints: ['connector/producao.ts'],
  outfile: 'api/_lib/conector.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  logLevel: 'info'
});
