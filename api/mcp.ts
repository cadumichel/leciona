import { tratar } from './_lib/conector.js';

// Servidor MCP do conector (exige login)
export default {
  fetch: tratar(r => (req: Request) => (req.method === 'OPTIONS' ? r.opcoes() : r.mcp(req)))
};
