import { afterAll, describe, expect, it } from "vitest";
import { app, appPool, at, call, env, forgedToken, login, mkClinic, mkUser, ownerPool, PASSWORD, uniq } from "./helpers";

afterAll(async () => {
  await appPool.end();
  await ownerPool.end();
});

describe("clínica e login", () => {
  it("só o operador com o token cria clínica", async () => {
    const body = { clinic_nome: "X Clínica", admin_nome: "Fulano", email: `${uniq("a")}@x.test`, password: PASSWORD };
    expect((await call("POST", "/platform/clinics", { body })).status).toBe(403);
    expect((await call("POST", "/platform/clinics", { headers: { "x-setup-token": "errado" }, body })).status).toBe(403);
    expect((await call("POST", "/platform/clinics", { headers: { "x-setup-token": env.SETUP_TOKEN! }, body })).status).toBe(201);
    const fraca = { ...body, email: `${uniq("b")}@x.test`, password: "fraca" };
    expect((await call("POST", "/platform/clinics", { headers: { "x-setup-token": env.SETUP_TOKEN! }, body: fraca })).status).toBe(400);
  });

  it("login correto, senha errada e e-mail inexistente", async () => {
    const { adminEmail } = await mkClinic();
    const ok = await login(adminEmail);
    expect(ok.status).toBe(200);
    expect(ok.json.user.role).toBe("admin");
    const errada = await login(adminEmail, "Errada@123");
    const inexistente = await login("ninguem@x.test");
    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(errada.json.error).toBe(inexistente.json.error); // sem enumeração de contas
  });

  it("bloqueia a conta após 5 senhas erradas, mesmo com a senha certa depois", async () => {
    const { adminEmail } = await mkClinic();
    for (let i = 0; i < 5; i++) await login(adminEmail, "Errada@123");
    expect((await login(adminEmail)).status).toBe(401);
  });

  it("/me exige autenticação e rejeita tokens forjados ou vencidos", async () => {
    const { adminToken, adminId } = await mkClinic();
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("GET", "/me", { token: adminToken })).json.clinic_nome).toBe("Clínica Teste");
    expect((await call("GET", "/me", { token: await forgedToken(adminId, "outro-segredo-qualquer-com-tamanho-ok-123") })).status).toBe(401);
    expect((await call("GET", "/me", { token: await forgedToken(adminId, env.JWT_SECRET, 1) })).status).toBe(401);
  });

  it("troca de senha exige a senha atual", async () => {
    const { adminEmail, adminToken } = await mkClinic();
    const nova = "Nova@Senha9";
    expect((await call("POST", "/auth/change-password", { token: adminToken, body: { current_password: "Errada@123", new_password: nova } })).status).toBe(400);
    expect((await call("POST", "/auth/change-password", { token: adminToken, body: { current_password: PASSWORD, new_password: nova } })).status).toBe(200);
    expect((await login(adminEmail, nova)).status).toBe(200);
    expect((await login(adminEmail)).status).toBe(401);
  });

  it("CORS só libera a origem configurada", async () => {
    const ok = await app.request("/health", { headers: { Origin: env.ALLOWED_ORIGIN } }, env);
    const ruim = await app.request("/health", { headers: { Origin: "https://evil.example" } }, env);
    expect(ok.headers.get("access-control-allow-origin")).toBe(env.ALLOWED_ORIGIN);
    expect(ruim.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("limite de tentativas por IP e saúde", () => {
  const ip = (n: string) => ({ "CF-Connecting-IP": n });

  it("login: depois de 10 tentativas no minuto, responde 429 (por IP)", async () => {
    const { adminEmail } = await mkClinic();
    const tentar = (h: Record<string, string>) => call("POST", "/auth/login", { headers: h, body: { email: adminEmail, password: "Errada@123" } });
    for (let i = 0; i < 10; i++) expect((await tentar(ip("203.0.113.10"))).status).toBe(401);
    const bloqueado = await tentar(ip("203.0.113.10"));
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.json.error).toMatch(/Muitas tentativas/);
    expect((await tentar(ip("203.0.113.11"))).status).toBe(401); // outro IP segue normal
  });

  it("aceite de convite e verificação pública também são limitados", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await call("POST", "/invites/accept", { headers: ip("203.0.113.20"), body: { token: "x".repeat(30), email: "a@b.test", password: PASSWORD } })).status).toBe(400);
    }
    expect((await call("POST", "/invites/accept", { headers: ip("203.0.113.20"), body: { token: "x".repeat(30), email: "a@b.test", password: PASSWORD } })).status).toBe(429);
    for (let i = 0; i < 30; i++) expect((await call("GET", "/verify/ABCDEFGHJKMN", { headers: ip("203.0.113.21") })).status).toBe(404);
    expect((await call("GET", "/verify/ABCDEFGHJKMN", { headers: ip("203.0.113.21") })).status).toBe(429);
  });

  it("a tabela de contadores não é acessível diretamente pela API", async () => {
    await expect(appPool.query("SELECT * FROM rate_limit_hits")).rejects.toMatchObject({ code: "42501" });
  });

  it("/health/db confirma a conexão com o banco", async () => {
    const r = await call("GET", "/health/db");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, db: true });
  });
});

