// connector/producao.ts
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// connector/oauth.ts
import { SignJWT, jwtVerify, base64url } from "jose";
var ESCOPO = "leciona";
var DURACAO_CODIGO = 5 * 60;
var DURACAO_ACESSO = 60 * 60;
var DURACAO_RENOVACAO = 30 * 24 * 60 * 60;
var redirecionamentoPermitido = (uri) => {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:" && ["claude.ai", "claude.com"].includes(url.hostname)) {
    return url.pathname === "/api/mcp/auth_callback";
  }
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
};
var urlsDoServidor = (origem) => ({
  emissor: origem,
  recurso: `${origem}/api/mcp`,
  autorizar: `${origem}/api/oauth/authorize`,
  token: `${origem}/api/oauth/token`,
  registro: `${origem}/api/oauth/register`,
  metadadosRecurso: `${origem}/.well-known/oauth-protected-resource`
});
var metadadosDoRecurso = (origem) => {
  const u = urlsDoServidor(origem);
  return {
    resource: u.recurso,
    authorization_servers: [u.emissor],
    scopes_supported: [ESCOPO],
    bearer_methods_supported: ["header"],
    resource_name: "Leciona"
  };
};
var metadadosDoServidor = (origem) => {
  const u = urlsDoServidor(origem);
  return {
    issuer: u.emissor,
    authorization_endpoint: u.autorizar,
    token_endpoint: u.token,
    registration_endpoint: u.registro,
    scopes_supported: [ESCOPO],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true
  };
};
var ErroOAuth = class extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
  }
};
var validarPedido = (p, origem) => {
  if (!p.client_id) throw new ErroOAuth("invalid_request", "Falta client_id.");
  if (!p.redirect_uri || !redirecionamentoPermitido(p.redirect_uri)) {
    throw new ErroOAuth("invalid_request", "Endere\xE7o de retorno n\xE3o permitido.");
  }
  if (p.response_type !== "code") throw new ErroOAuth("unsupported_response_type", "Use response_type=code.");
  if (!p.code_challenge || p.code_challenge_method !== "S256") {
    throw new ErroOAuth("invalid_request", "PKCE (S256) \xE9 obrigat\xF3rio.");
  }
  if (p.resource && p.resource !== urlsDoServidor(origem).recurso) {
    throw new ErroOAuth("invalid_target", "Recurso desconhecido.");
  }
  return {
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    state: p.state,
    resource: p.resource,
    scope: p.scope
  };
};
var emitir = (a, tipo, dados, sub, duracao) => {
  const agora = Math.floor((a.agora ?? /* @__PURE__ */ new Date()).getTime() / 1e3);
  return new SignJWT({ ...dados, tipo }).setProtectedHeader({ alg: "HS256" }).setIssuer(a.origem).setAudience(urlsDoServidor(a.origem).recurso).setSubject(sub).setIssuedAt(agora).setExpirationTime(agora + duracao).sign(a.chave);
};
var ler = async (a, tipo, token) => {
  try {
    const { payload } = await jwtVerify(token, a.chave, {
      issuer: a.origem,
      audience: urlsDoServidor(a.origem).recurso,
      algorithms: ["HS256"],
      currentDate: a.agora
    });
    if (payload.tipo !== tipo || !payload.sub) throw new Error("tipo");
    return payload;
  } catch {
    return null;
  }
};
var emitirCodigo = (a, pedido, conta) => emitir(a, "codigo", {
  email: conta.email,
  cid: pedido.client_id,
  ru: pedido.redirect_uri,
  cc: pedido.code_challenge
}, conta.uid, DURACAO_CODIGO);
var emitirPar = async (a, conta) => ({
  access_token: await emitir(a, "acesso", { email: conta.email, scope: ESCOPO }, conta.uid, DURACAO_ACESSO),
  token_type: "Bearer",
  expires_in: DURACAO_ACESSO,
  refresh_token: await emitir(a, "renovacao", { email: conta.email }, conta.uid, DURACAO_RENOVACAO),
  scope: ESCOPO
});
var desafioPKCE = async (verificador) => base64url.encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador))));
var mesmoEmail = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
var trocarToken = async (a, emailPermitido, p) => {
  if (p.grant_type === "authorization_code") {
    const codigo = p.code && await ler(a, "codigo", p.code);
    if (!codigo) throw new ErroOAuth("invalid_grant", "C\xF3digo inv\xE1lido ou vencido.");
    if (p.redirect_uri !== codigo.ru) throw new ErroOAuth("invalid_grant", "redirect_uri diferente do pedido.");
    if (p.client_id && p.client_id !== codigo.cid) throw new ErroOAuth("invalid_grant", "client_id diferente do pedido.");
    if (!p.code_verifier || await desafioPKCE(p.code_verifier) !== codigo.cc) {
      throw new ErroOAuth("invalid_grant", "Verifica\xE7\xE3o PKCE falhou.");
    }
    if (!mesmoEmail(codigo.email, emailPermitido)) throw new ErroOAuth("invalid_grant", "Conta sem acesso.");
    return emitirPar(a, { uid: codigo.sub, email: codigo.email });
  }
  if (p.grant_type === "refresh_token") {
    const renovacao = p.refresh_token && await ler(a, "renovacao", p.refresh_token);
    if (!renovacao) throw new ErroOAuth("invalid_grant", "Token de renova\xE7\xE3o inv\xE1lido ou vencido.");
    if (!mesmoEmail(renovacao.email, emailPermitido)) throw new ErroOAuth("invalid_grant", "Conta sem acesso.");
    return emitirPar(a, { uid: renovacao.sub, email: renovacao.email });
  }
  throw new ErroOAuth("unsupported_grant_type", "Tipo de concess\xE3o n\xE3o suportado.");
};
var verificarAcesso = async (a, emailPermitido, cabecalho) => {
  const token = cabecalho?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const acesso = await ler(a, "acesso", token);
  if (!acesso || !mesmoEmail(acesso.email, emailPermitido)) return null;
  return { uid: acesso.sub, email: acesso.email };
};
var registrarCliente = (corpo) => {
  const uris = corpo?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || !uris.every((u) => typeof u === "string" && redirecionamentoPermitido(u))) {
    throw new ErroOAuth("invalid_redirect_uri", "Endere\xE7o de retorno n\xE3o permitido.");
  }
  return {
    client_id: `leciona-${crypto.randomUUID()}`,
    client_id_issued_at: Math.floor(Date.now() / 1e3),
    client_name: typeof corpo.client_name === "string" ? corpo.client_name : void 0,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none"
  };
};
var derivarChave = async (segredo) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`leciona-conector-v1:${segredo}`)));

