// Roteiro de navegador real (Chrome headless) contra o app compilado + API + Postgres.
// Não rode direto: use `npm test` nesta pasta (run.mjs prepara banco, API, build e imagens).
import http from "node:http";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const MODE = process.argv[2] === "enforce" ? "enforce" : "report";
const DIST = process.env.E2E_DIST;
const WORK = process.env.E2E_WORK;
const ASSETS = process.env.E2E_ASSETS;
const API = process.env.E2E_API;
const PORT = Number(process.env.E2E_PORT ?? 8080);
const BASE = `http://localhost:${PORT}`;
const DL = `${WORK}/dl`;
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });
fs.mkdirSync(`${WORK}/shots`, { recursive: true });

// ---- servidor estático com SPA e os cabeçalhos do arquivo _headers
const headerLines = fs
  .readFileSync(path.join(DIST, "_headers"), "utf8")
  .split("\n")
  .filter((l) => /^\s+\S/.test(l))
  .map((l) => l.trim());
const headers = Object.fromEntries(
  headerLines.map((l) => {
    const i = l.indexOf(":");
    return [l.slice(0, i), l.slice(i + 1).trim().replace("https://SEU-WORKER.SEU-SUBDOMINIO.workers.dev", API)];
  }),
);
if (MODE === "report" && headers["Content-Security-Policy"]) {
  headers["Content-Security-Policy-Report-Only"] = headers["Content-Security-Policy"];
  delete headers["Content-Security-Policy"];
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain" };
const PROBE = "window.__evalResult = (() => { try { new Function('return 1')(); return 'permitido'; } catch { return 'bloqueado'; } })();";
const server = http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  if (url.pathname === "/__probe.js") {
    res.writeHead(200, { "Content-Type": "text/javascript", ...headers });
    return res.end(PROBE);
  }
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", ...headers });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

// ---- helpers
const results = [];
const violations = [];
const consoleErrors = [];
const step = async (nome, fn) => {
  try {
    await fn();
    results.push({ nome, ok: true });
    console.log("  ✓", nome);
  } catch (e) {
    results.push({ nome, ok: false, erro: e.message.split("\n")[0] });
    for (const [i, pg] of [admin, psi].entries()) { try { await pg.screenshot({ path: `${WORK}/shots/${results.length}-${i ? "psi" : "admin"}.png` }); } catch {} try { const t = await pg.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((x) => x.innerText).join(" | ")); if (t) console.log("      toast:", t.slice(0, 200)); } catch {} }
    console.log("  ✗", nome, "—", e.message.split("\n")[0]);
  }
};
const T = 8000;
const click = (page, sel) => page.locator(sel).setTimeout(T).click();
const fill = (page, sel, v) => page.locator(sel).setTimeout(T).fill(v);
const typeInto = async (page, sel, text) => {
  await page.focus(sel);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type(text);
};
const stored = (page, docId) =>
  page.evaluate(async (id) => {
    const r = await fetch(`http://localhost:8787/documents/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("mindcare.token")}` } });
    return (await r.json()).conteudo;
  }, docId);
const see = (page, text) => page.waitForSelector(`::-p-text(${text})`, { timeout: T });
const aria = (name, role) => `::-p-aria([name="${name}"]${role ? `[role="${role}"]` : ""})`;