describe("pré-cadastro e convites", () => {
  it("admin pré-cadastra, a pessoa aceita o link e o link não vale duas vezes", async () => {
    const { adminToken } = await mkClinic();
    const created = await call("POST", "/users", { token: adminToken, body: { nome: "Dra. Ana", role: "psicologo", crp: "06/12345" } });
    expect(created.status).toBe(201);
    expect(created.json.user.status).toBe("convidado");
    expect(created.json.user.atende).toBe(true);
    const token = created.json.invite.link.split("/convite/")[1];

    const peek = await call("GET", `/invites/${token}`);
    expect(peek.status).toBe(200);
    expect(peek.json).toMatchObject({ kind: "convite", nome: "Dra. Ana", role: "psicologo", clinic_nome: "Clínica Teste" });

    const email = `${uniq("ana")}@x.test`;
    expect((await call("POST", "/invites/accept", { body: { token, email, password: "fraca" } })).status).toBe(400);
    const accepted = await call("POST", "/invites/accept", { body: { token, email, password: PASSWORD } });
    expect(accepted.status).toBe(200);
    expect((await login(email)).json.user.role).toBe("psicologo");

    expect((await call("GET", `/invites/${token}`)).status).toBe(404);
    expect((await call("POST", "/invites/accept", { body: { token, email: `${uniq("z")}@x.test`, password: PASSWORD } })).status).toBe(400);
  });

  it("o banco guarda só o hash do token", async () => {
    const { adminToken } = await mkClinic();
    const created = await call("POST", "/users", { token: adminToken, body: { nome: "Rita Recepção", role: "recepcao" } });
    const token = created.json.invite.link.split("/convite/")[1];
    const rows = (await ownerPool.query("SELECT token_hash FROM invites WHERE user_id = $1", [created.json.user.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toContain(token);
    expect(rows[0].token_hash).toHaveLength(64);
  });

  it("só admin gerencia usuários", async () => {
    const { adminToken } = await mkClinic();
    const psi = await mkUser(adminToken, { nome: "Psi Teste", role: "psicologo", crp: "06/1" });
    const rec = await mkUser(adminToken, { nome: "Rec Teste", role: "recepcao" });
    for (const t of [psi.token, rec.token]) {
      expect((await call("GET", "/users", { token: t })).status).toBe(403);
      expect((await call("POST", "/users", { token: t, body: { nome: "Outro Alguém", role: "admin" } })).status).toBe(403);
    }
  });

  it("psicólogo precisa de CRP", async () => {
    const { adminToken } = await mkClinic();
    const r = await call("POST", "/users", { token: adminToken, body: { nome: "Sem CRP", role: "psicologo" } });
    expect(r.status).toBe(422);
  });

  it("convite expirado ou regenerado deixa de valer", async () => {
    const { adminToken } = await mkClinic();
    const created = await call("POST", "/users", { token: adminToken, body: { nome: "Beto Recep", role: "recepcao" } });
    const antigo = created.json.invite.link.split("/convite/")[1];
    const novo = (await call("POST", `/users/${created.json.user.id}/invite`, { token: adminToken, body: {} })).json.link.split("/convite/")[1];
    expect((await call("GET", `/invites/${antigo}`)).status).toBe(404);
    expect((await call("GET", `/invites/${novo}`)).status).toBe(200);
    await ownerPool.query("UPDATE invites SET expires_at = now() - interval '1 minute' WHERE revoked_at IS NULL AND user_id = $1", [created.json.user.id]);
    expect((await call("GET", `/invites/${novo}`)).status).toBe(404);
  });

  it("e-mail duplicado é recusado", async () => {
    const { adminToken } = await mkClinic();
    const a = await mkUser(adminToken, { nome: "Pessoa Um", role: "recepcao" });
    const created = await call("POST", "/users", { token: adminToken, body: { nome: "Pessoa Dois", role: "recepcao" } });
    const token = created.json.invite.link.split("/convite/")[1];
    expect((await call("POST", "/invites/accept", { body: { token, email: a.email, password: PASSWORD } })).status).toBe(409);
  });

  it("redefinição de senha pelo admin gera link que troca só a senha", async () => {
    const { adminToken } = await mkClinic();
    const u = await mkUser(adminToken, { nome: "Dani Recepção", role: "recepcao" });
    const link = (await call("POST", `/users/${u.id}/invite`, { token: adminToken, body: {} })).json.link;
    const token = link.split("/convite/")[1];
    expect((await call("GET", `/invites/${token}`)).json.kind).toBe("redefinicao");
    const nova = "Outra@Senha77";
    expect((await call("POST", "/invites/accept", { body: { token, password: nova } })).status).toBe(200);
    expect((await login(u.email, nova)).status).toBe(200);
    expect((await login(u.email)).status).toBe(401);
  });

  it("desativar um usuário derruba a sessão na hora; o último admin não pode sair", async () => {
    const { adminToken, adminId } = await mkClinic();
    const u = await mkUser(adminToken, { nome: "Gil Recepção", role: "recepcao" });
    expect((await call("GET", "/me", { token: u.token })).status).toBe(200);
    expect((await call("PATCH", `/users/${u.id}`, { token: adminToken, body: { status: "inativo" } })).status).toBe(200);
    expect((await call("GET", "/me", { token: u.token })).status).toBe(401);
    expect((await call("PATCH", `/users/${adminId}`, { token: adminToken, body: { status: "inativo" } })).status).toBe(422);
    expect((await call("PATCH", `/users/${adminId}`, { token: adminToken, body: { role: "recepcao" } })).status).toBe(422);
  });

  it("qualquer usuário logado lista os profissionais que atendem", async () => {
    const { adminToken } = await mkClinic();
    const psi = await mkUser(adminToken, { nome: "Psi Lista", role: "psicologo", crp: "06/55" });
    const rec = await mkUser(adminToken, { nome: "Rec Lista", role: "recepcao" });
    const r = await call("GET", "/professionals", { token: rec.token });
    expect(r.json).toEqual([{ id: psi.id, nome: "Psi Lista", crp: "06/55" }]);
    expect((await call("GET", "/professionals")).status).toBe(401);
  });

  it("a API nunca devolve hash de senha", async () => {
    const { adminToken } = await mkClinic();
    const list = await call("GET", "/users", { token: adminToken });
    expect(JSON.stringify(list.json)).not.toMatch(/password|scrypt\$/i);
  });
});

describe("pacientes e dados clínicos", () => {
  async function cenario() {
    const c = await mkClinic();
    const psiA = await mkUser(c.adminToken, { nome: "Psi A", role: "psicologo", crp: "06/1" });
    const psiB = await mkUser(c.adminToken, { nome: "Psi B", role: "psicologo", crp: "06/2" });
    const rec = await mkUser(c.adminToken, { nome: "Rec", role: "recepcao" });
    const adminAtende = await mkUser(c.adminToken, { nome: "Admin Atende", role: "admin", crp: "06/3", atende: true });
    return { ...c, psiA, psiB, rec, adminAtende };
  }

  it("psicólogo cadastra paciente sob a própria responsabilidade e registra a anamnese", async () => {
    const s = await cenario();
    const p = await call("POST", "/patients", { token: s.psiA.token, body: { nome: "Paciente Um", professional_id: s.psiB.id } });
    expect(p.status).toBe(201);
    expect(p.json.professional_id).toBe(s.psiA.id); // ignora tentativa de atribuir a outro
    const put = await call("PUT", `/patients/${p.json.id}/anamnesis`, { token: s.psiA.token, body: { queixa_principal: "Ansiedade", medicamentos: "—" } });
    expect(put.status).toBe(200);
    const get = await call("GET", `/patients/${p.json.id}`, { token: s.psiA.token });
    expect(get.json.anamnesis.queixa_principal).toBe("Ansiedade");
  });

  it("recepção e admin que não atende não leem nem gravam dados clínicos", async () => {
    const s = await cenario();
    const p = (await call("POST", "/patients", { token: s.psiA.token, body: { nome: "Paciente Dois" } })).json;
    await call("PUT", `/patients/${p.id}/anamnesis`, { token: s.psiA.token, body: { queixa_principal: "Sigiloso" } });

    for (const t of [s.rec.token, s.adminToken]) {
      const get = await call("GET", `/patients/${p.id}`, { token: t });
      expect(get.status).toBe(200);
      expect(get.json.nome).toBe("Paciente Dois");
      expect(get.json.anamnesis).toBeNull();
      expect(JSON.stringify(get.json)).not.toContain("Sigiloso");
    }
    expect((await call("PUT", `/patients/${p.id}/anamnesis`, { token: s.rec.token, body: { queixa_principal: "x" } })).status).toBe(403);
    expect((await call("PUT", `/patients/${p.id}/anamnesis`, { token: s.adminToken, body: { queixa_principal: "x" } })).status).toBe(403);
    // admin que atende (gerente-psicólogo) pode
    expect((await call("GET", `/patients/${p.id}`, { token: s.adminAtende.token })).json.anamnesis.queixa_principal).toBe("Sigiloso");
  });

  it("psicólogo não enxerga paciente de outro psicólogo, mas a recepção atribui e enxerga todos", async () => {
    const s = await cenario();
    const p = (await call("POST", "/patients", { token: s.rec.token, body: { nome: "Paciente Três", professional_id: s.psiA.id } })).json;
    expect((await call("GET", `/patients/${p.id}`, { token: s.psiB.token })).status).toBe(404);
    expect((await call("GET", "/patients", { token: s.psiB.token })).json).toHaveLength(0);
    expect((await call("GET", "/patients", { token: s.rec.token })).json).toHaveLength(1);
    expect((await call("PATCH", `/patients/${p.id}`, { token: s.psiB.token, body: { nome: "Invasor Teste" } })).status).toBe(404);
    expect((await call("PATCH", `/patients/${p.id}`, { token: s.psiA.token, body: { professional_id: s.psiB.id } })).status).toBe(403);
    expect((await call("PATCH", `/patients/${p.id}`, { token: s.rec.token, body: { professional_id: s.psiB.id } })).status).toBe(200);
  });

  it("responsável precisa ser alguém que atende", async () => {
    const s = await cenario();
    const r = await call("POST", "/patients", { token: s.rec.token, body: { nome: "Paciente Quatro", professional_id: s.rec.id } });
    expect(r.status).toBe(422);
  });

  it("acessos aos dados do paciente ficam no log de auditoria", async () => {
    const s = await cenario();
    const p = (await call("POST", "/patients", { token: s.psiA.token, body: { nome: "Paciente Cinco" } })).json;
    await call("PUT", `/patients/${p.id}/anamnesis`, { token: s.psiA.token, body: { queixa_principal: "x" } });
    await call("GET", `/patients/${p.id}`, { token: s.psiA.token });
    const r = await ownerPool.query("SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY at", [p.id]);
    expect(r.rows.map((x) => x.action)).toEqual(["patient.create", "patient.update_clinical", "patient.view_clinical"]);
  });
});

describe("isolamento entre clínicas (RLS)", () => {
  it("outra clínica não vê nem altera nada", async () => {
    const a = await mkClinic();
    const b = await mkClinic();
    const psi = await mkUser(a.adminToken, { nome: "Psi Iso", role: "psicologo", crp: "06/9" });
    const p = (await call("POST", "/patients", { token: psi.token, body: { nome: "Paciente Iso" } })).json;
    const ap = (await call("POST", "/appointments", { token: psi.token, body: { patient_id: p.id, starts_at: at(0, "09:00"), ends_at: at(0, "10:00") } })).json;

    expect((await call("GET", "/patients", { token: b.adminToken })).json).toHaveLength(0);
    expect((await call("GET", `/patients/${p.id}`, { token: b.adminToken })).status).toBe(404);
    expect((await call("PATCH", `/appointments/${ap.id}`, { token: b.adminToken, body: { status: "cancelado" } })).status).toBe(404);
    expect((await call("GET", "/users", { token: b.adminToken })).json).toHaveLength(1);
    expect((await call("PATCH", `/users/${psi.id}`, { token: b.adminToken, body: { status: "inativo" } })).status).toBe(404);
    expect((await call("POST", "/appointments", { token: b.adminToken, body: { patient_id: p.id, professional_id: psi.id, starts_at: at(1, "09:00"), ends_at: at(1, "10:00") } })).status).toBe(404);
  });

  it("direto no banco, o papel da API sem contexto não lê nada e não alcança colunas ou ações proibidas", async () => {
    await mkClinic();
    expect((await appPool.query("SELECT count(*)::int AS n FROM patients")).rows[0].n).toBe(0);
    expect((await appPool.query("SELECT count(*)::int AS n FROM users")).rows[0].n).toBe(0);
    await expect(appPool.query("SELECT password_hash FROM users")).rejects.toMatchObject({ code: "42501" });
    await expect(appPool.query("DELETE FROM patients")).rejects.toMatchObject({ code: "42501" });
    await expect(appPool.query("UPDATE audit_log SET action = 'x'")).rejects.toMatchObject({ code: "42501" });
  });
});

describe("agenda", () => {
  async function cenario() {
    const c = await mkClinic();
    const psiA = await mkUser(c.adminToken, { nome: "Psi A", role: "psicologo", crp: "06/1" });
    const psiB = await mkUser(c.adminToken, { nome: "Psi B", role: "psicologo", crp: "06/2" });
    const rec = await mkUser(c.adminToken, { nome: "Rec", role: "recepcao" });
    const pac = (await call("POST", "/patients", { token: rec.token, body: { nome: "Paciente Agenda", professional_id: psiA.id } })).json;
    const pac2 = (await call("POST", "/patients", { token: rec.token, body: { nome: "Paciente Agenda 2", professional_id: psiA.id } })).json;
    return { ...c, psiA, psiB, rec, pac, pac2 };
  }
  const marcar = (token: string, body: Record<string, unknown>) => call("POST", "/appointments", { token, body });

  it("recepção agenda para o psicólogo; conflitos são barrados e horários colados são aceitos", async () => {
    const s = await cenario();
    const base = { patient_id: s.pac.id, professional_id: s.psiA.id };
    expect((await marcar(s.rec.token, { ...base, starts_at: at(0, "10:00"), ends_at: at(0, "11:00") })).status).toBe(201);
    const conflito = await marcar(s.rec.token, { ...base, patient_id: s.pac2.id, starts_at: at(0, "10:30"), ends_at: at(0, "11:30") });
    expect(conflito.status).toBe(409);
    expect(conflito.json.error).toMatch(/Conflito de agenda em 04\/03\/2030 10:30/);
    expect((await marcar(s.rec.token, { ...base, starts_at: at(0, "11:00"), ends_at: at(0, "12:00") })).status).toBe(201);
  });

  it("sessões de grupo se sobrepõem entre si, mas não com individual", async () => {
    const s = await cenario();
    const base = { professional_id: s.psiA.id, starts_at: at(1, "14:00"), ends_at: at(1, "15:00") };
    expect((await marcar(s.rec.token, { ...base, patient_id: s.pac.id, tipo: "grupo" })).status).toBe(201);
    expect((await marcar(s.rec.token, { ...base, patient_id: s.pac2.id, tipo: "grupo" })).status).toBe(201);
    expect((await marcar(s.rec.token, { ...base, patient_id: s.pac2.id, tipo: "individual" })).status).toBe(409);
  });

  it("recorrência semanal cria a série inteira no mesmo horário local", async () => {
    const s = await cenario();
    const r = await marcar(s.psiA.token, { patient_id: s.pac.id, starts_at: at(2, "09:00"), ends_at: at(2, "10:00"), recorrencia: { frequencia: "semanal", ocorrencias: 4 } });
    expect(r.status).toBe(201);
    expect(r.json).toHaveLength(4);
    expect(new Set(r.json.map((x: any) => x.series_id)).size).toBe(1);
    const horas = await ownerPool.query(
      "SELECT DISTINCT to_char(starts_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS h FROM appointments WHERE series_id = $1",
      [r.json[0].series_id],
    );
    expect(horas.rows).toEqual([{ h: "09:00" }]);
    const dias = r.json.map((x: any) => new Date(x.starts_at).getTime());
    expect(dias[1] - dias[0]).toBe(7 * 24 * 3600 * 1000);
  });

  it("se uma data da série conflita, nada da série é gravado", async () => {
    const s = await cenario();
    await marcar(s.psiA.token, { patient_id: s.pac2.id, starts_at: at(16, "09:00"), ends_at: at(16, "10:00") }); // 3ª semana
    const r = await marcar(s.psiA.token, { patient_id: s.pac.id, starts_at: at(2, "09:00"), ends_at: at(2, "10:00"), recorrencia: { frequencia: "semanal", ocorrencias: 4 } });
    expect(r.status).toBe(409);
    const n = (await ownerPool.query("SELECT count(*)::int AS n FROM appointments WHERE patient_id = $1", [s.pac.id])).rows[0].n;
    expect(n).toBe(0);
  });

  it("psicólogo só vê e mexe na própria agenda", async () => {
    const s = await cenario();
    const ap = (await marcar(s.rec.token, { patient_id: s.pac.id, professional_id: s.psiA.id, starts_at: at(3, "08:00"), ends_at: at(3, "09:00") })).json;
    const janela = `from=${encodeURIComponent(at(0, "00:00"))}&to=${encodeURIComponent(at(30, "00:00"))}`;
    expect((await call("GET", `/appointments?${janela}`, { token: s.psiB.token })).json).toHaveLength(0);
    expect((await call("GET", `/appointments?${janela}`, { token: s.psiA.token })).json).toHaveLength(1);
    expect((await call("GET", `/appointments?${janela}`, { token: s.rec.token })).json).toHaveLength(1);
    expect((await call("PATCH", `/appointments/${ap.id}`, { token: s.psiB.token, body: { status: "cancelado" } })).status).toBe(404);
    // psicólogo B não marca sessão com paciente de A
    expect((await marcar(s.psiB.token, { patient_id: s.pac.id, starts_at: at(4, "08:00"), ends_at: at(4, "09:00") })).status).toBe(404);
    // psicólogo A não passa a sessão para B
    expect((await call("PATCH", `/appointments/${ap.id}`, { token: s.psiA.token, body: { professional_id: s.psiB.id } })).status).toBe(403);
  });

  it("falta, pagamento e cancelamento; cancelar libera o horário", async () => {
    const s = await cenario();
    const ap = (await marcar(s.psiA.token, { patient_id: s.pac.id, starts_at: at(5, "10:00"), ends_at: at(5, "11:00"), valor: 150 })).json;
    expect(ap.valor).toBe(150);
    const up = await call("PATCH", `/appointments/${ap.id}`, { token: s.psiA.token, body: { status: "faltou", payment_status: "nao_pago" } });
    expect(up.json).toMatchObject({ status: "faltou", payment_status: "nao_pago" });
    expect((await marcar(s.psiA.token, { patient_id: s.pac2.id, starts_at: at(5, "10:00"), ends_at: at(5, "11:00") })).status).toBe(409);
    await call("PATCH", `/appointments/${ap.id}`, { token: s.psiA.token, body: { status: "cancelado" } });
    expect((await marcar(s.psiA.token, { patient_id: s.pac2.id, starts_at: at(5, "10:00"), ends_at: at(5, "11:00") })).status).toBe(201);
  });

  it("remarcar respeita conflitos", async () => {
    const s = await cenario();
    const a = (await marcar(s.psiA.token, { patient_id: s.pac.id, starts_at: at(6, "10:00"), ends_at: at(6, "11:00") })).json;
    await marcar(s.psiA.token, { patient_id: s.pac2.id, starts_at: at(6, "13:00"), ends_at: at(6, "14:00") });
    expect((await call("PATCH", `/appointments/${a.id}`, { token: s.psiA.token, body: { starts_at: at(6, "13:30"), ends_at: at(6, "14:30") } })).status).toBe(409);
    expect((await call("PATCH", `/appointments/${a.id}`, { token: s.psiA.token, body: { starts_at: at(6, "15:00"), ends_at: at(6, "16:00") } })).status).toBe(200);
  });

  it("profissional precisa atender; horário invertido e períodos longos são recusados", async () => {
    const s = await cenario();
    expect((await marcar(s.rec.token, { patient_id: s.pac.id, professional_id: s.rec.id, starts_at: at(7, "10:00"), ends_at: at(7, "11:00") })).status).toBe(422);
    expect((await marcar(s.psiA.token, { patient_id: s.pac.id, starts_at: at(7, "11:00"), ends_at: at(7, "10:00") })).status).toBe(422);
    const longo = `from=${encodeURIComponent(at(0, "00:00"))}&to=${encodeURIComponent(at(200, "00:00"))}`;
    expect((await call("GET", `/appointments?${longo}`, { token: s.psiA.token })).status).toBe(400);
    expect((await call("GET", "/appointments", { token: s.psiA.token })).status).toBe(400);
  });

  it("bloqueios impedem sessões e não podem cobrir sessões existentes", async () => {
    const s = await cenario();
    const bloq = await call("POST", "/blocks", { token: s.psiA.token, body: { starts_at: at(8, "12:00"), ends_at: at(8, "14:00"), motivo: "Almoço" } });
    expect(bloq.status).toBe(201);
    const r = await marcar(s.rec.token, { patient_id: s.pac.id, professional_id: s.psiA.id, starts_at: at(8, "13:00"), ends_at: at(8, "14:00") });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/bloqueado/);
    await marcar(s.psiA.token, { patient_id: s.pac.id, starts_at: at(9, "09:00"), ends_at: at(9, "10:00") });
    expect((await call("POST", "/blocks", { token: s.psiA.token, body: { starts_at: at(9, "09:30"), ends_at: at(9, "11:00") } })).status).toBe(409);
    expect((await call("DELETE", `/blocks/${bloq.json.id}`, { token: s.psiB.token })).status).toBe(404);
    expect((await call("DELETE", `/blocks/${bloq.json.id}`, { token: s.psiA.token })).status).toBe(204);
    expect((await marcar(s.rec.token, { patient_id: s.pac.id, professional_id: s.psiA.id, starts_at: at(8, "13:00"), ends_at: at(8, "14:00") })).status).toBe(201);
  });
});
