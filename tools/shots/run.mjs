// Gera capturas de tela da versão atual do MindCare com DADOS FICTÍCIOS (para o relatório acadêmico).
// Sobe banco local + API local + front compilado, popula uma clínica de exemplo e fotografa as telas.
// Uso (no CI): node tools/shots/run.mjs   → imagens em tools/shots/out
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const OUT = path.join(here, "out");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8080;
const API_PORT = 8787;
const API = `http://localhost:${API_PORT}`;
const BASE = `http://localhost:${PORT}`;
const pg = createRequire(path.join(root, "api", "package.json"))("pg");
const host = process.env.TEST_PG_HOST ?? "127.0.0.1:5432";
const url = (u, pw, db) => `postgres://${u}:${pw}@${host}/${db}`;
const OWNER = url("mc_owner", "owner_pw", "mindcare_shots");

// ---------- banco
const admin = new pg.Client({ connectionString: url("mc_owner", "owner_pw", "postgres") });
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS mindcare_shots WITH (FORCE)");
await admin.query("CREATE DATABASE mindcare_shots");
await admin.end();
execFileSync("node", ["api/scripts/migrate.mjs"], { cwd: root, env: { ...process.env, DATABASE_URL: OWNER }, stdio: "inherit" });
const owner = new pg.Client({ connectionString: OWNER });
await owner.connect();
await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mc_app') THEN
  CREATE ROLE mc_app LOGIN PASSWORD 'app_pw' IN ROLE app_runtime; END IF; END $$`);

// ---------- front e API
const dist = path.join(here, ".dist");
execFileSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir"], { cwd: root, env: { ...process.env, VITE_API_URL: API }, stdio: "inherit" });
const api = spawn("npx", ["tsx", "src/node.ts"], {
  cwd: path.join(root, "api"), detached: true, stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url("mc_app", "app_pw", "mindcare_shots"), JWT_SECRET: "segredo-das-capturas-com-tamanho-ok-123456",
    SETUP_TOKEN: "setup-shots", APP_URL: BASE, ALLOWED_ORIGIN: BASE, SCRYPT_N: "1024", PORT: String(API_PORT) },
});
const stop = () => { try { process.kill(-api.pid); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 60; i++) {
  if (await fetch(`${API}/health/db`).then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 500));
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".woff2": "font/woff2" };
http.createServer((req, res) => {
  const u = new URL(req.url, BASE);
  let f = path.join(dist, decodeURIComponent(u.pathname));
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(PORT);

// ---------- helpers de API
let idem = 0;
async function call(method, p, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(API + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  if (!r.ok) console.log(`  ! ${method} ${p} → ${r.status} ${t.slice(0, 200)}`);
  return { status: r.status, json: j };
}
const PASSWORD = "Senha@1234";
function cpf(seed) {
  const d = String(100000000 + ((seed * 7919) % 899999999)).slice(0, 9).split("").map(Number);
  for (const len of [9, 10]) { let s = 0; for (let i = 0; i < len; i++) s += d[i] * (len + 1 - i); d.push(((s * 10) % 11) % 10); }
  return d.join("");
}
function cns() {
  for (;;) {
    const d = [7, ...Array.from({ length: 13 }, () => Math.floor(Math.random() * 10))];
    let s = 0; for (let i = 0; i < 14; i++) s += d[i] * (15 - i);
    for (let last = 0; last < 10; last++) if ((s + last) % 11 === 0) return [...d, last].join("");
  }
}

// "Agora" fictício: quinta-feira desta semana (ou da próxima, se já passou), 10h40 em São Paulo.
const nowSP = new Date(Date.now() - 3 * 3600e3);
const dow = (nowSP.getUTCDay() + 6) % 7; // 0 = segunda
const mondayUTC = Date.UTC(nowSP.getUTCFullYear(), nowSP.getUTCMonth(), nowSP.getUTCDate() - dow + (dow >= 3 ? 7 : 0));
const dayStr = (weekOffset, wd) => new Date(mondayUTC + (weekOffset * 7 + wd) * 86400e3).toISOString().slice(0, 10);
const at = (weekOffset, wd, hhmm) => `${dayStr(weekOffset, wd)}T${hhmm}:00-03:00`;
const FAKE_NOW = new Date(at(0, 3, "10:40"));
const plus50 = (iso) => new Date(new Date(iso).getTime() + 50 * 60e3).toISOString();
console.log("Agora fictício:", FAKE_NOW.toISOString());

// ---------- dados fictícios
const clinicEmail = "admin@clinicaexemplo.test";
await call("POST", "/platform/clinics", { headers: { "x-setup-token": "setup-shots" },
  body: { clinic_nome: "Clínica Exemplo de Psicologia", admin_nome: "Helena Martins", email: clinicEmail, password: PASSWORD } });
const adminTok = (await call("POST", "/auth/login", { body: { email: clinicEmail, password: PASSWORD } })).json.token;
async function mkUser(body, email) {
  const c = await call("POST", "/users", { token: adminTok, body });
  const tk = c.json.invite.link.split("/convite/")[1];
  const a = await call("POST", "/invites/accept", { body: { token: tk, email, password: PASSWORD } });
  return { id: c.json.user.id, token: a.json.token, email };
}
const psi = await mkUser({ nome: "Marina Costa", role: "psicologo", crp: "06/123456", cpf: cpf(11), pix_chave: "marina.costa@exemplo.com.br" }, "marina@clinicaexemplo.test");
await mkUser({ nome: "Paulo Henrique", role: "recepcao" }, "recepcao@clinicaexemplo.test");
await mkUser({ nome: "Ricardo Alves", role: "psicologo", crp: "06/654321", cpf: cpf(12) }, "ricardo@clinicaexemplo.test");
const T = psi.token;
await call("POST", "/services", { token: T, body: { nome: "Sessão individual (50 min)", valor_centavos: 18000 } });
await call("POST", "/services", { token: T, body: { nome: "Avaliação inicial", valor_centavos: 22000 } });

const P = [
  { k: "jul", nome: "Juliana Ferreira", nasc: "1991-04-12", tel: "11987654321", wd: 3, h: "10:00", genero: "Feminino", profissao: "Analista de marketing", estado_civil: "Solteira" },
  { k: "raf", nome: "Rafael Mendes", nasc: "1985-09-03", tel: "11991234567", wd: 0, h: "08:00" },
  { k: "bea", nome: "Beatriz Albuquerque", nasc: "1998-01-25", tel: "11976543210", wd: 0, h: "14:00" },
  { k: "edu", nome: "Eduardo Rocha", nasc: "1979-06-30", tel: "11965432109", wd: 1, h: "10:00" },
  { k: "luc", nome: "Lucas Andrade", nasc: "2016-08-14", tel: "11954321098", wd: 1, h: "16:00" },
  { k: "fer", nome: "Fernanda Ribeiro", nasc: "1993-11-02", tel: "11943210987", wd: 2, h: "09:00" },
  { k: "gus", nome: "Gustavo Pires", nasc: "1988-02-17", tel: "11932109876", wd: 2, h: "18:00" },
  { k: "cam", nome: "Camila Souza", nasc: "2000-05-21", tel: "11921098765", wd: 3, h: "15:00" },
  { k: "thi", nome: "Thiago Nascimento", nasc: "1995-12-09", tel: "11910987654", wd: 4, h: "11:00" },
  { k: "pat", nome: "Patrícia Lima", nasc: "1983-03-28", tel: "11909876543", wd: 4, h: "14:00", sumiu: true },
];
const pid = {};
for (const [i, p] of P.entries()) {
  const body = { nome: p.nome, data_nascimento: p.nasc, telefone: p.tel, email: `${p.k}@email-ficticio.test`, cpf: cpf(100 + i) };
  if (p.genero) Object.assign(body, { genero: p.genero, profissao: p.profissao, estado_civil: p.estado_civil });
  if (p.k === "jul") Object.assign(body, { cns: cns(), end_cep: "01310100", end_logradouro: "Avenida Paulista", end_numero: "1000", end_complemento: "apto 52", end_bairro: "Bela Vista", end_cidade: "São Paulo", end_uf: "SP" });
  if (p.k === "luc") Object.assign(body, { end_cep: "04094050", end_logradouro: "Avenida Pedro Álvares Cabral", end_numero: "200", end_bairro: "Vila Mariana", end_cidade: "São Paulo", end_uf: "SP",
    responsavel_nome: "Carla Andrade", responsavel_cpf: cpf(300), responsavel_vinculo: "Mãe", responsavel_telefone: "11954321000" });
  const r = await call("POST", "/patients", { token: T, body });
  pid[p.k] = r.json.id;
}
await call("PATCH", `/patients/${pid.jul}`, { token: T, body: { observacoes: "Prefere contato por WhatsApp. Costuma chegar 10 minutos antes; pode aguardar na sala 2." } });
await call("PATCH", `/patients/${pid.luc}`, { token: T, body: { observacoes: "Vem acompanhado da mãe. Lembrar de entregar a declaração de comparecimento para a escola." } });
await call("PUT", `/patients/${pid.jul}/anamnesis`, { token: T, body: { queixa_principal: "Ansiedade e dificuldade para dormir em períodos de muita demanda no trabalho.", medicamentos: "Nenhum" } });

// pacote para o Lucas
await call("POST", "/packages", { token: T, body: { patient_id: pid.luc, sessoes: 8, valor_centavos: 128000, vencimento: dayStr(-7, 0) } });

// agenda: semanal, 7 semanas para trás até 2 à frente
const appts = {}; // k -> [{id, starts_at}]
for (const p of P) {
  const start = p.sumiu ? -9 : -7;
  const n = p.sumiu ? 4 : 10;
  const r = await call("POST", "/appointments", { token: T, body: { patient_id: pid[p.k], starts_at: at(start, p.wd, p.h), ends_at: plus50(at(start, p.wd, p.h)), valor: p.k === "luc" ? 160 : 180, recorrencia: { frequencia: "semanal", ocorrencias: n } } });
  appts[p.k] = r.json;
}
await call("POST", "/blocks", { token: T, body: { starts_at: at(0, 2, "12:00"), ends_at: at(0, 2, "13:00"), motivo: "Supervisão clínica" } });
await call("POST", "/blocks", { token: T, body: { starts_at: at(0, 4, "16:00"), ends_at: at(0, 4, "18:00"), motivo: "Curso de atualização" } });

const REG = [
  "Primeira sessão. Paciente relata ansiedade intensa no trabalho, dificuldade para iniciar o sono e preocupação constante com prazos. Combinado o contrato terapêutico e a frequência semanal.",
  "Exploradas as situações que disparam a ansiedade. Paciente identificou reuniões com a liderança como principal gatilho. Introduzida a respiração diafragmática.",
  "Relata ter usado a respiração em duas ocasiões, com alívio parcial. Trabalhado o registro de pensamentos automáticos.",
  "Semana mais tranquila. Trouxe o registro de pensamentos; discutidas distorções de catastrofização. Sono ainda irregular.",
  "Paciente relata que conseguiu falar na reunião sem crise. Combinada rotina de higiene do sono (horário fixo, sem telas uma hora antes).",
  "Melhora no sono (dorme por volta das 23h na maior parte dos dias). Retomadas metas do plano terapêutico; avaliação positiva da evolução.",
  "Sessão focada em prevenção de recaída: identificação de sinais precoces e plano de ação. Paciente refere sentir-se mais confiante.",
];
const charges = [];
let rec = 0;
for (const p of P) {
  for (const [idx, a] of appts[p.k].entries()) {
    const when = new Date(a.starts_at);
    if (when >= FAKE_NOW) continue;
    // algumas exceções para a agenda parecer real
    if (p.k === "edu" && when > new Date(at(0, 0, "00:00"))) { await call("PATCH", `/appointments/${a.id}`, { token: T, body: { status: "cancelado" } }); continue; }
    if (p.k === "fer" && idx === 6) { await call("PATCH", `/appointments/${a.id}`, { token: T, body: { status: "faltou" } }); continue; }
    await call("PATCH", `/appointments/${a.id}`, { token: T, body: { status: "realizado" } });
    let ch = null;
    if (p.k === "luc") await call("POST", "/packages/use", { token: T, body: { appointment_id: a.id } });
    else ch = (await call("POST", "/charges", { token: T, body: { patient_id: pid[p.k], appointment_id: a.id, vencimento: when.toISOString().slice(0, 10) } })).json;
    if (ch?.id) charges.push({ id: ch.id, k: p.k, when });
    if (p.k === "jul") {
      await call("PUT", `/appointments/${a.id}/record`, { token: T, body: { conteudo: REG[rec % REG.length], anotacoes: rec === 3 ? "Hipótese: perfeccionismo como fator de manutenção. Investigar histórico escolar." : undefined } });
      await owner.query("UPDATE session_records SET created_at = $2, updated_at = $2 WHERE appointment_id = $1", [a.id, plus50(a.starts_at)]).catch((e) => console.log("  ! records", e.message));
      rec++;
    }
  }
}
// pagamentos: quase tudo pago; alguns em aberto para mostrar pendências
for (const c of charges) {
  const recente = FAKE_NOW - c.when < 13 * 86400e3;
  if (recente && ["jul", "gus", "thi"].includes(c.k)) continue;
  await call("POST", `/charges/${c.id}/payments`, { token: T, headers: { "Idempotency-Key": `shots-pay-${idem++}-xxxxxxxx` }, body: { valor_centavos: 18000, metodo: ["pix", "pix", "cartao", "transferencia"][idem % 4] } });
}
// observação em agendamentos futuros
const fut = (k) => appts[k].find((a) => new Date(a.starts_at) > FAKE_NOW);
await call("PATCH", `/appointments/${fut("cam").id}`, { token: T, body: { observacao: "Paciente pediu para confirmar por mensagem na véspera." } });
await call("PATCH", `/appointments/${fut("jul").id}`, { token: T, body: { observacao: "Trazer o registro de pensamentos da semana." } });

// plano terapêutico e escalas da Juliana
const jPast = appts.jul.filter((a) => new Date(a.starts_at) < FAKE_NOW);
const g1 = (await call("POST", `/patients/${pid.jul}/goals`, { token: T, body: { titulo: "Reduzir crises de ansiedade no trabalho", descricao: "Menos de uma crise por semana e participação ativa nas reuniões." } })).json;
const g2 = (await call("POST", `/patients/${pid.jul}/goals`, { token: T, body: { titulo: "Regularizar o sono", descricao: "Dormir até as 23h em ao menos 5 dias da semana." } })).json;
const g3 = (await call("POST", `/patients/${pid.jul}/goals`, { token: T, body: { titulo: "Retomar atividade física", descricao: "Caminhada três vezes por semana." } })).json;
await owner.query("UPDATE therapy_goals SET created_at = $1", [jPast[0].starts_at]);
const notas1 = [2, 3, 3, 5, 6, 7, 8], notas2 = [3, 3, 4, 4, 6, 7, 7], notas3 = [1, 1, 2, 2, 3, 4, 4];
for (const [i, a] of jPast.entries()) {
  for (const [g, n] of [[g1, notas1], [g2, notas2], [g3, notas3]]) {
    if (i === 0 && g === g3) continue;
    const r = await call("POST", `/goals/${g.id}/progress`, { token: T, body: { nota: n[Math.min(i, n.length - 1)], appointment_id: a.id } });
    if (r.json?.id) await owner.query("UPDATE goal_progress SET created_at = $2 WHERE id = $1", [r.json.id, plus50(a.starts_at)]);
  }
}
const phq = [[2, 2, 2, 2, 1, 2, 2, 1, 0], [2, 2, 1, 2, 1, 1, 1, 1, 0], [1, 1, 1, 1, 1, 1, 1, 0, 0], [1, 1, 0, 1, 0, 1, 0, 0, 0]];
const gad = [[3, 2, 3, 2, 2, 2, 2], [2, 2, 2, 2, 1, 2, 1], [2, 1, 1, 1, 1, 1, 1], [1, 1, 1, 0, 1, 0, 1]];
for (const [i, j] of [0, 2, 4, 6].entries()) {
  const a = jPast[Math.min(j, jPast.length - 1)];
  for (const [esc, resp] of [["phq9", phq[i]], ["gad7", gad[i]]]) {
    const r = await call("POST", `/patients/${pid.jul}/scales`, { token: T, body: { escala: esc, respostas: resp, appointment_id: a.id } });
    if (r.json?.id) await owner.query("UPDATE scale_applications SET created_at = $2 WHERE id = $1", [r.json.id, plus50(a.starts_at)]);
  }
}
// datas de cobranças e pagamentos coerentes com as sessões
await owner.query("SET session_replication_role = replica");
await owner.query(`UPDATE charges ch SET created_at = a.starts_at + interval '1 hour' FROM appointments a WHERE a.id = ch.appointment_id`).catch((e) => console.log("  ! charges", e.message));
await owner.query(`UPDATE payments pg SET created_at = ch.created_at + interval '2 hours', pago_em = (ch.created_at + interval '2 hours')::date FROM charges ch WHERE ch.id = pg.charge_id`).catch((e) => console.log("  ! payments", e.message));

await owner.query("SET session_replication_role = origin");
// documento emitido
const doc = await call("POST", "/documents", { token: T, body: { patient_id: pid.luc, tipo: "declaracao", finalidade: "Apresentação na escola", conteudo: { registro: `Compareceu a atendimento psicológico em ${dayStr(-1, 1).split("-").reverse().join("/")}, das 16h00 às 16h50.` } } });
if (doc.json?.id) await call("POST", `/documents/${doc.json.id}/emit`, { token: T, body: {} });
await call("POST", "/documents", { token: T, body: { patient_id: pid.jul, tipo: "declaracao", finalidade: "Comprovação junto ao empregador", conteudo: { registro: "Compareceu a atendimento psicológico." } } });

// ---------- capturas
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
await ctx.addInitScript(({ now }) => {
  const Real = Date; const off = now - Real.now();
  // relógio fictício: mesma velocidade, deslocado para o "agora" do roteiro
  class D extends Real { constructor(...a) { super(...(a.length ? a : [Real.now() + off])); } static now() { return Real.now() + off; } }
  globalThis.Date = D;
}, { now: FAKE_NOW.getTime() });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  pageerror:", e.message));
const wait = (ms) => page.waitForTimeout(ms);
const settle = async () => { await page.waitForLoadState("networkidle").catch(() => {}); await wait(900); };
const shot = async (name, fn, opts = {}) => {
  try { await fn(); await settle(); await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !!opts.full }); console.log("  ✓", name); }
  catch (e) { console.log("  ✗", name, e.message.split("\n")[0]); await page.screenshot({ path: path.join(OUT, `ERRO-${name}.png`) }).catch(() => {}); }
};
const go = async (p, { token = T, view } = {}) => {
  await page.goto(BASE + "/entrar");
  await page.evaluate(({ token, view }) => { localStorage.clear(); if (token) localStorage.setItem("mindcare.token", token); if (view) localStorage.setItem("agenda-view", view); }, { token, view });
  await page.goto(BASE + p);
};

await shot("01-login", async () => { await go("/entrar", { token: null }); await page.locator("input[type=email]").first().fill("marina@clinicaexemplo.test"); await page.locator("input[type=password]").first().fill("Senha@1234"); });
await shot("02-agenda-semana", () => go("/agenda", { view: "grade" }));
await shot("03-agenda-dia", () => go("/agenda", { view: "dia" }));
await shot("04-agenda-lista", () => go("/agenda", { view: "lista" }));
await shot("05-card-sessao", async () => { await go("/agenda", { view: "dia" }); await settle(); await page.getByText("Juliana Ferreira").first().click(); });
const jThu = appts.jul.find((a) => new Date(a.starts_at) > new Date(at(0, 3, "00:00")));
await shot("06-atendimento", async () => {
  await go(`/pacientes/${pid.jul}/atendimento/${jThu.id}`); await settle();
  const ta = page.locator("#pr-conteudo");
  if (await ta.count()) await ta.pressSequentially("Paciente relata semana produtiva e apenas um episódio de ansiedade, manejado com a respiração. ", { delay: 2, timeout: 10000 }).catch((e) => console.log("   (texto)", e.message.split("\n")[0]));
  else console.log("   sem #pr-conteudo; botões:", (await page.locator("button").allInnerTexts()).join(" | ").slice(0, 400));
}, { full: true });
await shot("07-pacientes", () => go("/pacientes"));
await shot("08-paciente-dados-lucas", () => go(`/pacientes/${pid.luc}`), { full: true });
const tab = (name) => async () => { await go(`/pacientes/${pid.jul}`); await settle(); await page.getByRole("tab", { name }).click(); };
await shot("09-paciente-dados-juliana", () => go(`/pacientes/${pid.jul}`), { full: true });
await shot("10-linha-do-tempo", tab("Linha do tempo"), { full: true });
await shot("11-prontuario", tab("Prontuário"), { full: true });
await shot("12-plano-terapeutico", tab("Plano terapêutico"), { full: true });
await shot("13-escalas", tab("Escalas"), { full: true });
await shot("14-cobrancas-paciente", tab("Cobranças"), { full: true });
await shot("15-cobranca-pix", async () => { await tab("Cobranças")(); await settle(); await page.getByText(/em aberto|pendente|vencid/i).first().click(); });
await shot("16-novo-paciente-cep", async () => {
  await go("/pacientes/novo"); await settle();
  await page.getByLabel(/nome/i).first().fill("Mariana Teixeira").catch(() => {});
  const cep = page.getByLabel(/CEP/i).first();
  await cep.fill("01310-100"); await cep.press("Tab"); await wait(3000);
  await page.getByLabel(/número/i).first().fill("1578").catch(() => {});
}, { full: true });
await shot("17-financeiro", () => go("/financeiro"), { full: true });
await shot("18-financeiro-resumo", async () => { await go("/financeiro", { token: adminTok }); await settle(); await page.getByRole("tab", { name: "Resumo" }).click(); }, { full: true });
await shot("19-documentos", () => go("/documentos"));
await shot("20-politicas", () => go("/politicas"));
await shot("21-links", () => go("/links"));
await shot("22-usuarios", () => go("/usuarios", { token: adminTok }));
await shot("23-clinica", () => go("/clinica", { token: adminTok }), { full: true });
await shot("24-agenda-recepcao", async () => go("/agenda", { token: (await call("POST", "/auth/login", { body: { email: "recepcao@clinicaexemplo.test", password: PASSWORD } })).json.token, view: "grade" }));

await browser.close();
await owner.end();
stop();
console.log("Capturas em", OUT, fs.readdirSync(OUT));
process.exit(0);
