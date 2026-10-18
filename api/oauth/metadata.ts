// /.well-known/oauth-protected-resource e /.well-known/oauth-authorization-server (ver vercel.json)
// O pacote é carregado aqui dentro para que uma falha ao carregar vire uma resposta legível
// (em vez de FUNCTION_INVOCATION_FAILED sem detalhes).
export default {
  async fetch(req: Request) {
    let conector: typeof import('../_lib/conector.js');
    try {
      conector = await import('../_lib/conector.js');
    } catch (e) {
      console.error(e);
      return Response.json({ error: 'server_error', error_description: `Falha ao carregar o conector (Node ${process.version}): ${(e as Error).message}` }, { status: 500 });
    }
    return conector.tratar(r => (req: Request) => {
      if (req.method === 'OPTIONS') return r.opcoes();
      return new URL(req.url).searchParams.get('tipo') === 'servidor' ? r.metadadosServidor(req) : r.metadadosRecurso(req);
    })(req);
  }
};