async function newPage(ctx) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    const orig = URL.createObjectURL.bind(URL);
    window.__blobs = [];
    URL.createObjectURL = (b) => { window.__blobs.push(b); return orig(b); };
    document.addEventListener("securitypolicyviolation", (e) => {
      (window.__csp ||= []).push(`${e.violatedDirective} → ${e.blockedURI || "inline"}`);
    });
  });
  page.on("console", (m) => {
    if (process.env.DEBUG_CONSOLE) console.log("      [console]", m.type(), m.text().slice(0, 300));
    if (m.type() === "error" && !/favicon/.test(m.text())) consoleErrors.push(m.text().slice(0, 220));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
  return page;
}
const blobCount = (page) => page.evaluate(() => window.__blobs.length);
const lastPdf = (page) =>
  page.evaluate(async () => {
    const b = window.__blobs.at(-1);
    const head = String.fromCharCode(...new Uint8Array(await b.arrayBuffer()).slice(0, 5));
    return { size: b.size, head };
  });
const expectPdf = async (page, before, nome) => {
  for (let i = 0; i < 20 && (await blobCount(page)) <= before; i++) await new Promise((r) => setTimeout(r, 400));
  if ((await blobCount(page)) <= before) throw new Error(`${nome}: nenhum PDF foi gerado`);
  const { size, head } = await lastPdf(page);
  if (head !== "%PDF-" || size < 2000) throw new Error(`${nome}: PDF inválido (${head}, ${size} bytes)`);
  console.log(`      ${nome}: PDF gerado no navegador (${size} bytes)`);
};
const collect = async (page, label) => {
  try {
    const list = await page.evaluate(() => window.__csp ?? []);
    list.forEach((v) => violations.push(`[${label}] ${v}`));
  } catch {
    /* página já fechada */
  }
};

const browser = await puppeteer.launch({ args: [...chromium.args.filter((a) => a !== "--single-process" && a !== "--no-zygote"), "--no-sandbox"], executablePath: await chromium.executablePath(), headless: "shell" });
const cdp = await browser.target().createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
const popups = [];
browser.on("targetcreated", (t) => popups.push(t.url()));

const stamp = Date.now();
const adminEmail = `admin${stamp}@clinica.test`;
const psiEmail = `psi${stamp}@clinica.test`;
const PASS = "Senha@1234";
console.log(`\n=== Modo: ${MODE === "enforce" ? "CSP BLOQUEANDO" : "CSP SÓ AVISO (Report-Only)"} ===`);

await fetch(`${API}/platform/clinics`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-setup-token": "setup-browser" },
  body: JSON.stringify({ clinic_nome: "Clínica do Navegador", admin_nome: "Ada Admin", email: adminEmail, password: PASS }),
});

const adminCtx = await browser.createBrowserContext();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, browserContextId: adminCtx.id });
const admin = await newPage(adminCtx);
const psi = await newPage(browser.defaultBrowserContext());
let inviteLink = "";
let docCode = "";

await step("admin entra pela tela de login", async () => {
  await admin.goto(`${BASE}/entrar`);
  await fill(admin, aria("E-mail"), adminEmail);
  await fill(admin, aria("Senha"), PASS);
  await click(admin, aria("Entrar", "button"));
  await see(admin, "Clínica do Navegador");
});

await step("recarregar uma rota interna mantém a sessão (SPA + token)", async () => {
  await admin.goto(`${BASE}/usuarios`);
  await admin.waitForSelector("::-p-text(Pré-cadastre a equipe)", { timeout: T });
});

await step("admin pré-cadastra psicólogo e recebe o link", async () => {
  await click(admin, aria("Novo usuário", "button"));
  await fill(admin, aria("Nome completo"), "Dra. Teste Navegador");
  await fill(admin, aria("CRP"), "06/99999");
  await click(admin, aria("Criar e gerar link", "button"));
  const input = await admin.waitForSelector('input[aria-label="Link do convite"]', { timeout: T });
  inviteLink = await input.evaluate((e) => e.value);
  if (!inviteLink.includes("/convite/")) throw new Error(`link inesperado: ${inviteLink}`);
});

await step("psicólogo conclui o cadastro pelo link", async () => {
  await psi.goto(inviteLink.replace("http://localhost:8080", BASE));
  await see(psi, "Olá, Dra. Teste Navegador");
  await fill(psi, aria("E-mail"), psiEmail);
  await fill(psi, aria("Senha"), PASS);
  await fill(psi, aria("Confirmar senha"), PASS);
  await click(psi, aria("Concluir cadastro", "button"));
  await see(psi, "Dra. Teste Navegador");
  await psi.waitForSelector("nav ::-p-text(Documentos)", { timeout: T });
});

