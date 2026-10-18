import { tratar } from '../_lib/conector.js';

// Página de login (GET) e confirmação do login (POST)
export default {
  fetch: tratar(r => (req: Request) => (req.method === 'POST' ? r.autorizarPost(req) : r.autorizarGet(req)))
};
