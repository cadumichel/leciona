// Troca de código/renovação por token de acesso
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
    return conector.tratar(r => (req: Request) => (req.method === 'OPTIONS' ? r.opcoes() : r.token(req)))(req);
  }
};