await step("admin cria papel timbrado 'cabeçalho gerado' com logo (upload real) e pré-visualiza", async () => {
  await admin.goto(`${BASE}/papel-timbrado`);
  await click(admin, aria("Novo modelo", "button"));
  await fill(admin, aria("Nome do modelo"), "Papel da clínica");
  const logo = await admin.waitForSelector("#l-logo", { timeout: T });
  await logo.uploadFile(`${ASSETS}/logo.png`);
  await admin.waitForSelector('img[alt="Logotipo"]', { timeout: T });
  await fill(admin, "#l-linhas", "Clínica do Navegador\nCNPJ 00.000.000/0001-00\n(11) 4444-0000");
  await fill(admin, "#l-rodape", "Atendimento mediante agendamento");
  const before = popups.length;
  const b0 = await blobCount(admin);
  await click(admin, aria("Visualizar exemplo", "button"));
  await expectPdf(admin, b0, "exemplo do papel timbrado");
  if (popups.length <= before) throw new Error("a pré-visualização do PDF não abriu uma aba");
  await click(admin, "#l-def");
  await click(admin, aria("Salvar", "button"));
  await see(admin, "Padrão");
});

await step("admin cria papel timbrado com imagem de fundo (upload e redução no navegador)", async () => {
  await click(admin, aria("Novo modelo", "button"));
  await fill(admin, aria("Nome do modelo"), "Papel com arte");
  await click(admin, 'label[for="m-imagem"]');
  const fundo = await admin.waitForSelector("#l-fundo", { timeout: T });
  await fundo.uploadFile(`${ASSETS}/fundo.png`);
  await admin.waitForSelector('img[alt="Papel timbrado"]', { timeout: T });
  await click(admin, aria("Salvar", "button"));
  await see(admin, "Papel com arte");
});

await step("psicólogo cadastra paciente e salva a anamnese", async () => {
  await click(psi, aria("Novo paciente", "button"));
  await fill(psi, "#p-nome", "Maria de Souza Navegador");
  await click(psi, aria("Cadastrar", "button"));
  await psi.waitForSelector("::-p-text(Paciente ativo)", { timeout: T });
  await click(psi, aria("Anamnese", "tab"));
  await fill(psi, "#a-queixa_principal", "Ansiedade e dificuldade para dormir.");
  await click(psi, aria("Salvar anamnese", "button"));
  await see(psi, "Anamnese salva");
});

await step("psicólogo cria o rascunho de uma declaração", async () => {
  await click(psi, aria("Documentos", "tab"));
  await click(psi, aria("Novo documento", "link"));
  await click(psi, 'button[aria-pressed] ::-p-text(Declaração)');
  await click(psi, aria("Criar rascunho", "button"));
  await psi.waitForSelector("#e-fin", { timeout: T });
  await fill(psi, "#e-fin", "Comprovar comparecimento ao atendimento");
  await fill(psi, "#e-local", "Cajamar/SP");
  const TEXTO = "Declaro, para os devidos fins, que Maria de Souza Navegador esteve em atendimento psicológico nesta data, das 14h às 15h.";
  await typeInto(psi, "#s-registro", TEXTO);
  await click(psi, aria("Salvar rascunho", "button"));
  await see(psi, "Rascunho salvo");
  const docId = new URL(psi.url()).pathname.split("/").pop();
  const guardado = (await stored(psi, docId)).registro;
  if (guardado !== TEXTO) throw new Error(`o texto digitado não foi gravado: ${JSON.stringify(guardado)}`);
  const naTela = await psi.$eval("#s-registro", (e) => e.value);
  if (naTela !== TEXTO) throw new Error("a tela perdeu o texto digitado depois de salvar");
});

