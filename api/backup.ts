import { tratar } from './_lib/conector.js';

// Cópia diária automática (Vercel Cron, ver vercel.json)
export default {
  fetch: tratar(r => r.copiaDiaria)
};
