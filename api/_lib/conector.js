// connector/producao.ts
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

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

// utils/sync.ts
var TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1e3;
var removeUndefined = (obj) => {
  if (obj === void 0) return void 0;
  if (obj === null) return null;
  if (Array.isArray(obj)) return obj.map(removeUndefined).filter((v) => v !== void 0);
  if (typeof obj === "object" && obj.constructor === Object) {
    const out = {};
    for (const k of Object.keys(obj)) {
      const v = removeUndefined(obj[k]);
      if (v !== void 0) out[k] = v;
    }
    return out;
  }
  return obj;
};
var estimateDocBytes = (data) => new Blob([JSON.stringify(data)]).size;
var FIRESTORE_DOC_LIMIT = 1048576;

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
var DURACAO_PLANO = 60 * 60;
var DURACAO_LOTE = 30 * 24 * 60 * 60;
var assinarPlano = (a, uid, plano) => emitir(a, "plano", { plano }, uid, DURACAO_PLANO);
var assinarLote = (a, uid, lote) => emitir(a, "lote", { lote }, uid, DURACAO_LOTE);
var lerPlano = async (a, uid, codigo) => {
  const t = await ler(a, "plano", codigo);
  return t && t.sub === uid ? t.plano : null;
};
var lerLote = async (a, uid, codigo) => {
  const t = await ler(a, "lote", codigo);
  return t && t.sub === uid ? t.lote : null;
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

// connector/escrita.ts
var SITUACOES = ["Pendente", "Agendada", "Pronta"];
var camposDaSituacao = (s) => ({ prepared: s === "Pronta", scheduled: s === "Agendada" });
var situacaoDe = (e) => e.prepared ? "Pronta" : e.scheduled ? "Agendada" : "Pendente";
var novoId = () => crypto.randomUUID();
var diaISO = (d) => `${d}T00:00:00.000Z`;
var quando = (d) => `${DIAS_SEMANA[diaDaSemana(d)]} ${formatDateBR(d)}`;
var aulasDaTurmaNoDia = (data, school, cls, d) => {
  const semana = diaDaSemana(d);
  return getSchedulesForDate(data, d).filter((s) => Number(s.dayOfWeek) === semana && s.schoolId === school.id && s.classId !== "window").filter((s) => eDaTurma(data, school, cls, s.classId)).flatMap((s) => {
    const shift = school.shifts.find((sh) => sh.id === s.shiftId);
    const slot = shift?.slots.find((sl) => sl.id === s.slotId);
    if (!shift || !slot) return [];
    const numero = lessonNumberInShift(shift.slots, slot.id);
    return [{ slotId: slot.id, shiftId: shift.id, numero, inicio: slot.startTime, texto: `${numero}\xAA aula (${slot.startTime})` }];
  }).sort((a, b) => a.inicio.localeCompare(b.inicio));
};
var diasComAula = (data, school, cls, d) => {
  const dias = new Set(getSchedulesForDate(data, d).filter((s) => s.schoolId === school.id && s.classId !== "window" && eDaTurma(data, school, cls, s.classId)).map((s) => Number(s.dayOfWeek)));
  return [...dias].sort().map((n) => DIAS_SEMANA[n]).join(", ") || "nenhum dia na grade";
};
var prepararAvaliacoes = (data, pedidos, hoje, agora = Date.now()) => {
  if (!pedidos.length) throw new ConsultaError("Nenhuma avalia\xE7\xE3o informada.");
  if (pedidos.length > 40) throw new ConsultaError("Envie no m\xE1ximo 40 avalia\xE7\xF5es por vez.");
  const plano = { resumo: [], criar: { events: [], logs: [] }, situacoes: [] };
  const itens = [];
  const nestePedido = [];
  pedidos.forEach((p, i) => {
    const item = { pedido: i + 1, ok: false, descricao: `${p.titulo} (${p.turma}, ${p.data})`, avisos: [] };
    itens.push(item);
    try {
      const d = validarData(p.data, "data");
      const titulo = (p.titulo || "").trim();
      if (!titulo) throw new ConsultaError("Falta o t\xEDtulo da avalia\xE7\xE3o.");
      if (p.tipo !== "prova" && p.tipo !== "trabalho") throw new ConsultaError('O tipo deve ser "prova" ou "trabalho".');
      const situacao = p.situacao ?? "Pendente";
      if (!SITUACOES.includes(situacao)) throw new ConsultaError("Situa\xE7\xE3o deve ser Pendente, Agendada ou Pronta.");
      const { school, cls } = encontrarTurma(data, p.turma, p.escola);
      const tipoTexto = p.tipo === "prova" ? "Prova" : "Trabalho";
      item.descricao = `${tipoTexto} "${titulo}" \u2014 ${cls.name} (${school.name}), ${quando(d)}`;
      const aulas = aulasDaTurmaNoDia(data, school, cls, d);
      if (!aulas.length) {
        throw new ConsultaError(`A turma ${cls.name} n\xE3o tem aula na grade em ${quando(d)}. Dias com aula: ${diasComAula(data, school, cls, d)}.`);
      }
      let aula = aulas[0];
      if (p.aula !== void 0) {
        const escolhida = aulas.find((a) => a.numero === p.aula);
        if (!escolhida) throw new ConsultaError(`Nesse dia a turma ${cls.name} tem: ${aulas.map((a) => a.texto).join(", ")}. Escolha uma delas.`);
        aula = escolhida;
      } else if (aulas.length > 1) {
        throw new ConsultaError(`Nesse dia a turma ${cls.name} tem aulas seguidas: ${aulas.map((a) => a.texto).join(" e ")}. Pergunte ao Cadu em qual aula ser\xE1 a avalia\xE7\xE3o e informe o n\xFAmero da aula.`);
      }
      item.descricao += `, ${aula.texto}`;
      const feriado = getHolidayName(getSafeDate(d));
      if (feriado) throw new ConsultaError(`${formatDateBR(d)} \xE9 feriado (${feriado}).`);
      if (isLessonBlocked(data, d, school.id, aula.shiftId, cls.id)) {
        throw new ConsultaError(`${formatDateBR(d)} est\xE1 sem aula nessa escola (recesso ou evento que suspende as aulas).`);
      }
      if ((data.calendars || []).some((c) => c.schoolId === school.id) && !calendarioNaData(data, school.id, d)) {
        item.avisos.push("A data est\xE1 fora do ano letivo cadastrado para essa escola.");
      }
      if (d < hoje) item.avisos.push("A data j\xE1 passou.");
      const mesmaTurmaNoDia = avaliacoesDe(data, school, cls).filter((e) => dia(e.date) === d);
      if (mesmaTurmaNoDia.some((e) => normalizar(e.title) === normalizar(titulo))) {
        throw new ConsultaError(`J\xE1 existe "${titulo}" para a ${cls.name} nesse dia.`);
      }
      const naMesmaAula = mesmaTurmaNoDia.find((e) => e.slotId === aula.slotId);
      if (naMesmaAula) item.avisos.push(`J\xE1 existe outra avalia\xE7\xE3o nessa aula: "${naMesmaAula.title}".`);
      if (nestePedido.some((o) => o.schoolId === school.id && o.classId === cls.id && o.dia === d && normalizar(o.titulo) === normalizar(titulo))) {
        throw new ConsultaError("Repetida neste mesmo pedido.");
      }
      if (nestePedido.some((o) => o.schoolId === school.id && o.classId === cls.id && o.dia === d && o.slotId === aula.slotId)) {
        item.avisos.push("Outra avalia\xE7\xE3o deste pedido est\xE1 na mesma aula.");
      }
      const registro = (data.logs || []).find((l) => l.status !== "removed" && !l.studentId && dia(l.date) === d && l.schoolId === school.id && l.slotId === aula.slotId);
      const evento = removeUndefined({
        id: novoId(),
        title: titulo,
        date: diaISO(d),
        schoolId: school.id,
        classId: cls.id,
        slotId: aula.slotId,
        type: p.tipo === "prova" ? "test" : "work",
        description: (p.descricao || "").trim(),
        blocksClasses: false,
        ...camposDaSituacao(situacao),
        _m: agora
      });
      plano.criar.events.push(evento);
      if (registro) {
        item.avisos.push(`Essa aula j\xE1 tem registro no di\xE1rio ("${(registro.subject || "").slice(0, 60)}"). Ele ser\xE1 mantido e o registro "Avalia\xE7\xE3o: ${titulo}" n\xE3o ser\xE1 criado.`);
      } else {
        plano.criar.logs.push({
          id: novoId(),
          date: diaISO(d),
          schoolId: school.id,
          classId: cls.id,
          slotId: aula.slotId,
          subject: `Avalia\xE7\xE3o: ${titulo}`,
          homework: "",
          notes: evento.description,
          _m: agora
        });
      }
      item.descricao += ` \u2014 ${situacao}`;
      plano.resumo.push(item.descricao);
      nestePedido.push({ schoolId: school.id, classId: cls.id, dia: d, titulo, slotId: aula.slotId });
      item.ok = true;
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      item.erro = e.message;
    }
  });
  return { itens, plano: plano.resumo.length ? plano : null };
};
var prepararSituacoes = (data, pedidos) => {
  if (!pedidos.length) throw new ConsultaError("Nenhuma avalia\xE7\xE3o informada.");
  if (pedidos.length > 40) throw new ConsultaError("Envie no m\xE1ximo 40 avalia\xE7\xF5es por vez.");
  const plano = { resumo: [], criar: { events: [], logs: [] }, situacoes: [] };
  const itens = [];
  pedidos.forEach((p, i) => {
    const item = { pedido: i + 1, ok: false, descricao: `${p.turma}, ${p.data}`, avisos: [] };
    itens.push(item);
    try {
      const d = validarData(p.data, "data");
      if (!SITUACOES.includes(p.situacao)) throw new ConsultaError("Situa\xE7\xE3o deve ser Pendente, Agendada ou Pronta.");
      const { school, cls } = encontrarTurma(data, p.turma, p.escola);
      let candidatas = avaliacoesDe(data, school, cls).filter((e) => dia(e.date) === d);
      if (p.titulo) {
        const alvo = normalizar(p.titulo);
        const exatas = candidatas.filter((e) => normalizar(e.title) === alvo);
        candidatas = exatas.length ? exatas : candidatas.filter((e) => normalizar(e.title).includes(alvo));
      }
      if (!candidatas.length) throw new ConsultaError(`N\xE3o h\xE1 avalia\xE7\xE3o${p.titulo ? ` "${p.titulo}"` : ""} da ${cls.name} em ${quando(d)}.`);
      if (candidatas.length > 1) {
        throw new ConsultaError(`A ${cls.name} tem mais de uma avalia\xE7\xE3o nesse dia: ${candidatas.map((e) => `"${e.title}"`).join(", ")}. Informe o t\xEDtulo.`);
      }
      const ev = candidatas[0];
      if (plano.situacoes.some((s) => s.id === ev.id)) throw new ConsultaError("Avalia\xE7\xE3o repetida neste pedido.");
      const atual = situacaoDe(ev);
      item.descricao = `"${ev.title}" \u2014 ${cls.name} (${school.name}), ${quando(d)}: ${atual} \u2192 ${p.situacao}`;
      if (atual === p.situacao) {
        item.avisos.push(`J\xE1 est\xE1 como ${atual}; nada muda.`);
        item.ok = true;
        return;
      }
      plano.situacoes.push({ id: ev.id, situacao: p.situacao, descricao: item.descricao });
      plano.resumo.push(item.descricao);
      item.ok = true;
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      item.erro = e.message;
    }
  });
  return { itens, plano: plano.resumo.length ? plano : null };
};
var LIMITE_CONTEUDO = 500;
var LIMITE_TAREFA = 2e3;
var limpar = (t) => (t || "").trim().replace(/[<>]/g, "");
var juntar = (atual, novo, modo) => {
  if (!novo) return atual;
  if (modo === "substituir" || !atual.trim()) return novo;
  if (normalizar(atual).includes(normalizar(novo))) return atual;
  return `${atual}
${novo}`;
};
var prepararConteudos = (data, pedidos, hoje, agora = Date.now()) => {
  if (!pedidos.length) throw new ConsultaError("Nenhum registro informado.");
  if (pedidos.length > 40) throw new ConsultaError("Envie no m\xE1ximo 40 registros por vez.");
  const plano = { resumo: [], criar: { events: [], logs: [] }, situacoes: [], conteudos: [] };
  const itens = [];
  const aulasNestePedido = /* @__PURE__ */ new Set();
  pedidos.forEach((p, i) => {
    const item = { pedido: i + 1, ok: false, descricao: `${p.turma}, ${p.data}`, avisos: [] };
    itens.push(item);
    try {
      const d = validarData(p.data, "data");
      const modo = p.modo ?? "acrescentar";
      const conteudo = limpar(p.conteudo);
      const tarefa = limpar(p.tarefa);
      if (!conteudo && !tarefa) throw new ConsultaError("Informe o conte\xFAdo da aula (ou a tarefa).");
      if (conteudo.length > LIMITE_CONTEUDO) throw new ConsultaError(`O conte\xFAdo passa de ${LIMITE_CONTEUDO} caracteres (limite do app).`);
      if (tarefa.length > LIMITE_TAREFA) throw new ConsultaError(`A tarefa passa de ${LIMITE_TAREFA} caracteres (limite do app).`);
      const { school, cls } = encontrarTurma(data, p.turma, p.escola);
      item.descricao = `${cls.name} (${school.name}), ${quando(d)}`;
      const aulasDoDia = aulasDaTurmaNoDia(data, school, cls, d);
      if (!aulasDoDia.length) {
        throw new ConsultaError(`A turma ${cls.name} n\xE3o tem aula na grade em ${quando(d)}. Dias com aula: ${diasComAula(data, school, cls, d)}.`);
      }
      let escolhidas = aulasDoDia;
      if (p.aulas?.length) {
        escolhidas = p.aulas.map((n) => {
          const a = aulasDoDia.find((x) => x.numero === n);
          if (!a) throw new ConsultaError(`Nesse dia a turma ${cls.name} tem: ${aulasDoDia.map((x) => x.texto).join(", ")}. Escolha entre elas.`);
          return a;
        });
        escolhidas = escolhidas.filter((a, k) => escolhidas.findIndex((b) => b.slotId === a.slotId) === k);
      } else if (aulasDoDia.length > 1) {
        throw new ConsultaError(`Nesse dia a turma ${cls.name} tem aulas seguidas: ${aulasDoDia.map((a) => a.texto).join(" e ")}. Pergunte ao Cadu se o conte\xFAdo vale para todas ou s\xF3 para uma, e informe os n\xFAmeros das aulas.`);
      }
      item.descricao += `, ${escolhidas.map((a) => a.texto).join(" e ")}`;
      const feriado = getHolidayName(getSafeDate(d));
      if (feriado) throw new ConsultaError(`${formatDateBR(d)} \xE9 feriado (${feriado}).`);
      for (const a of escolhidas) {
        if (isLessonBlocked(data, d, school.id, a.shiftId, cls.id)) {
          throw new ConsultaError(`${formatDateBR(d)} est\xE1 sem aula nessa escola (recesso ou evento que suspende as aulas).`);
        }
      }
      if (d > hoje) item.avisos.push("A aula ainda n\xE3o aconteceu: fica registrado como planejamento.");
      const novos = [];
      const edicoes = [];
      for (const a of escolhidas) {
        const chave = `${school.id}|${d}|${a.slotId}`;
        if (aulasNestePedido.has(chave)) throw new ConsultaError(`A ${a.texto} aparece duas vezes neste pedido.`);
        aulasNestePedido.add(chave);
        const registro = (data.logs || []).find((l) => !l.studentId && dia(l.date) === d && l.schoolId === school.id && l.slotId === a.slotId);
        if (registro && registro.status === "removed") {
          throw new ConsultaError(`A ${a.texto} foi marcada como removida no app; n\xE3o d\xE1 para registrar conte\xFAdo nela.`);
        }
        if (registro && registro.classId && !eDaTurma(data, school, cls, registro.classId)) {
          throw new ConsultaError(`A ${a.texto} desse dia j\xE1 tem registro de outra turma no di\xE1rio.`);
        }
        if (!registro) {
          novos.push({
            id: novoId(),
            date: diaISO(d),
            schoolId: school.id,
            classId: cls.id,
            slotId: a.slotId,
            subject: conteudo,
            homework: tarefa,
            notes: "",
            type: "regular",
            _m: agora
          });
          continue;
        }
        const antes = { subject: registro.subject || "", homework: registro.homework || "" };
        const depois = { subject: juntar(antes.subject, conteudo, modo), homework: juntar(antes.homework, tarefa, modo) };
        if (depois.subject.length > LIMITE_CONTEUDO) {
          throw new ConsultaError(`Juntando com o que j\xE1 est\xE1 no di\xE1rio da ${a.texto}, o conte\xFAdo passa de ${LIMITE_CONTEUDO} caracteres. Use modo "substituir" ou encurte.`);
        }
        if (depois.subject === antes.subject && depois.homework === antes.homework) {
          item.avisos.push(`A ${a.texto} j\xE1 tem esse registro; nada muda nela.`);
          continue;
        }
        item.avisos.push(antes.subject ? `A ${a.texto} j\xE1 tinha no di\xE1rio: "${antes.subject}". Vai ficar: "${depois.subject}".` : `A ${a.texto} j\xE1 tinha um registro sem conte\xFAdo; ele ser\xE1 preenchido.`);
        edicoes.push({ id: registro.id, ...depois, antes, descricao: `${item.descricao}: ${a.texto}` });
      }
      if (!novos.length && !edicoes.length) {
        item.ok = true;
        return;
      }
      plano.criar.logs.push(...novos);
      plano.conteudos.push(...edicoes);
      const resumo = [conteudo && `"${conteudo}"`, tarefa && `tarefa: "${tarefa}"`].filter(Boolean).join(", ");
      item.descricao += ` \u2014 ${resumo}`;
      plano.resumo.push(item.descricao);
      item.ok = true;
    } catch (e) {
      if (!(e instanceof ConsultaError)) throw e;
      item.erro = e.message;
    }
  });
  return { itens, plano: plano.resumo.length ? plano : null };
};
var lapides = (raw) => ({ ...raw._deleted || {} });
var aplicarPlano = (raw, plano, agora = Date.now()) => {
  const mortos = lapides(raw);
  const todos = [...plano.criar.events, ...plano.criar.logs].map((i) => i.id);
  if (todos.some((id) => mortos[id] !== void 0)) {
    throw new ConsultaError("Esta pr\xE9via j\xE1 foi gravada e desfeita. Prepare de novo.");
  }
  const events = [...raw.events || []];
  const logs = [...raw.logs || []];
  const existentes = new Set([...events, ...logs].map((i) => i?.id));
  const jaGravado = todos.length > 0 && todos.every((id) => existentes.has(id));
  const lote = { em: agora, resumo: [], criados: { events: [], logs: [] }, situacoesAnteriores: [] };
  for (const ev of plano.criar.events) {
    if (existentes.has(ev.id)) continue;
    events.push({ ...ev, _m: agora });
    lote.criados.events.push(ev.id);
  }
  for (const log of plano.criar.logs) {
    if (existentes.has(log.id)) continue;
    logs.push({ ...log, _m: agora });
    lote.criados.logs.push(log.id);
  }
  for (const s of plano.situacoes) {
    const idx = events.findIndex((e) => e?.id === s.id);
    if (idx < 0) {
      lote.resumo.push(`N\xE3o encontrada (talvez apagada no app): ${s.descricao}`);
      continue;
    }
    const ev = events[idx];
    if (situacaoDe(ev) === s.situacao) continue;
    lote.situacoesAnteriores.push({ id: s.id, prepared: !!ev.prepared, scheduled: !!ev.scheduled, descricao: s.descricao });
    events[idx] = { ...ev, ...camposDaSituacao(s.situacao), _m: agora };
  }
  const conteudosAnteriores = [];
  let conteudoJaGravado = false;
  for (const c of plano.conteudos || []) {
    const idx = logs.findIndex((l) => l?.id === c.id);
    if (idx < 0) {
      lote.resumo.push(`N\xE3o gravado (o registro foi apagado no app depois da pr\xE9via): ${c.descricao}`);
      continue;
    }
    const log = logs[idx];
    const atual = { subject: log.subject || "", homework: log.homework || "" };
    if (atual.subject === c.subject && atual.homework === c.homework) {
      conteudoJaGravado = true;
      continue;
    }
    if (atual.subject !== c.antes.subject || atual.homework !== c.antes.homework) {
      lote.resumo.push(`N\xE3o gravado (o registro mudou no app depois da pr\xE9via; prepare de novo): ${c.descricao}`);
      continue;
    }
    conteudosAnteriores.push({ id: c.id, ...atual, descricao: c.descricao });
    logs[idx] = { ...log, subject: c.subject, homework: c.homework, _m: agora };
  }
  if (conteudosAnteriores.length) lote.conteudosAnteriores = conteudosAnteriores;
  lote.resumo.unshift(...plano.resumo);
  const mudouEventos = lote.criados.events.length + lote.situacoesAnteriores.length > 0;
  const mudouLogs = lote.criados.logs.length + conteudosAnteriores.length > 0;
  const alteracoes = {};
  if (mudouEventos) alteracoes.events = events;
  if (mudouLogs) alteracoes.logs = logs;
  const mudou = mudouEventos || mudouLogs;
  return { alteracoes, lote, jaGravado: !mudou && (jaGravado || plano.situacoes.length > 0 || conteudoJaGravado) };
};
var desfazerLote = (raw, lote, agora = Date.now()) => {
  const mortos = lapides(raw);
  const avisos = [];
  let events = [...raw.events || []];
  let logs = [...raw.logs || []];
  let mudouEventos = false;
  let mudouLogs = false;
  const remover = (lista, ids, nome) => {
    const alvo = new Set(ids);
    return lista.filter((i) => {
      if (!i || !alvo.has(i.id)) return true;
      if ((i._m ?? 0) > lote.em) {
        avisos.push(`Um ${nome} foi alterado no app depois da grava\xE7\xE3o e foi mantido.`);
        return true;
      }
      mortos[i.id] = agora;
      return false;
    });
  };
  const antesE = events.length;
  events = remover(events, lote.criados.events, "item de avalia\xE7\xE3o");
  mudouEventos = events.length !== antesE;
  const antesL = logs.length;
  logs = remover(logs, lote.criados.logs, "registro do di\xE1rio");
  mudouLogs = logs.length !== antesL;
  for (const s of lote.situacoesAnteriores) {
    const idx = events.findIndex((e) => e?.id === s.id);
    if (idx < 0) {
      avisos.push(`N\xE3o encontrada: ${s.descricao}`);
      continue;
    }
    if ((events[idx]._m ?? 0) > lote.em) {
      avisos.push(`Alterada no app depois; mantida: ${s.descricao}`);
      continue;
    }
    events[idx] = { ...events[idx], prepared: s.prepared, scheduled: s.scheduled, _m: agora };
    mudouEventos = true;
  }
  for (const c of lote.conteudosAnteriores || []) {
    const idx = logs.findIndex((l) => l?.id === c.id);
    if (idx < 0) {
      avisos.push(`Registro n\xE3o encontrado: ${c.descricao}`);
      continue;
    }
    if ((logs[idx]._m ?? 0) > lote.em) {
      avisos.push(`Registro alterado no app depois; mantido: ${c.descricao}`);
      continue;
    }
    logs[idx] = { ...logs[idx], subject: c.subject, homework: c.homework, _m: agora };
    mudouLogs = true;
  }
  const alteracoes = {};
  if (mudouEventos) alteracoes.events = events;
  if (mudouLogs) alteracoes.logs = logs;
  if (mudouEventos || mudouLogs) alteracoes._deleted = mortos;
  return { alteracoes, avisos, desfeito: mudouEventos || mudouLogs };
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
Datas no formato AAAA-MM-DD, no fuso de Bras\xEDlia; cada resposta informa "hoje".
Turmas e escolas podem ser escritas pelo nome (ex.: "183", "3\xAA S\xE9rie", "C\xF4nsul"); se o nome existir em mais de uma escola, informe a escola.
Responda ao Cadu em portugu\xEAs simples. N\xE3o h\xE1 dados de alunos (nomes, notas, chamada) neste conector.

Grava\xE7\xE3o (sempre em dois passos):
1. Use uma ferramenta "preparar_..." e mostre ao Cadu a pr\xE9via completa: o que ser\xE1 gravado, os avisos e os itens com erro.
2. S\xF3 chame "confirmar_gravacao" depois que o Cadu disser claramente que pode gravar. Nunca confirme por conta pr\xF3pria.
Se faltar informa\xE7\xE3o (ex.: a turma tem aulas seguidas e \xE9 preciso escolher a aula), pergunte ao Cadu antes de preparar de novo.
Conte\xFAdo de aula ("hoje na 183 dei\u2026"): use preparar_conteudo. Se a turma tiver aulas seguidas no dia, pergunte se o conte\xFAdo vale para todas ou s\xF3 para uma. Por padr\xE3o o texto \xE9 acrescentado ao que j\xE1 estiver no di\xE1rio; s\xF3 use modo "substituir" se o Cadu pedir.
Depois de gravar, diga que d\xE1 para desfazer e guarde o "codigo_desfazer" para usar em "desfazer_gravacao" se ele pedir.
Situa\xE7\xE3o das avalia\xE7\xF5es: Pendente \u2192 Agendada (alunos avisados) \u2192 Pronta (elaborada, enviada e alunos avisados).`;
var somenteLeitura = { readOnlyHint: true, openWorldHint: false };
var criarServidorMcp = (dados, hoje, escrita) => {
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
  if (escrita) registrarEscrita(servidor, dados, hoje, escrita);
  return servidor;
};
var texto = (corpo) => ({ content: [{ type: "text", text: JSON.stringify(corpo, null, 1) }] });
var falha = (mensagem) => ({ content: [{ type: "text", text: mensagem }], isError: true });
var registrarEscrita = (servidor, dados, hoje, escrita) => {
  const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD");
  const situacao = z.enum(SITUACOES);
  const gravacao = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const preparo = { readOnlyHint: true, openWorldHint: false };
  const previa = async (calcular) => {
    try {
      const { itens, plano } = calcular();
      return texto({
        hoje,
        previa: itens,
        ...plano ? {
          vai_gravar: plano.resumo,
          codigo_confirmacao: await assinarPlano(escrita.assinatura, escrita.uid, plano),
          proximo_passo: "Mostre a pr\xE9via ao Cadu. S\xF3 chame confirmar_gravacao com este c\xF3digo depois que ele confirmar. O c\xF3digo vale 1 hora."
        } : { vai_gravar: [], proximo_passo: "Nada a gravar. Resolva os erros com o Cadu e prepare de novo." }
      });
    } catch (e) {
      if (e instanceof ConsultaError) return falha(e.message);
      throw e;
    }
  };
  servidor.registerTool("preparar_avaliacoes", {
    title: "Preparar cadastro de avalia\xE7\xF5es",
    description: "Confere e mostra a pr\xE9via do cadastro de uma ou v\xE1rias provas/trabalhos (ex.: a partir de uma lista, foto ou PDF do calend\xE1rio da escola). Valida se a turma tem aula no dia, feriado, recesso e repeti\xE7\xE3o. N\xC3O grava: devolve um c\xF3digo para confirmar_gravacao.",
    inputSchema: {
      avaliacoes: z.array(z.object({
        turma: z.string().describe('Nome da turma, ex.: "183"'),
        escola: z.string().optional().describe("Nome da escola (necess\xE1rio se a turma existir em mais de uma)"),
        data: data.describe("Data da avalia\xE7\xE3o (AAAA-MM-DD)"),
        tipo: z.enum(["prova", "trabalho"]),
        titulo: z.string().describe('T\xEDtulo curto, ex.: "P3" ou "Trabalho Iluminismo"'),
        descricao: z.string().optional().describe('Conte\xFAdo ou cap\xEDtulos, ex.: "Cap. 12, 13 e 14"'),
        aula: z.number().int().min(1).max(12).optional().describe("N\xFAmero da aula no turno (1\xAA, 2\xAA\u2026). Obrigat\xF3rio quando a turma tem aulas seguidas no dia"),
        situacao: situacao.optional().describe("Padr\xE3o: Pendente")
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ avaliacoes }) => previa(() => prepararAvaliacoes(dados, avaliacoes, hoje)));
  servidor.registerTool("preparar_situacao", {
    title: "Preparar mudan\xE7a de situa\xE7\xE3o",
    description: "Mostra a pr\xE9via da mudan\xE7a de situa\xE7\xE3o de avalia\xE7\xF5es (Pendente, Agendada = alunos avisados, Pronta = elaborada, enviada e alunos avisados). N\xC3O grava: devolve um c\xF3digo para confirmar_gravacao.",
    inputSchema: {
      avaliacoes: z.array(z.object({
        turma: z.string(),
        escola: z.string().optional(),
        data: data.describe("Data da avalia\xE7\xE3o (AAAA-MM-DD)"),
        titulo: z.string().optional().describe("S\xF3 se a turma tiver mais de uma avalia\xE7\xE3o no dia"),
        situacao
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ avaliacoes }) => previa(() => prepararSituacoes(dados, avaliacoes)));
  servidor.registerTool("preparar_conteudo", {
    title: "Preparar registro de conte\xFAdo de aula",
    description: 'Mostra a pr\xE9via do registro do conte\xFAdo (e da tarefa) de aulas no di\xE1rio, ex.: "hoje na 183 dei Revolu\xE7\xE3o Industrial". Confere se a turma tem aula no dia, feriado e recesso; se a aula j\xE1 tiver registro, mostra como vai ficar. N\xC3O grava: devolve um c\xF3digo para confirmar_gravacao.',
    inputSchema: {
      registros: z.array(z.object({
        turma: z.string().describe('Nome da turma, ex.: "183"'),
        escola: z.string().optional().describe("Nome da escola (necess\xE1rio se a turma existir em mais de uma)"),
        data: data.describe('Data da aula (AAAA-MM-DD); "hoje" vem nas respostas do conector'),
        aulas: z.array(z.number().int().min(1).max(12)).optional().describe("N\xFAmeros das aulas no turno (ex.: [3, 4]). Obrigat\xF3rio quando a turma tem aulas seguidas no dia"),
        conteudo: z.string().optional().describe("O que foi dado na aula"),
        tarefa: z.string().optional().describe("Tarefa de casa, se houver"),
        modo: z.enum(["acrescentar", "substituir"]).optional().describe("Padr\xE3o: acrescentar ao que j\xE1 estiver no di\xE1rio")
      })).min(1).max(40)
    },
    annotations: preparo
  }, async ({ registros }) => previa(() => prepararConteudos(dados, registros, hoje)));
  servidor.registerTool("confirmar_gravacao", {
    title: "Confirmar grava\xE7\xE3o",
    description: "Grava no Leciona exatamente o que a pr\xE9via mostrou. Use S\xD3 depois que o Cadu confirmar a pr\xE9via. Devolve um codigo_desfazer.",
    inputSchema: { codigo: z.string().describe("codigo_confirmacao recebido na pr\xE9via") },
    annotations: gravacao
  }, async ({ codigo }) => {
    const plano = await lerPlano(escrita.assinatura, escrita.uid, codigo);
    if (!plano) return falha("C\xF3digo de confirma\xE7\xE3o inv\xE1lido ou vencido (vale 1 hora). Prepare a pr\xE9via de novo.");
    try {
      const r = await escrita.alterarDados(escrita.uid, (raw) => aplicarPlano(raw, plano));
      if (r.jaGravado) return texto({ gravado: false, mensagem: "Isso j\xE1 tinha sido gravado; nada foi duplicado." });
      return texto({
        gravado: true,
        resumo: r.lote.resumo,
        codigo_desfazer: await assinarLote(escrita.assinatura, escrita.uid, r.lote),
        proximo_passo: "Avise o Cadu que foi gravado e aparece no app em instantes. Guarde o codigo_desfazer (vale 30 dias)."
      });
    } catch (e) {
      if (e instanceof ConsultaError) return falha(e.message);
      throw e;
    }
  });
  servidor.registerTool("desfazer_gravacao", {
    title: "Desfazer grava\xE7\xE3o",
    description: "Desfaz uma grava\xE7\xE3o feita pelo conector: apaga o que ela criou e volta situa\xE7\xF5es e conte\xFAdos anteriores. Itens alterados no app depois da grava\xE7\xE3o s\xE3o mantidos.",
    inputSchema: { codigo_desfazer: z.string() },
    annotations: { ...gravacao, destructiveHint: true }
  }, async ({ codigo_desfazer }) => {
    const lote = await lerLote(escrita.assinatura, escrita.uid, codigo_desfazer);
    if (!lote) return falha("C\xF3digo para desfazer inv\xE1lido ou vencido (vale 30 dias).");
    const r = await escrita.alterarDados(escrita.uid, (raw) => desfazerLote(raw, lote));
    return texto({ desfeito: r.desfeito, o_que_era: lote.resumo, avisos: r.avisos });
  });
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
      const servidor = criarServidorMcp(dados, hojeEmBrasilia(deps.agora?.()), {
        uid: conta.uid,
        assinatura: assinatura(req),
        alterarDados: deps.alterarDados
      });
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
    },
    alterarDados: (uid, calcular) => db.runTransaction(async (tx) => {
      const ref = db.collection("users").doc(uid);
      const doc = await tx.get(ref);
      if (!doc.exists) throw new Error("Documento do professor n\xE3o encontrado.");
      const raw = doc.data();
      const r = calcular(raw);
      const campos = removeUndefined(r.alteracoes);
      if (Object.keys(campos).length) {
        if (estimateDocBytes({ ...raw, ...campos }) > FIRESTORE_DOC_LIMIT * 0.95) {
          throw new ConsultaError("Os dados do Leciona est\xE3o perto do limite da nuvem (1 MB). Nada foi gravado.");
        }
        tx.update(ref, { ...campos, updatedAt: Timestamp.now() });
      }
      return r;
    })
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