await step("pré-visualização do PDF do rascunho abre numa nova aba", async () => {
  const before = popups.length;
  const b0 = await blobCount(psi);
  await click(psi, aria("Pré-visualizar PDF", "button"));
  await expectPdf(psi, b0, "rascunho");
  if (popups.length <= before) throw new Error("não abriu aba");
});

await step("psicólogo emite o documento e baixa o PDF real", async () => {
  await click(psi, aria("Emitir documento", "button"));
  await click(psi, '[role="alertdialog"] button ::-p-text(Emitir)');
  await see(psi, "Baixar PDF");
  const code = await psi.$eval("span.font-mono", (e) => e.textContent.trim());
  docCode = code.replace(/-/g, "");
  if (!/^[0-9A-Z]{12}$/.test(docCode)) throw new Error(`código inesperado: ${code}`);
  fs.readdirSync(DL).forEach((f) => fs.rmSync(path.join(DL, f)));
  await click(psi, aria("Baixar PDF", "button"));
  let file = "";
  for (let i = 0; i < 20 && !file; i++) {
    await new Promise((r) => setTimeout(r, 500));
    file = fs.readdirSync(DL).find((f) => f.endsWith(".pdf") || f.endsWith(".crdownload") === false) ?? "";
  }
  if (!file) throw new Error("o PDF não foi baixado");
  const full = path.join(DL, file);
  const bytes = fs.readFileSync(full);
  if (bytes.subarray(0, 5).toString() !== "%PDF-" || bytes.length < 3000) throw new Error("arquivo baixado não é um PDF válido");
  const texto = execFileSync("pdftotext", ["-layout", full, "-"]).toString();
  const precisa = ["DECLARAÇÃO", "Maria de Souza Navegador", "Dra. Teste Navegador", "CRP 06/99999", "2026/0001", docCode.replace(/(.{4})(?=.)/g, "$1-"), "Cajamar/SP", "das 14h às 15h"];
  const falta = precisa.filter((t) => !texto.includes(t));
  if (falta.length) throw new Error(`o PDF baixado não contém: ${falta.join(", ")}`);
  fs.copyFileSync(full, `${WORK}/emitido.pdf`);
  console.log(`      PDF baixado e conferido (${bytes.length} bytes): número, código, pessoa atendida e CRP presentes`);
});

await step("verificação pública abre sem login e confirma o documento", async () => {
  const anon = await newPage(await browser.createBrowserContext());
  await anon.goto(`${BASE}/verificar/${docCode}`);
  await anon.waitForSelector("::-p-text(Documento autêntico e válido)", { timeout: T });
  const body = await anon.evaluate(() => document.body.innerText);
  if (/Maria|Souza/.test(body)) throw new Error("a página pública expôs o nome da pessoa atendida");
  await collect(anon, "verificação");
});