// connector/servidor.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

// constants.ts
var BRAZIL_HOLIDAYS = {
  "01-01": "Ano Novo",
  "04-21": "Tiradentes",
  "05-01": "Trabalhador",
  "09-07": "Independ\xEAncia",
  "10-12": "Aparecida",
  "11-02": "Finados",
  "11-15": "Proclama\xE7\xE3o",
  "11-20": "Consci\xEAncia",
  "12-25": "Natal"
};

// utils.ts
var getSafeDate = (dateStr) => {
  if (!dateStr) return /* @__PURE__ */ new Date();
  if (/T00:00:00(\.000)?Z$/.test(dateStr)) return /* @__PURE__ */ new Date(`${dateStr.split("T")[0]}T12:00:00`);
  const cleanDateStr = dateStr.includes("T") ? dateStr : `${dateStr}T12:00:00`;
  return new Date(cleanDateStr);
};
var getHolidayName = (date) => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const key = `${month}-${day}`;
  return BRAZIL_HOLIDAYS[key] || null;
};
var parseTimeToMinutes = (time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
var formatDateBR = (dateStr) => {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("T")[0].split("-");
  if (!y || !m || !d) return String(dateStr);
  return `${d}/${m}/${y}`;
};

// utils/classRefs.ts
var idOf = (c) => typeof c === "string" ? c : c.id;
var nameOf = (c) => typeof c === "string" ? c : c.name;
var isDeleted = (c) => typeof c !== "string" && !!c.deleted;
var SPECIAL_CLASS_REFS = /* @__PURE__ */ new Set(["", "window"]);
var findInSchool = (school, ref) => {
  if (!school || !school.classes) return void 0;
  const classes = school.classes;
  const byId = classes.find((c) => String(idOf(c)).trim() === ref);
  if (byId) return byId;
  const byName = classes.filter((c) => String(nameOf(c)).trim() === ref);
  return byName.find((c) => !isDeleted(c)) || byName[0];
};
var resolveClass = (data, schoolId, classRef) => {
  if (classRef === void 0 || classRef === null) return null;
  const ref = String(Array.isArray(classRef) ? classRef[0] : classRef).trim();
  if (SPECIAL_CLASS_REFS.has(ref)) return null;
  const schools = data.schools || [];
  if (schoolId) {
    const school = schools.find((s) => s.id === schoolId);
    const cls = findInSchool(school, ref);
    if (school && cls) return { school, cls };
  }
  for (const school of schools) {
    const cls = findInSchool(school, ref);
    if (cls) return { school, cls };
  }
  return null;
};
var canonicalClassId = (data, schoolId, classRef) => {
  const found = resolveClass(data, schoolId, classRef);
  if (found) return String(idOf(found.cls));
  return classRef ? String(classRef).trim() : "";
};
var isSameClassRef = (data, schoolId, a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  return canonicalClassId(data, schoolId, a) === canonicalClassId(data, schoolId, b);
};
var looksLikeClassCode = (ref) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.trim());
var getClassName = (data, schoolId, classRef, fallback = "Geral") => {
  if (!classRef || !String(classRef).trim()) return fallback;
  const found = resolveClass(data, schoolId, classRef);
  if (found) return String(nameOf(found.cls));
  const ref = String(classRef).trim();
  if (ref === "window") return "Janela";
  return looksLikeClassCode(ref) ? `Turma n\xE3o encontrada (${ref.slice(0, 4)})` : ref;
};

