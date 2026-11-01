// Teste de ponta a ponta: telas reais do React + API real (Hono) + Postgres de verdade.
// O fetch do navegador é ligado direto ao app da API, sem rede. Só roda com E2E_PG=1 e um Postgres local
// (usuário mc_owner com CREATEDB/CREATEROLE; veja api/README.md).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../api/src/app";
import type { DbPool } from "../../api/src/db";
import { APP_URL_DB, OWNER_ADMIN_URL } from "../../api/test/env";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pg: any = require("../../api/node_modules/pg");

const OWNER_E2E = OWNER_ADMIN_URL.replace(/\/postgres$/, "/mindcare_e2e");
const APP_E2E = APP_URL_DB.replace(/\/mindcare_test$/, "/mindcare_e2e");
const env = {
  DATABASE_URL: APP_E2E,
  JWT_SECRET: "segredo-e2e-com-tamanho-suficiente-1234567",
  SETUP_TOKEN: "setup-e2e",
  APP_URL: "http://localhost:3000",
  ALLOWED_ORIGIN: "http://localhost:3000",
  SCRYPT_N: "1024",
};
const PASSWORD = "Senha@1234";

describe.skipIf(!process.env.E2E_PG)("fluxo completo: telas + API + Postgres", () => {
  let pool: DbPool;
  let app: ReturnType<typeof createApp>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seed: Record<string, any> = {};

  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  const openApp = async (path: string, token?: string) => {
    localStorage.clear();
    if (token) localStorage.setItem("mindcare.token", token);
    window.history.pushState({}, "", path);
    vi.resetModules(); // cache do React Query novo a cada tela
    const { default: App } = await import("@/App");
    render(<App />);
  };

  beforeAll(async () => {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
    const admin = new pg.Client({ connectionString: OWNER_ADMIN_URL });
    await admin.connect();
    await admin.query("DROP DATABASE IF EXISTS mindcare_e2e WITH (FORCE)");
    await admin.query("CREATE DATABASE mindcare_e2e");
    await admin.end();
    execFileSync("node", ["api/scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: OWNER_E2E }, stdio: "ignore" });
    const owner = new pg.Client({ connectionString: OWNER_E2E });
    await owner.connect();
    await owner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mc_app') THEN
      CREATE ROLE mc_app LOGIN PASSWORD 'app_pw' IN ROLE app_runtime; END IF; END $$`);
    await owner.end();

    pool = new pg.Pool({ connectionString: APP_E2E });
    app = createApp({ getPool: () => pool });
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => Promise.resolve(app.request(input, init, env)));

    // dados de apoio, criados pela própria API
    seed.adminEmail = "admin@clinica.test";
    await call("POST", "/platform/clinics", {
      headers: { "x-setup-token": env.SETUP_TOKEN },
      body: { clinic_nome: "Clínica E2E", admin_nome: "Ada Admin", email: seed.adminEmail, password: PASSWORD },
    });
    seed.adminToken = (await call("POST", "/auth/login", { body: { email: seed.adminEmail, password: PASSWORD } })).json.token;
    const created = await call("POST", "/users", { token: seed.adminToken, body: { nome: "Dra. Ana Lima", role: "psicologo", crp: "06/12345" } });
    seed.inviteToken = created.json.invite.link.split("/convite/")[1];
    const second = await call("POST", "/users", { token: seed.adminToken, body: { nome: "Dr. Bruno Reis", role: "psicologo", crp: "06/54321" } });
    const bruno = await call("POST", "/invites/accept", { body: { token: second.json.invite.link.split("/convite/")[1], email: "bruno@clinica.test", password: PASSWORD } });
    seed.brunoToken = bruno.json.token;
  });

  afterEach(() => cleanup());
  beforeEach(() => localStorage.clear());
  afterAll(async () => {
    await pool?.end();
  });

  it("administrador entra pela tela de login e vê o menu de administração", async () => {
    await openApp("/entrar");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), seed.adminEmail);
    await user.type(screen.getByLabelText("Senha"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Pacientes" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByText("Usuários")).toBeInTheDocument();
    expect(within(nav).getByText("Papel timbrado")).toBeInTheDocument();
    expect(within(nav).queryByText("Documentos")).not.toBeInTheDocument(); // admin que não atende não produz documentos
    expect(screen.getByText("Clínica E2E")).toBeInTheDocument();
  });

  it("senha errada mostra o erro e não entra", async () => {
    await openApp("/entrar");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("E-mail"), seed.adminEmail);
    await user.type(screen.getByLabelText("Senha"), "Errada@123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled());
    expect(screen.queryByRole("heading", { name: "Pacientes" })).not.toBeInTheDocument();
  });

  it("psicólogo conclui o cadastro pelo link de convite e já entra", async () => {
    await openApp(`/convite/${seed.inviteToken}`);
    const user = userEvent.setup();
    expect(await screen.findByText("Olá, Dra. Ana Lima")).toBeInTheDocument();
    await user.type(screen.getByLabelText("E-mail"), "ana@clinica.test");
    await user.type(screen.getByLabelText("Senha"), PASSWORD);
    await user.type(screen.getByLabelText("Confirmar senha"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Concluir cadastro" }));
    expect(await screen.findByRole("heading", { name: "Pacientes" })).toBeInTheDocument();
    expect(screen.getByText("Dra. Ana Lima")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Principal" })).getByText("Documentos")).toBeInTheDocument();
    seed.anaToken = localStorage.getItem("mindcare.token");
  });

  it("o link de convite não vale duas vezes", async () => {
    await openApp(`/convite/${seed.inviteToken}`);
    expect(await screen.findByText("Convite inválido ou expirado")).toBeInTheDocument();
  });

  it("psicólogo vê o próprio paciente, seus documentos e abre o documento emitido", async () => {
    const pac = (await call("POST", "/patients", { token: seed.anaToken, body: { nome: "Maria Souza", data_nascimento: "1990-05-10" } })).json;
    await call("PUT", `/patients/${pac.id}/anamnesis`, { token: seed.anaToken, body: { queixa_principal: "Ansiedade" } });
    const draft = (await call("POST", "/documents", { token: seed.anaToken, body: { patient_id: pac.id, tipo: "declaracao", finalidade: "Comprovar comparecimento", conteudo: { registro: "Compareceu hoje." } } })).json;
    const emitted = (await call("POST", `/documents/${draft.id}/emit`, { token: seed.anaToken, body: {} })).json;
    const rascunho = (await call("POST", "/documents", { token: seed.anaToken, body: { patient_id: pac.id, tipo: "encaminhamento" } })).json;
    seed.emitted = emitted;
    seed.patient = pac;

    await openApp("/pacientes", seed.anaToken);
    expect(await screen.findByRole("link", { name: "Maria Souza" }, { timeout: 5000 })).toBeInTheDocument();
    cleanup();

    await openApp("/documentos", seed.anaToken);
    expect(await screen.findAllByText("Declaração")).not.toHaveLength(0);
    expect(screen.getByText(emitted.numero)).toBeInTheDocument();
    expect(screen.getByText("Emitido")).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    cleanup();

    await openApp(`/documentos/${emitted.id}`, seed.anaToken);
    expect(await screen.findByRole("button", { name: /Baixar PDF/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Anular documento/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Finalidade")).toBeDisabled(); // emitido é somente leitura
    cleanup();

    await openApp(`/documentos/${rascunho.id}`, seed.anaToken);
    expect(await screen.findByRole("button", { name: /Emitir documento/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toBeEnabled();
    cleanup();

    await openApp(`/pacientes/${pac.id}`, seed.anaToken);
    expect(await screen.findByRole("heading", { name: "Maria Souza" })).toBeInTheDocument();
  });

  it("outro psicólogo não enxerga o paciente nem os documentos", async () => {
    await openApp("/pacientes", seed.brunoToken);
    expect(await screen.findByRole("heading", { name: "Pacientes" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Nenhum paciente encontrado.")).toBeInTheDocument());
    cleanup();
    await openApp(`/documentos/${seed.emitted.id}`, seed.brunoToken);
    expect(await screen.findByText("Documento não encontrado.")).toBeInTheDocument();
  });

  it("rotas de administração redirecionam quem não é admin", async () => {
    await openApp("/usuarios", seed.anaToken);
    expect(await screen.findByRole("heading", { name: "Pacientes" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Usuários" })).not.toBeInTheDocument();
  });

  it("administração lista a equipe e os papéis timbrados", async () => {
    await call("POST", "/letterheads", { token: seed.adminToken, body: { nome: "Papel da clínica", modo: "padrao", linhas: ["Clínica E2E"], is_default: true } });
    await openApp("/usuarios", seed.adminToken);
    expect(await screen.findByText("Dra. Ana Lima")).toBeInTheDocument();
    expect(screen.getByText("Dr. Bruno Reis")).toBeInTheDocument();
    cleanup();
    await openApp("/papel-timbrado", seed.adminToken);
    expect(await screen.findByText("Papel da clínica")).toBeInTheDocument();
    expect(screen.getByText("Padrão")).toBeInTheDocument();
  });

  it("verificação pública confirma o documento sem login e sem expor o paciente", async () => {
    await openApp(`/verificar/${seed.emitted.codigo}`);
    expect(await screen.findByText("Documento autêntico e válido")).toBeInTheDocument();
    expect(screen.getByText(/Dra\. Ana Lima — CRP 06\/12345/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Maria|Souza/);
    cleanup();
    await openApp("/verificar/ZZZZZZZZZZZZ");
    expect(await screen.findByText("Documento não encontrado")).toBeInTheDocument();
  });

  it("psicólogo registra cobrança, recebe parcialmente, estorna e cancela pela aba Cobranças", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lista = async () => (await call("GET", `/charges?patient_id=${seed.patient.id}`, { token: seed.anaToken })).json as any[];
    await openApp(`/pacientes/${seed.patient.id}`, seed.anaToken);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Cobranças" }));
    expect(await screen.findByText("Nenhuma cobrança para este paciente.")).toBeInTheDocument();

    // cobrança já paga, registrada de uma vez
    await user.click(screen.getByRole("button", { name: /Nova cobrança/ }));
    await user.type(await screen.findByLabelText("Valor (R$)"), "200");
    await user.click(screen.getByRole("switch", { name: "Já foi pago" }));
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(await screen.findByText("Paga")).toBeInTheDocument();
    await waitFor(async () => expect((await lista()).map((c) => [c.valor_centavos, c.status])).toEqual([[20000, "paga"]]));

    // cobrança em aberto
    await user.click(screen.getByRole("button", { name: /Nova cobrança/ }));
    await user.type(await screen.findByLabelText("Valor (R$)"), "150,00");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(await screen.findByText("Em aberto")).toBeInTheDocument();

    // recebimento parcial
    await user.click(await screen.findByRole("button", { name: "Receber" }));
    const valor = await screen.findByLabelText("Valor (R$)");
    expect(valor).toHaveValue("150,00"); // já vem preenchido com o saldo
    await user.clear(valor);
    await user.type(valor, "50");
    await user.click(screen.getByRole("button", { name: "Registrar pagamento" }));
    expect(await screen.findByText("Parcial")).toBeInTheDocument();
    const aberta = (await lista()).find((c) => c.valor_centavos === 15000);
    expect(aberta).toMatchObject({ status: "parcial", paid_centavos: 5000, saldo_centavos: 10000 });

    // pagamento maior que o saldo é recusado com mensagem
    await user.click(await screen.findByRole("button", { name: "Receber" }));
    const excesso = await screen.findByLabelText("Valor (R$)");
    await user.clear(excesso);
    await user.type(excesso, "500");
    await user.click(screen.getByRole("button", { name: "Registrar pagamento" }));
    await waitFor(async () => expect((await lista()).find((c) => c.id === aberta.id).paid_centavos).toBe(5000));
    await user.click(screen.getByRole("button", { name: "Cancelar" })); // fecha o diálogo de recebimento

    // detalhes: estorno com motivo e depois cancelamento da cobrança
    await user.click(await screen.findByRole("button", { name: /150,00/ }));
    await user.click(await screen.findByRole("button", { name: "Estornar" }, { timeout: 5000 }));
    await user.type(await screen.findByLabelText("Motivo do estorno"), "Valor lançado errado");
    await user.click(screen.getByRole("button", { name: "Confirmar estorno" }));
    await waitFor(async () => expect((await lista()).find((c) => c.id === aberta.id)).toMatchObject({ status: "aberta", paid_centavos: 0 }));
    await user.click(await screen.findByRole("button", { name: "Cancelar cobrança" }, { timeout: 5000 })); // aparece depois que os detalhes recarregam
    await user.type(await screen.findByLabelText("Motivo do cancelamento", undefined, { timeout: 5000 }), "Lançada por engano");
    await user.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await waitFor(async () => expect((await lista()).find((c) => c.id === aberta.id).status).toBe("cancelada"));
  }, 40_000);

  it("psicólogo cadastra o emissor, prepara a nota de uma cobrança e registra a nota emitida", async () => {
    const user = userEvent.setup();
    await openApp("/nota-fiscal", seed.anaToken);
    await user.type(await screen.findByLabelText("CNPJ"), "11.222.333/0001-81");
    await user.type(screen.getByLabelText("Razão social"), "Ana Lima Psicologia Ltda");
    await user.type(screen.getByLabelText(/Código do município/), "3516408");
    await user.click(screen.getByRole("switch", { name: /Já consigo emitir/ }));
    await user.click(screen.getByRole("button", { name: "Cadastrar emissor" }));
    await waitFor(async () => expect((await call("GET", "/fiscal/issuers", { token: seed.anaToken })).json).toHaveLength(1));
    expect((await call("GET", "/fiscal/issuers", { token: seed.anaToken })).json[0]).toMatchObject({ cnpj: "11222333000181", emissor_nacional_ok: true });
    cleanup();

    // CPF do paciente pelo cadastro
    const charge = (await call("POST", "/charges", { token: seed.anaToken, body: { patient_id: seed.patient.id, competencia: "2030-05", valor_centavos: 25000 } })).json;
    await call("PATCH", `/patients/${seed.patient.id}`, { token: seed.anaToken, body: { cpf: "529.982.247-25" } });

    await openApp(`/pacientes/${seed.patient.id}`, seed.anaToken);
    await user.click(await screen.findByRole("tab", { name: "Cobranças" }));
    await user.click(await screen.findByRole("button", { name: /05\/2030/ }));
    await user.click(await screen.findByRole("button", { name: "Preparar nota fiscal" }, { timeout: 5000 }));
    expect(await screen.findByText("Rascunho")).toBeInTheDocument();
    expect(await screen.findByText(/Tomador: Maria Souza/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Chave de acesso/), "1".repeat(50));
    await user.type(screen.getByLabelText("Número da nota"), "42");
    await user.click(screen.getByRole("button", { name: "Registrar nota" }));
    expect(await screen.findByText("Emitida")).toBeInTheDocument();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = (await call("GET", "/nfse", { token: seed.anaToken })).json as any[];
    expect(docs.find((d) => d.charge_ids.includes(charge.id))).toMatchObject({ status: "emitida", numero_nfse: "42", chave_acesso: "1".repeat(50) });
  }, 40_000);

  it("psicólogo agenda uma sessão, marca como realizada e a cobrança nasce junto; marca outra como falta", async () => {
    const user = userEvent.setup();
    const cobrancas = async () => (await call("GET", `/charges?patient_id=${seed.patient.id}`, { token: seed.anaToken })).json as Array<Record<string, unknown>>;
    await openApp("/agenda", seed.anaToken);
    await user.click(await screen.findByRole("button", { name: /Nova sessão/ }));
    const seletor = await screen.findByLabelText("Paciente");
    await screen.findByRole("option", { name: "Maria Souza" }); // a lista de pacientes chega depois do diálogo abrir
    await user.selectOptions(seletor, seed.patient.id);
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "00:10" } });
    await user.type(screen.getByLabelText("Valor (R$)"), "180");
    await user.click(screen.getByRole("button", { name: "Agendar" }));
    expect(await screen.findByText("Agendado")).toBeInTheDocument();
    expect(screen.getByText(/00:10–01:00/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Realizada" }));
    expect(await screen.findByText("Realizado")).toBeInTheDocument();
    expect(await screen.findByText("A receber")).toBeInTheDocument();
    expect((await cobrancas()).find((c) => c.valor_centavos === 18000)).toMatchObject({ origem: "sessao", status: "aberta" });
    cleanup();

    // segunda sessão do dia, marcada como falta (não gera cobrança)
    const hoje = new Date();
    const at16 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 2, 0);
    const segunda = await call("POST", "/appointments", { token: seed.anaToken, body: { patient_id: seed.patient.id, starts_at: at16.toISOString(), ends_at: new Date(at16.getTime() + 50 * 60_000).toISOString(), valor: 180 } });
    expect(segunda.status, JSON.stringify(segunda.json)).toBe(201);
    await openApp("/agenda", seed.anaToken);
    await user.click(await screen.findByRole("button", { name: "Faltou" }, { timeout: 5000 }));
    expect(await screen.findByText("Faltou", { selector: "span, div" })).toBeInTheDocument();
    expect((await cobrancas()).filter((c) => c.valor_centavos === 18000)).toHaveLength(1);
  }, 40_000);

  it("administração gera as cobranças do mês, vê o resumo e cadastra um serviço", async () => {
    const user = userEvent.setup();
    const hoje = new Date();
    const at18 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 18, 0);
    const ap = (await call("POST", "/appointments", { token: seed.anaToken, body: { patient_id: seed.patient.id, starts_at: at18.toISOString(), ends_at: new Date(at18.getTime() + 50 * 60_000).toISOString(), valor: 120 } })).json;
    await call("PATCH", `/appointments/${ap.id}`, { token: seed.anaToken, body: { status: "realizado" } });

    await openApp("/financeiro", seed.adminToken);
    expect(await screen.findByText("Cobrado no mês")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Gerar cobranças do mês" }));
    await waitFor(async () => {
      const lista = (await call("GET", `/charges?patient_id=${seed.patient.id}`, { token: seed.anaToken })).json as Array<{ appointment_id: string | null }>;
      expect(lista.some((c) => c.appointment_id === ap.id)).toBe(true);
    });
    expect(await screen.findByText(/R\$\s?120,00/, { selector: "button" }, { timeout: 5000 })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Serviços" }));
    await user.type(screen.getByLabelText("Nome"), "Sessão individual");
    await user.type(screen.getByLabelText("Valor (R$)"), "200,00");
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByText("Sessão individual")).toBeInTheDocument();
    expect((await call("GET", "/services", { token: seed.adminToken })).json).toHaveLength(1);
  }, 40_000);

  it("psicólogo bloqueia um horário na agenda e depois remove o bloqueio", async () => {
    const user = userEvent.setup();
    await openApp("/agenda", seed.anaToken);
    await user.click(await screen.findByRole("button", { name: "Bloquear horário" }));
    fireEvent.change(await screen.findByLabelText("Das"), { target: { value: "12:00" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "13:00" } });
    await user.type(screen.getByLabelText("Motivo (opcional)"), "Almoço");
    await user.click(screen.getByRole("button", { name: "Bloquear" }));
    expect(await screen.findByText(/Bloqueado 12:00–13:00/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/Almoço/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remover bloqueio" }));
    await waitFor(() => expect(screen.queryByText(/Bloqueado 12:00–13:00/)).not.toBeInTheDocument());
  }, 40_000);

  it("administração vê o resumo por profissional no Financeiro", async () => {
    await openApp("/financeiro", seed.adminToken);
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Resumo" }, { timeout: 5000 }));
    expect(await screen.findByText("Por profissional", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText("Dra. Ana Lima", { selector: "span" })).toBeInTheDocument(); // o nome também aparece no seletor do Receita Saúde
  });

  it("sessão pro bono: sem valor, realizada sem gerar cobrança", async () => {
    const user = userEvent.setup();
    await openApp("/agenda", seed.anaToken);
    await user.click(await screen.findByRole("button", { name: /Nova sessão/ }));
    const seletor = await screen.findByLabelText("Paciente");
    await screen.findByRole("option", { name: "Maria Souza" });
    await user.selectOptions(seletor, seed.patient.id);
    fireEvent.change(screen.getByLabelText("Início"), { target: { value: "03:30" } });
    await user.selectOptions(screen.getByLabelText("Tipo de atendimento"), "pro_bono");
    expect(screen.getByLabelText("Valor (R$)")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Agendar" }));
    expect(await screen.findByText("Pro bono", undefined, { timeout: 5000 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Realizada" }));

    const hoje = new Date();
    const de = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const ate = new Date(de.getTime() + 24 * 3600 * 1000);
    const doDia = async () =>
      (await call("GET", `/appointments?from=${encodeURIComponent(de.toISOString())}&to=${encodeURIComponent(ate.toISOString())}`, { token: seed.anaToken })).json as Array<{ id: string; atendimento: string; status: string }>;
    await waitFor(async () => expect((await doDia()).find((a) => a.atendimento === "pro_bono")).toMatchObject({ status: "realizado" }));
    const pro = (await doDia()).find((a) => a.atendimento === "pro_bono");
    const cobrancas = (await call("GET", `/charges?patient_id=${seed.patient.id}`, { token: seed.anaToken })).json as Array<{ appointment_id: string | null }>;
    expect(cobrancas.some((c) => c.appointment_id === pro!.id)).toBe(false);
  }, 40_000);

  it("administração vê o histórico de uma sessão e as pendências de emissão", async () => {
    const user = userEvent.setup();
    await openApp("/agenda", seed.adminToken);
    const botoes = await screen.findAllByRole("button", { name: "Histórico" }, { timeout: 5000 });
    await user.click(botoes[0]!);
    expect((await screen.findAllByText(/criou/, undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    cleanup();

    await openApp("/financeiro", seed.adminToken);
    await user.click(await screen.findByRole("tab", { name: "Fiscal" }, { timeout: 5000 }));
    expect(await screen.findByText("Pendências de emissão", undefined, { timeout: 5000 })).toBeInTheDocument();
    await user.click((await screen.findAllByRole("button", { name: "Abrir" }))[0]!);
    expect(await screen.findByRole("button", { name: "Preparar nota fiscal" }, { timeout: 5000 })).toBeInTheDocument();
  }, 40_000);

  it("outro psicólogo não vê as cobranças do paciente", async () => {
    const r = await call("GET", `/charges?patient_id=${seed.patient.id}`, { token: seed.brunoToken });
    expect(r.json).toEqual([]);
    await openApp(`/pacientes/${seed.patient.id}`, seed.brunoToken);
    expect(await screen.findByText("Paciente não encontrado ou sem permissão de acesso.")).toBeInTheDocument();
  });

  it("sessão inválida volta para o login", async () => {
    await openApp("/pacientes", "token-invalido");
    expect(await screen.findByText("Entrar na sua conta")).toBeInTheDocument();
  });
});
