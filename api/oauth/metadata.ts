import { tratar } from '../_lib/conector.js';

// /.well-known/oauth-protected-resource e /.well-known/oauth-authorization-server (ver vercel.json)
export default {
  fetch: tratar(r => (req: Request) => {
    if (req.method === 'OPTIONS') return r.opcoes();
    return new URL(req.url).searchParams.get('tipo') === 'servidor' ? r.metadadosServidor(req) : r.metadadosRecurso(req);
  })
};
