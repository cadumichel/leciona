import { tratar } from './_lib/conector.js';

// Anos anteriores: guardar o ano na virada e consultar depois (connector/arquivo.ts)
export default {
  fetch: tratar(r => (req: Request) => (req.method === 'OPTIONS' ? r.opcoes() : r.arquivo(req)))
};