// utils/schedule.ts
var getScheduleVersion = (data, dateStr) => {
  if (!data.scheduleVersions || data.scheduleVersions.length === 0) {
    return null;
  }
  const sortedVersions = [...data.scheduleVersions].sort((a, b) => b.activeFrom.localeCompare(a.activeFrom));
  const activeVersion = sortedVersions.find((v) => v.activeFrom <= dateStr);
  if (activeVersion) return activeVersion;
  return sortedVersions[sortedVersions.length - 1];
};
var getSchedulesForDate = (data, dateStr) => {
  const version = getScheduleVersion(data, dateStr);
  if (version) {
    return version.schedules;
  }
  return data.schedules || [];
};

// utils/lessonStats.ts
var isLessonBlocked = (data, dateStr, schoolId, shiftId, classId) => {
  const calendar = data.calendars.find((c) => c.schoolId === schoolId);
  if (calendar) {
    if (calendar.midYearBreak.start && dateStr >= calendar.midYearBreak.start && dateStr <= calendar.midYearBreak.end) return true;
    if (calendar.extraRecesses?.some((r) => r.date === dateStr)) return true;
  }
  const events = data.events.filter((e) => e.schoolId === schoolId && e.date.startsWith(dateStr) && e.blocksClasses);
  for (const event of events) {
    if (!event.slotId && !event.classId) return true;
    if (event.slotId && event.slotId === shiftId) return true;
    if (event.classId && event.classId === classId) return true;
  }
  return false;
};

// utils/dashboardWeb.ts
var lessonNumberInShift = (slots, slotId) => slots.filter((s) => s.type !== "break").findIndex((s) => s.id === slotId) + 1;

