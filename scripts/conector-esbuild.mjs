// Opções do empacotamento do conector, usadas pelo build e pelo teste que confere se o pacote está atualizado.
export const opcoesDoConector = {
  entryPoints: ['connector/producao.ts'],
  outfile: 'api/_lib/conector.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  legalComments: 'none'
};
