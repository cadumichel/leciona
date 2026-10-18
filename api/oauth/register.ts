import { tratar } from '../_lib/conector.js';

export default {
  fetch: tratar(r => (req: Request) => (req.method === 'OPTIONS' ? r.opcoes() : r.registrar(req)))
};