// connector/consultas.ts
var ConsultaError = class extends Error {
};
var DIAS_SEMANA = ["domingo", "segunda", "ter\xE7a", "quarta", "quinta", "sexta", "s\xE1bado"];
var dia = (d) => String(d || "").split("T")[0];
var hojeEmBrasilia = (agora = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
var somarDias = (dateStr, n) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
var diaDaSemana = (dateStr) => getSafeDate(dateStr).getDay();
var validarData = (valor, campo) => {
  if (valor === void 0) return void 0;
  const d = dia(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ConsultaError(`Data inv\xE1lida em "${campo}": use AAAA-MM-DD.`);
  return d;
};
var normalizar = (s) => String(s || "").replace(/ª/g, "a").replace(/º/g, "o").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
var escolasAtivas = (data) => (data.schools || []).filter((s) => !s.deleted);
var turmasAtivas = (school) => (school.classes || []).map((c) => typeof c === "string" ? { id: c, name: c } : c).filter((c) => !c.deleted);
var escolhaPorNome = (itens, nomeDe, busca) => {
  const alvo = normalizar(busca);
  const exatos = itens.filter((t) => normalizar(nomeDe(t)) === alvo);
  if (exatos.length) return exatos;
  return itens.filter((t) => normalizar(nomeDe(t)).includes(alvo));
};
var encontrarEscola = (data, busca) => {
  const escolas = escolasAtivas(data);
  const achadas = escolhaPorNome(escolas, (s) => s.name, busca);
  if (achadas.length === 1) return achadas[0];
  const opcoes = (achadas.length ? achadas : escolas).map((s) => s.name).join(", ");
  throw new ConsultaError(
    achadas.length ? `Mais de uma escola combina com "${busca}": ${opcoes}.` : `Escola "${busca}" n\xE3o encontrada. Escolas: ${opcoes}.`
  );
};
var encontrarTurma = (data, busca, escola) => {
  const escolas = escola ? [encontrarEscola(data, escola)] : escolasAtivas(data);
  const todas = escolas.flatMap((school) => turmasAtivas(school).map((cls) => ({ school, cls })));
  const achadas = escolhaPorNome(todas, (t) => t.cls.name, busca);
  if (achadas.length === 1) return achadas[0];
  if (achadas.length > 1) {
    const opcoes2 = achadas.map((t) => `${t.cls.name} (${t.school.name})`).join(", ");
    throw new ConsultaError(`Mais de uma turma combina com "${busca}": ${opcoes2}. Diga tamb\xE9m a escola.`);
  }
  const opcoes = todas.map((t) => `${t.cls.name} (${t.school.name})`).join(", ");
  throw new ConsultaError(`Turma "${busca}" n\xE3o encontrada. Turmas: ${opcoes}.`);
};
var eDaTurma = (data, school, cls, ref) => !!ref && isSameClassRef(data, school.id, ref, cls.id);
var nomeDaTurma = (data, school, ref) => {
  if (!ref) return "Todas as turmas";
  const cls = turmasAtivas(school).find((c) => isSameClassRef(data, school.id, ref, c.id));
  return cls ? cls.name : getClassName(data, school.id, ref);
};
var descreverAula = (school, slotId) => {
  if (!slotId) return void 0;
  for (const shift of school.shifts || []) {
    const slot = shift.slots.find((s) => s.id === slotId);
    if (slot) return { texto: `${lessonNumberInShift(shift.slots, slotId)}\xAA aula (${slot.startTime})`, inicio: slot.startTime };
  }
  return void 0;
};
var eAvaliacao = (e) => e.type === "test" || e.type === "work";
var descreverAvaliacao = (data, school, e) => {
  const d = dia(e.date);
  return {
    data: d,
    dataBR: formatDateBR(d),
    diaSemana: DIAS_SEMANA[diaDaSemana(d)],
    escola: school.name,
    turma: nomeDaTurma(data, school, e.classId),
    tipo: e.type === "test" ? "Prova" : "Trabalho",
    titulo: e.title,
    descricao: e.description || "",
    aula: descreverAula(school, e.slotId)?.texto,
    situacao: e.prepared ? "Pronta" : e.scheduled ? "Agendada" : "Pendente",
    elaborada: !!e.prepared,
    // No app, escolher "Pronta" desliga "Agendada"; pronta já foi enviada e os alunos já sabem
    comunicadaAosAlunos: !!e.prepared || !!e.scheduled
  };
};
var ordemDaAvaliacao = (school, e) => `${dia(e.date)} ${descreverAula(school, e.slotId)?.inicio || "99:99"}`;
var avaliacoesDe = (data, school, cls) => (data.events || []).filter((e) => eAvaliacao(e) && e.schoolId === school.id && (!cls || eDaTurma(data, school, cls, e.classId))).sort((a, b) => ordemDaAvaliacao(school, a).localeCompare(ordemDaAvaliacao(school, b)));
var listarAvaliacoes = (data, filtro = {}) => {
  const de = validarData(filtro.de, "de");
  const ate = validarData(filtro.ate, "ate");
  const alvo = filtro.turma ? encontrarTurma(data, filtro.turma, filtro.escola) : void 0;
  const escolas = alvo ? [alvo.school] : filtro.escola ? [encontrarEscola(data, filtro.escola)] : escolasAtivas(data);
  return escolas.flatMap((school) => avaliacoesDe(data, school, alvo?.cls).map((e) => ({ school, e }))).filter(({ e }) => (!de || dia(e.date) >= de) && (!ate || dia(e.date) <= ate)).filter(({ e }) => filtro.elaborada === void 0 || !!e.prepared === filtro.elaborada).sort((a, b) => ordemDaAvaliacao(a.school, a.e).localeCompare(ordemDaAvaliacao(b.school, b.e))).map(({ school, e }) => descreverAvaliacao(data, school, e));
};
var REGISTRO_DE_AVALIACAO = /^Avaliação:/;
var calendarioNaData = (data, schoolId, d) => (data.calendars || []).find((c) => c.schoolId === schoolId && d >= dia(c.start) && d <= dia(c.end));
var conteudoEntre = (data, school, cls, ate, hoje) => {
  const avaliacoes = avaliacoesDe(data, school, cls);
  const anteriores = avaliacoes.filter((e) => dia(e.date) < ate);
  const ultima = anteriores[anteriores.length - 1];
  const proxima = avaliacoes.find((e) => dia(e.date) >= ate);
  const inicioDoAno = calendarioNaData(data, school.id, ate)?.start;
  const desde = ultima ? somarDias(dia(ultima.date), 1) : dia(inicioDoAno) || `${ate.slice(0, 4)}-01-01`;
  const registros = (data.logs || []).filter(
    (l) => !l.studentId && l.schoolId === school.id && eDaTurma(data, school, cls, l.classId) && dia(l.date) >= desde && dia(l.date) <= ate
  );
  const aulas = registros.filter((l) => l.status !== "removed").filter((l) => (l.subject || "").trim() || (l.homework || "").trim()).filter((l) => !REGISTRO_DE_AVALIACAO.test(l.subject || "")).map((l) => {
    const aula = descreverAula(school, l.slotId);
    return {
      ordem: `${dia(l.date)} ${aula?.inicio || l.startTime || ""}`,
      data: dia(l.date),
      dataBR: formatDateBR(l.date),
      aula: aula?.texto,
      conteudo: (l.subject || "").trim(),
      tarefa: (l.homework || "").trim() || void 0
    };
  }).sort((a, b) => a.ordem.localeCompare(b.ordem)).map(({ ordem, ...resto }) => resto);
  const aulasSemRegistro = [];
  const fim = ate < hoje ? ate : somarDias(hoje, -1);
  for (let d = desde; d <= fim; d = somarDias(d, 1)) {
    if (getHolidayName(getSafeDate(d))) continue;
    if ((data.calendars || []).some((c) => c.schoolId === school.id) && !calendarioNaData(data, school.id, d)) continue;
    const semana = diaDaSemana(d);
    getSchedulesForDate(data, d).filter((s) => Number(s.dayOfWeek) === semana && s.schoolId === school.id && eDaTurma(data, school, cls, s.classId)).filter((s) => !isLessonBlocked(data, d, school.id, s.shiftId, s.classId)).forEach((s) => {
      const temRegistro = registros.some((l) => dia(l.date) === d && l.slotId === s.slotId);
      if (!temRegistro) aulasSemRegistro.push({ data: d, dataBR: formatDateBR(d), aula: descreverAula(school, s.slotId)?.texto });
    });
  }
  return {
    escola: school.name,
    turma: cls.name,
    desde,
    ate,
    ultimaAvaliacao: ultima && descreverAvaliacao(data, school, ultima),
    proximaAvaliacao: proxima && descreverAvaliacao(data, school, proxima),
    aulas,
    aulasSemRegistro
  };
};
var conteudoDesdeUltimaAvaliacao = (data, opcoes) => {
  const { school, cls } = encontrarTurma(data, opcoes.turma, opcoes.escola);
  return conteudoEntre(data, school, cls, validarData(opcoes.ate, "ate") || opcoes.hoje, opcoes.hoje);
};
var avaliacoesProximas = (data, opcoes) => {
  const dias = Math.max(0, Math.min(opcoes.dias ?? 7, 60));
  const ate = somarDias(opcoes.hoje, dias);
  const escolas = opcoes.escola ? [encontrarEscola(data, opcoes.escola)] : escolasAtivas(data);
  const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  return escolas.flatMap((school) => avaliacoesDe(data, school).map((e) => ({ school, e }))).filter(({ e }) => dia(e.date) >= opcoes.hoje && dia(e.date) <= ate).sort((a, b) => ordemDaAvaliacao(a.school, a.e).localeCompare(ordemDaAvaliacao(b.school, b.e))).map(({ school, e }) => ({ school, e, cls: turmasAtivas(school).find((c) => eDaTurma(data, school, c, e.classId)) })).filter(({ e, cls }) => !e.classId || !!cls).map(({ school, e, cls }) => {
    const c = cls && conteudoEntre(data, school, cls, dia(e.date), opcoes.hoje);
    return {
      ...descreverAvaliacao(data, school, e),
      diasAte: diasEntre(opcoes.hoje, dia(e.date)),
      conteudo: c && { desde: c.desde, aulas: c.aulas, aulasSemRegistro: c.aulasSemRegistro }
    };
  });
};
var turmasEGrade = (data, opcoes) => {
  const ref = validarData(opcoes.data, "data");
  const escolas = escolasAtivas(data);
  const linhas = getSchedulesForDate(data, ref).flatMap((s) => {
    if (s.classId === "window") return [];
    const school = escolas.find((e) => e.id === s.schoolId);
    const shift = school?.shifts.find((sh) => sh.id === s.shiftId);
    const slot = shift?.slots.find((sl) => sl.id === s.slotId);
    if (!school || !shift || !slot) return [];
    return [{
      diaSemana: Number(s.dayOfWeek),
      numero: lessonNumberInShift(shift.slots, slot.id),
      inicio: slot.startTime,
      fim: slot.endTime,
      escola: school.name,
      turma: nomeDaTurma(data, school, s.classId)
    }];
  });
  const dias = [1, 2, 3, 4, 5];
  if (linhas.some((l) => l.diaSemana === 6)) dias.push(6);
  return {
    vigenteEm: ref,
    escolas: escolas.map((school) => ({
      escola: school.name,
      turmas: turmasAtivas(school).map((c) => c.name),
      turnos: (school.shifts || []).map((shift) => ({
        turno: shift.name,
        aulas: shift.slots.filter((s) => s.type !== "break").map((s) => `${lessonNumberInShift(shift.slots, s.id)}\xAA ${s.startTime}\u2013${s.endTime}`)
      }))
    })),
    grade: dias.map((d) => ({
      dia: DIAS_SEMANA[d],
      aulas: linhas.filter((l) => l.diaSemana === d).sort((a, b) => parseTimeToMinutes(a.inicio) - parseTimeToMinutes(b.inicio) || a.escola.localeCompare(b.escola)).map(({ diaSemana, ...resto }) => resto)
    }))
  };
};
var TIPOS_DE_EVENTO = {
  meeting: "Reuni\xE3o",
  festivity: "Festividade",
  trip: "Passeio",
  material: "Material",
  other: "Outro"
};
var calendario = (data, opcoes) => {
  const de = validarData(opcoes.de, "de");
  const ate = validarData(opcoes.ate, "ate");
  if (ate < de) throw new ConsultaError("A data final vem antes da inicial.");
  if (Date.parse(ate) - Date.parse(de) > 400 * 864e5) throw new ConsultaError("Pe\xE7a no m\xE1ximo um ano por vez.");
  const noPeriodo = (d) => dia(d) >= de && dia(d) <= ate;
  const feriados = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    const nome = getHolidayName(getSafeDate(d));
    if (nome) feriados.push({ data: d, dataBR: formatDateBR(d), nome });
  }
  const escolas = opcoes.escola ? [encontrarEscola(data, opcoes.escola)] : escolasAtivas(data);
  return {
    de,
    ate,
    feriados,
    escolas: escolas.map((school) => {
      const cal = (data.calendars || []).filter((c) => c.schoolId === school.id && dia(c.start) <= ate && dia(c.end) >= de).sort((a, b) => dia(b.start).localeCompare(dia(a.start)))[0];
      const meio = cal?.midYearBreak;
      return {
        escola: school.name,
        anoLetivo: cal && { inicio: dia(cal.start), fim: dia(cal.end), divisao: cal.division },
        periodos: (cal?.terms || []).map((t) => ({ nome: t.name, inicio: dia(t.start), fim: dia(t.end) })),
        recessoDeMeioDeAno: meio?.start ? { inicio: dia(meio.start), fim: dia(meio.end) } : void 0,
        recessos: (cal?.extraRecesses || []).filter((r) => noPeriodo(r.date)).map((r) => ({ data: dia(r.date), dataBR: formatDateBR(r.date), nome: r.name })),
        // Só o título: descrições de reuniões podem citar alunos
        eventos: (data.events || []).filter((e) => !eAvaliacao(e) && e.schoolId === school.id && noPeriodo(e.date)).sort((a, b) => dia(a.date).localeCompare(dia(b.date))).map((e) => ({
          data: dia(e.date),
          dataBR: formatDateBR(e.date),
          tipo: TIPOS_DE_EVENTO[e.type] || "Outro",
          titulo: e.title,
          turma: nomeDaTurma(data, school, e.classId),
          suspendeAulas: !!e.blocksClasses
        }))
      };
    })
  };
};

// connector/servidor.ts
var origemDe = (req) => {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || url.host;
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${host}`;
};
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version" };
var json = (corpo, status = 200, extra = {}) => new Response(JSON.stringify(corpo), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra }
});
var erroOAuth = (e) => {
  if (e instanceof ErroOAuth) return json({ error: e.codigo, error_description: e.message }, e.status);
  console.error(e);
  return json({ error: "server_error", error_description: "Erro interno." }, 500);
};
var lerCampos = async (req) => {
  const tipo = req.headers.get("content-type") || "";
  if (tipo.includes("application/json")) return await req.json() || {};
  return Object.fromEntries(new URLSearchParams(await req.text()));
};
var esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var FIREBASE_WEB = {
  apiKey: "AIzaSyA9aD53AHcErDH0-PK81dfk-Cyaib_An-A",
  authDomain: "leciona-c93a9.firebaseapp.com",
  projectId: "leciona-c93a9",
  appId: "1:24660236180:web:8d247c2f58f22ae5cd2181"
};
var pagina = (titulo, corpo, status = 200) => new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border-radius:16px;padding:32px;max-width:420px;width:100%;box-shadow:0 10px 30px rgba(15,23,42,.08)}
h1{font-size:1.3rem;margin:0 0 12px}p{line-height:1.5;color:#334155}
button{width:100%;padding:14px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:1rem;cursor:pointer}
button:disabled{opacity:.6}.erro{color:#b91c1c}
</style></head><body><main>${corpo}</main></body></html>`, {
  status,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  }
});
var paginaDeLogin = (pedido) => {
  const campos = Object.entries(pedido).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  return pagina("Conectar o Claude ao Leciona", `
<h1>Conectar o Claude ao Leciona</h1>
<p>O Claude vai poder <b>ler</b> suas avalia\xE7\xF5es, o conte\xFAdo do di\xE1rio, turmas, grade e calend\xE1rio.
Nomes de alunos, notas e chamada n\xE3o s\xE3o compartilhados.</p>
<form id="f" method="post">${campos}<input type="hidden" name="id_token" id="t">
<button type="button" id="b">Entrar com Google e autorizar</button></form>
<p class="erro" id="e"></p>
<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
const auth = getAuth(initializeApp(${JSON.stringify(FIREBASE_WEB)}));
const b = document.getElementById('b');
b.onclick = async () => {
  b.disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const r = await signInWithPopup(auth, provider);
    document.getElementById('t').value = await r.user.getIdToken();
    document.getElementById('f').submit();
  } catch (err) {
    document.getElementById('e').textContent = 'N\xE3o foi poss\xEDvel entrar: ' + (err && err.code || err);
    b.disabled = false;
  }
};
</script>`);
};
var paginaDeErro = (mensagem, status = 400) => pagina("Leciona", `<h1>N\xE3o foi poss\xEDvel conectar</h1><p class="erro">${esc(mensagem)}</p>`, status);
var INSTRUCOES = `Dados do Leciona, app de rotina docente do prof. Cadu (professor de Hist\xF3ria em escolas de Brusque/SC).
S\xF3 leitura. Datas no formato AAAA-MM-DD, no fuso de Bras\xEDlia; cada resposta informa "hoje".
Turmas e escolas podem ser escritas pelo nome (ex.: "183", "3\xAA S\xE9rie", "C\xF4nsul"); se o nome existir em mais de uma escola, informe a escola.
Responda ao Cadu em portugu\xEAs simples. N\xE3o h\xE1 dados de alunos (nomes, notas, chamada) neste conector.`;
var somenteLeitura = { readOnlyHint: true, openWorldHint: false };
var criarServidorMcp = (dados, hoje) => {
  const servidor = new McpServer({ name: "leciona", version: "1.0.0" }, { instructions: INSTRUCOES });
  const responder = (consulta) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify({ hoje, resultado: consulta() }, null, 1) }] };
    } catch (e) {
      if (e instanceof ConsultaError) return { content: [{ type: "text", text: e.message }], isError: true };
      throw e;
    }
  };
  const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD");
  servidor.registerTool("listar_avaliacoes", {
    title: "Listar avalia\xE7\xF5es",
    description: "Provas e trabalhos cadastrados, com data, turma, aula e situa\xE7\xE3o (Pendente, Agendada = alunos avisados, Pronta = elaborada, enviada e alunos avisados). Filtre por per\xEDodo, escola, turma ou pelas que faltam elaborar.",
    inputSchema: {
      de: data.optional().describe("Data inicial (AAAA-MM-DD)"),
      ate: data.optional().describe("Data final (AAAA-MM-DD)"),
      escola: z.string().optional().describe("Nome da escola"),
      turma: z.string().optional().describe('Nome da turma, ex.: "183"'),
      elaborada: z.boolean().optional().describe("true = s\xF3 as j\xE1 elaboradas; false = s\xF3 as que faltam elaborar")
    },
    annotations: somenteLeitura
  }, async (args) => responder(() => listarAvaliacoes(dados, args)));
  servidor.registerTool("conteudo_desde_ultima_avaliacao", {
    title: "Conte\xFAdo desde a \xFAltima avalia\xE7\xE3o",
    description: "Conte\xFAdo e tarefas registrados no di\xE1rio de uma turma desde a \xFAltima avalia\xE7\xE3o (prova ou trabalho), com a pr\xF3xima avalia\xE7\xE3o e as aulas que ficaram sem registro.",
    inputSchema: {
      turma: z.string().describe('Nome da turma, ex.: "183"'),
      escola: z.string().optional().describe("Nome da escola (necess\xE1rio se a turma existir em mais de uma)"),
      ate: data.optional().describe("Data de refer\xEAncia (padr\xE3o: hoje)")
    },
    annotations: somenteLeitura
  }, async (args) => responder(() => conteudoDesdeUltimaAvaliacao(dados, { ...args, hoje })));
  servidor.registerTool("avaliacoes_proximas", {
    title: "Avalia\xE7\xF5es pr\xF3ximas",
    description: "Avalia\xE7\xF5es de hoje at\xE9 alguns dias \xE0 frente, cada uma com o conte\xFAdo que vai cair (desde a avalia\xE7\xE3o anterior da turma). \xDAtil para alertas.",
    inputSchema: {
      dias: z.number().int().min(0).max(60).optional().describe("Quantos dias \xE0 frente (padr\xE3o 7)"),
      escola: z.string().optional().describe("Nome da escola")
    },
    annotations: somenteLeitura
  }, async (args) => responder(() => avaliacoesProximas(dados, { ...args, hoje })));
  servidor.registerTool("turmas_e_grade", {
    title: "Turmas e grade",
    description: "Escolas, turmas, hor\xE1rios dos turnos e grade semanal em vigor na data (aulas seguidas aparecem separadas).",
    inputSchema: { data: data.optional().describe("Data de refer\xEAncia (padr\xE3o: hoje)") },
    annotations: somenteLeitura
  }, async (args) => responder(() => turmasEGrade(dados, { data: args.data || hoje })));
  servidor.registerTool("calendario", {
    title: "Calend\xE1rio",
    description: "Feriados, bimestres/trimestres, recessos e eventos (reuni\xF5es, festas, passeios) num per\xEDodo de at\xE9 um ano.",
    inputSchema: {
      de: data.describe("Data inicial (AAAA-MM-DD)"),
      ate: data.describe("Data final (AAAA-MM-DD)"),
      escola: z.string().optional().describe("Nome da escola")
    },
    annotations: somenteLeitura
  }, async (args) => responder(() => calendario(dados, args)));
  return servidor;
};
var criarRotas = (deps) => {
  const assinatura = (req) => ({ chave: deps.chave, origem: origemDe(req), agora: deps.agora?.() });
  const naoAutorizado = (req) => json({ error: "invalid_token", error_description: "Fa\xE7a login para usar o conector." }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata="${urlsDoServidor(origemDe(req)).metadadosRecurso}", scope="leciona"`
  });
  return {
    opcoes: () => new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } }),
    metadadosRecurso: (req) => json(metadadosDoRecurso(origemDe(req))),
    metadadosServidor: (req) => json(metadadosDoServidor(origemDe(req))),
    registrar: async (req) => {
      try {
        return json(registrarCliente(await req.json().catch(() => null)), 201);
      } catch (e) {
        return erroOAuth(e);
      }
    },
    autorizarGet: (req) => {
      const params = Object.fromEntries(new URL(req.url).searchParams);
      try {
        validarPedido(params, origemDe(req));
      } catch (e) {
        return paginaDeErro(e instanceof Error ? e.message : "Pedido inv\xE1lido.");
      }
      return paginaDeLogin(params);
    },
    autorizarPost: async (req) => {
      const campos = await lerCampos(req);
      let pedido;
      try {
        pedido = validarPedido(campos, origemDe(req));
      } catch (e) {
        return paginaDeErro(e instanceof Error ? e.message : "Pedido inv\xE1lido.");
      }
      let conta;
      try {
        const login = await deps.verificarLogin(campos.id_token || "");
        if (!login.email || !login.email_verified) throw new Error("sem email");
        conta = { uid: login.uid, email: login.email };
      } catch {
        return paginaDeErro("N\xE3o foi poss\xEDvel confirmar o login. Tente de novo.", 401);
      }
      if (conta.email.toLowerCase() !== deps.emailPermitido.trim().toLowerCase()) {
        return paginaDeErro("Esta conta Google n\xE3o tem acesso a este conector.", 403);
      }
      const volta = new URL(pedido.redirect_uri);
      volta.searchParams.set("code", await emitirCodigo(assinatura(req), pedido, conta));
      if (pedido.state) volta.searchParams.set("state", pedido.state);
      volta.searchParams.set("iss", origemDe(req));
      return new Response(null, { status: 302, headers: { Location: volta.toString(), "Cache-Control": "no-store" } });
    },
    token: async (req) => {
      try {
        return json(await trocarToken(assinatura(req), deps.emailPermitido, await lerCampos(req)));
      } catch (e) {
        return erroOAuth(e);
      }
    },
    mcp: async (req) => {
      const conta = await verificarAcesso(assinatura(req), deps.emailPermitido, req.headers.get("authorization"));
      if (!conta) return naoAutorizado(req);
      if (req.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
      }
      const dados = await deps.carregarDados(conta.uid);
      const servidor = criarServidorMcp(dados, hojeEmBrasilia(deps.agora?.()));
      const transporte = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: void 0, enableJsonResponse: true });
      await servidor.connect(transporte);
      const resposta = await transporte.handleRequest(req);
      const comCors = new Response(resposta.body, resposta);
      Object.entries(CORS).forEach(([k, v]) => comCors.headers.set(k, v));
      return comCors;
    }
  };
};

// connector/producao.ts
var variavel = (nome) => {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Vari\xE1vel de ambiente ${nome} n\xE3o configurada na Vercel.`);
  return valor;
};
var rotas;
var montar = async () => {
  const credencial = JSON.parse(variavel("FIREBASE_SERVICE_ACCOUNT"));
  const emailPermitido = variavel("LECIONA_EMAIL");
  const app = getApps()[0] || initializeApp({ credential: cert(credencial) });
  const db = getFirestore(app);
  return criarRotas({
    chave: await derivarChave(credencial.private_key),
    emailPermitido,
    verificarLogin: async (idToken) => {
      const t = await getAuth(app).verifyIdToken(idToken);
      return { uid: t.uid, email: t.email, email_verified: t.email_verified };
    },
    carregarDados: async (uid) => {
      const doc = await db.collection("users").doc(uid).get();
      if (!doc.exists) throw new Error("Documento do professor n\xE3o encontrado.");
      return doc.data();
    }
  });
};
var obterRotas = () => {
  rotas ??= montar().catch((e) => {
    rotas = void 0;
    throw e;
  });
  return rotas;
};
var tratar = (escolher) => async (req) => {
  try {
    return await escolher(await obterRotas())(req);
  } catch (e) {
    console.error(e);
    const configuracao = e instanceof Error && e.message.startsWith("Vari\xE1vel de ambiente");
    return Response.json(
      { error: "server_error", error_description: configuracao ? e.message : "Erro interno do conector." },
      { status: 500 }
    );
  }
};
export {
  obterRotas,
  tratar
};