/** Define o valor de um campo de hora/data controlado pelo React (o fill do Puppeteer não altera esses campos). */
async function setInput(page, selector, value) {
  await page.waitForSelector(selector, { timeout: T });
  await page.$eval(
    selector,
    (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
  const got = await page.$eval(selector, (el) => el.value);
  if (got !== value) throw new Error(`o campo ${selector} ficou com "${got}" em vez de "${value}"`);
}

let patientId = "";

await step("psicólogo agenda a sessão de hoje e marca como realizada (a cobrança nasce junto)", async () => {
  await psi.goto(`${BASE}/agenda`);
  await click(psi, aria("Nova sessão", "button"));
  await psi.waitForSelector("#s-pac", { timeout: T });
  await psi.waitForSelector("#s-pac option:nth-child(2)", { timeout: T });
  patientId = await psi.$eval("#s-pac option:nth-child(2)", (e) => e.value);
  await psi.select("#s-pac", patientId);
  await setInput(psi, "#s-hora", "00:10");
  await fill(psi, "#s-valor", "175");
  await click(psi, aria("Agendar", "button"));
  await see(psi, "Agendado");
  await click(psi, aria("Realizada", "button"));
  await see(psi, "A receber");
});

await step("no paciente, a cobrança da sessão é recebida e fica paga", async () => {
  await psi.goto(`${BASE}/pacientes/${patientId}`);
  await click(psi, aria("Cobranças", "tab"));
  await see(psi, "Em aberto");
  await click(psi, aria("Receber", "button"));
  await psi.waitForSelector("#r-valor", { timeout: T });
  await click(psi, aria("Registrar pagamento", "button"));
  await see(psi, "Pagamento registrado");
  await see(psi, "Paga");
});

await step("psicólogo cadastra o emissor, prepara a nota da cobrança e registra a nota emitida", async () => {
  await psi.goto(`${BASE}/nota-fiscal`);
  await psi.waitForSelector("#i-cnpj", { timeout: T });
  await fill(psi, "#i-cnpj", "11.222.333/0001-81");
  await fill(psi, "#i-razao", "Teste Navegador Psicologia Ltda");
  await fill(psi, "#i-ibge", "3516408");
  await click(psi, "#i-ok");
  await click(psi, aria("Cadastrar emissor", "button"));
  await see(psi, "Emissor salvo");
  await psi.goto(`${BASE}/pacientes/${patientId}`);
  await click(psi, aria("Cobranças", "tab"));
  await click(psi, "::-p-text(175,00)");
  await click(psi, aria("Preparar nota fiscal", "button"));
  await see(psi, "Rascunho");
  await psi.waitForSelector("#n-chave", { timeout: T });
  await fill(psi, "#n-chave", "1".repeat(50));
  await fill(psi, "#n-num", "7");
  await click(psi, aria("Registrar nota", "button"));
  await see(psi, "Emitida");
});

await step("administração vê o resumo do mês e baixa o CSV do financeiro", async () => {
  await admin.goto(`${BASE}/financeiro`);
  await see(admin, "Cobrado no mês");
  await see(admin, "Cobranças de");
  const texto = await admin.evaluate(() => document.body.innerText);
  if (!texto.includes("175,00")) throw new Error("o resumo não mostra o valor recebido (175,00)");
  fs.readdirSync(DL).forEach((f) => fs.rmSync(path.join(DL, f)));
  await click(admin, "::-p-text(Exportar CSV)");
  let file = "";
  for (let i = 0; i < 20 && !file; i++) {
    await new Promise((r) => setTimeout(r, 500));
    file = fs.readdirSync(DL).find((f) => f.endsWith(".csv")) ?? "";
  }
  if (!file) {
    const dbg = await admin.evaluate(async () => ({ blobs: window.__blobs.map((b) => `${b.type}:${b.size}`), toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((x) => x.innerText) }));
    throw new Error(`o CSV não foi baixado (arquivos: ${JSON.stringify(fs.readdirSync(DL))}; ${JSON.stringify(dbg)})`);
  }
  const csv = fs.readFileSync(path.join(DL, file), "utf8");
  if (!csv.includes("data;tipo;valor") || !csv.includes(";pagamento;175,00;")) throw new Error(`CSV inesperado: ${csv.slice(0, 200)}`);
});

await step("psicólogo registra uma sessão pro bono (sem valor, sem cobrança) e outra particular sem nota", async () => {
  await psi.goto(`${BASE}/agenda`);
  await click(psi, aria("Nova sessão", "button"));
  await psi.waitForSelector("#s-pac option:nth-child(2)", { timeout: T });
  await psi.select("#s-pac", patientId);
  await setInput(psi, "#s-hora", "20:00");
  await psi.select("#s-atend", "pro_bono");
  await click(psi, aria("Agendar", "button"));
  await see(psi, "Pro bono");
  await click(psi, aria("Realizada", "button"));
  await see(psi, "Sessão pro bono registrada");
  await click(psi, aria("Nova sessão", "button"));
  await psi.waitForSelector("#s-pac option:nth-child(2)", { timeout: T });
  await psi.select("#s-pac", patientId);
  await setInput(psi, "#s-hora", "02:00");
  await fill(psi, "#s-valor", "150");
  await click(psi, aria("Agendar", "button"));
  await click(psi, aria("Realizada", "button"));
  await see(psi, "Sem nota");
});

await step("administração vê as pendências de emissão e o histórico de uma sessão", async () => {
  await admin.goto(`${BASE}/financeiro`);
  await click(admin, aria("Fiscal", "tab"));
  await see(admin, "Pendências de emissão");
  await admin.goto(`${BASE}/agenda`);
  await click(admin, aria("Histórico", "button"));
  await see(admin, "Histórico da sessão");
  await see(admin, "criou");
});

await step("psicólogo bloqueia um horário na agenda e remove o bloqueio", async () => {
  await psi.goto(`${BASE}/agenda`);
  await click(psi, aria("Bloquear horário", "button"));
  await psi.waitForSelector("#b-ini", { timeout: T });
  await setInput(psi, "#b-ini", "12:00");
  await setInput(psi, "#b-fim", "13:00");
  await fill(psi, "#b-motivo", "Almoço");
  await click(psi, aria("Bloquear", "button"));
  await see(psi, "Bloqueado 12:00");
  await click(psi, aria("Remover bloqueio", "button"));
  await see(psi, "Bloqueio removido");
});

await step("administração vê o resumo por profissional", async () => {
  await admin.goto(`${BASE}/financeiro`);
  await click(admin, aria("Resumo", "tab"));
  await see(admin, "Por profissional");
});

await step("outro usuário sem permissão é redirecionado de /usuarios", async () => {
  await psi.goto(`${BASE}/usuarios`);
  await psi.waitForSelector("::-p-text(Pacientes da clínica)", { timeout: T }).catch(() => psi.waitForSelector("::-p-text(sob a sua responsabilidade)", { timeout: T }));
});

await step("a CSP está ativa: bloqueia fetch externo, eval e script de outro domínio", async () => {
  const page = await newPage(await browser.createBrowserContext());
  await page.goto(`${BASE}/entrar`);
  await see(page, "Entrar na sua conta");
  const r = await page.evaluate(async () => {
    const out = {};
    try { await fetch("https://evil.example/roubo"); out.fetch = "permitido"; } catch { out.fetch = "bloqueado"; }
    await new Promise((res) => {
      const el = document.createElement("script");
      el.src = "/__probe.js";
      el.onload = res;
      el.onerror = res;
      document.head.appendChild(el);
    });
    out.eval = window.__evalResult;
    out.script = await new Promise((res) => {
      const el = document.createElement("script");
      el.src = "https://evil.example/x.js";
      el.onload = () => res("permitido");
      el.onerror = () => res("bloqueado");
      document.head.appendChild(el);
    });
    await new Promise((x) => setTimeout(x, 300));
    out.eventos = (window.__csp ?? []).length;
    return out;
  });
  console.log("      resultado:", JSON.stringify(r));
  if (MODE === "enforce") {
    if (r.eval !== "bloqueado") throw new Error("eval deveria ser bloqueado");
    if (r.eventos < 3) throw new Error(`esperava ao menos 3 avisos de CSP, vieram ${r.eventos}`);
  } else if (r.eval !== "permitido" || r.eventos < 3) {
    throw new Error("em Report-Only o eval segue permitido, mas os avisos deveriam ser registrados");
  }
  await page.close();
});

await collect(admin, "admin");
await collect(psi, "psicólogo");
await browser.close();
server.close();

const falhas = results.filter((r) => !r.ok);
console.log(`\nPassos: ${results.length - falhas.length}/${results.length} ok`);
const uniq = [...new Set(violations)];
console.log(`Violações de CSP: ${uniq.length}`);
uniq.forEach((v) => console.log("   -", v));
const errs = [...new Set(consoleErrors)];
console.log(`Erros no console: ${errs.length}`);
errs.slice(0, 10).forEach((v) => console.log("   -", v));
process.exit(falhas.length ? 1 : 0);
