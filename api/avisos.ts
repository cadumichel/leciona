import { tratar } from './_lib/conector.js';

// Avisos no celular: conferência do agendador externo (a cada 5 min) e cadastro dos aparelhos
// (connector/avisosPush.ts)
export default {
  fetch: tratar(r => (req: Request) => (req.method === 'OPTIONS' ? r.opcoes() : r.avisos(req)))
};
