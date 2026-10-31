import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { audit, withSession, type DbClient } from "../db";
import { requireAuth, requireRole } from "../middleware";
import { sha256Hex } from "../security";
import type { AppEnv } from "../types";
import { cnpjSchema, cpfCnpjSchema, dateOnly, optText, readBody, readQuery } from "../validation";
import { clinicToday, notFound, setClause } from "./finance";

const SERVICE_DESCRIPTION = "Serviços de psicologia"; // fixa: nada clínico entra num documento fiscal
const REGIMES = ["mei", "simples", "presumido", "outro"] as const;

// ================================================================ emissores

const ISSUER_COLS = `id, tipo, professional_id, cnpj, razao_social, inscricao_municipal, municipio_ibge, regime, serie,
  codigo_tributacao_padrao, ambiente, modo, emissor_nacional_ok, habilitado_em::text AS habilitado_em, ativo, created_at, updated_at`;

const issuerFields = {
  razao_social: z.string().trim().min(2).max(160),
  inscricao_municipal: optText(30),
  municipio_ibge: z.string().regex(/^\d{7}$/, "O código do município (IBGE) tem 7 dígitos"),
  regime: z.enum(REGIMES),
  serie: z.string().trim().min(1).max(5),
  codigo_tributacao_padrao: optText(20),
  emissor_nacional_ok: z.boolean(),
};

export const fiscal = new Hono<AppEnv>();
fiscal.use("*", requireAuth);

fiscal.get("/issuers", async (c) => {
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (await db.query(`SELECT ${ISSUER_COLS} FROM fiscal_issuers ORDER BY razao_social LIMIT 200`)).rows,
  );
  return c.json(rows);
});

fiscal.post("/issuers", requireRole("admin", "psicologo"), async (c) => {
  const s = c.get("session");
  if (!s.atende) throw new HTTPException(403, { message: "Só quem atende pacientes cadastra emissor de nota" });
  const body = await readBody(
    c,
    z.object({ ...issuerFields, cnpj: cnpjSchema, regime: issuerFields.regime.default("simples"), serie: issuerFields.serie.default("1"), emissor_nacional_ok: z.boolean().default(false) }),
  );
  const row = await withSession(c.get("pool"), s, async (db) => {
    const hoje = await clinicToday(db, s.clinicId);
    const r = await db.query(
      `INSERT INTO fiscal_issuers (clinic_id, tipo, professional_id, cnpj, razao_social, inscricao_municipal, municipio_ibge, regime, serie,
                                   codigo_tributacao_padrao, emissor_nacional_ok, habilitado_em, created_by)
       VALUES ($1, 'profissional', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $2) RETURNING ${ISSUER_COLS}`,
      [s.clinicId, s.userId, body.cnpj, body.razao_social, body.inscricao_municipal ?? null, body.municipio_ibge, body.regime, body.serie,
       body.codigo_tributacao_padrao ?? null, body.emissor_nacional_ok, body.emissor_nacional_ok ? hoje : null],
    );
    await audit(db, s, "fiscal_issuer.create", "fiscal_issuer", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row, 201);
});

fiscal.patch("/issuers/:id", requireRole("admin", "psicologo"), async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ ...issuerFields, ativo: z.boolean() }).partial());
  const fields: Record<string, unknown> = { ...body };
  const { sets, values } = setClause(fields, ["razao_social", "inscricao_municipal", "municipio_ibge", "regime", "serie", "codigo_tributacao_padrao", "emissor_nacional_ok", "ativo"], 2);
  const row = await withSession(c.get("pool"), s, async (db) => {
    // habilitado_em acompanha a confirmação: preenche ao confirmar (sem refazer a data) e limpa ao desfazer
    const extra = body.emissor_nacional_ok === true ? ", habilitado_em = COALESCE(habilitado_em, current_date)" : body.emissor_nacional_ok === false ? ", habilitado_em = NULL" : "";
    const r = await db.query(`UPDATE fiscal_issuers SET ${sets}${extra} WHERE id = $1 RETURNING ${ISSUER_COLS}`, [c.req.param("id"), ...values]);
    if (!r.rows[0]) throw notFound("Emissor");
    await audit(db, s, "fiscal_issuer.update", "fiscal_issuer", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row);
});

fiscal.get("/issuers/:id/readiness", async (c) => {
  const i = await withSession(c.get("pool"), c.get("session"), async (db) => (await db.query(`SELECT ${ISSUER_COLS} FROM fiscal_issuers WHERE id = $1`, [c.req.param("id")])).rows[0]);
  if (!i) throw notFound("Emissor");
  const itens = [
    { chave: "ativo", ok: i.ativo, obrigatorio: true, detalhe: i.ativo ? "Emissor ativo" : "Emissor inativo" },
    { chave: "cnpj", ok: true, obrigatorio: true, detalhe: "CNPJ cadastrado e validado" },
    { chave: "municipio", ok: true, obrigatorio: true, detalhe: `Município (IBGE) ${i.municipio_ibge}` },
    {
      chave: "emissor_nacional",
      ok: i.emissor_nacional_ok,
      obrigatorio: true,
      detalhe: i.emissor_nacional_ok ? "Acesso ao Emissor Nacional confirmado" : "Entre no portal do Emissor Nacional com o CNPJ, tente iniciar uma emissão e marque a confirmação",
    },
    {
      chave: "codigo_tributacao",
      ok: !!i.codigo_tributacao_padrao,
      obrigatorio: false,
      detalhe: i.codigo_tributacao_padrao ? `Código ${i.codigo_tributacao_padrao}` : "Opcional: preencha depois de escolher o serviço no portal na primeira nota",
    },
  ];
  return c.json({ pronto: itens.every((x) => x.ok || !x.obrigatorio), itens });
});

// ================================================================ NFS-e

const DOC_COLS = `d.id, d.issuer_id, d.status, d.origem, d.tomador, d.servico, d.tributos, d.valor_centavos,
  d.competencia::text AS competencia, d.data_emissao::text AS data_emissao, d.chave_acesso, d.numero_nfse, d.emitida_em,
  d.content_hash, d.cancelada_em, d.cancel_motivo, d.created_at, d.updated_at, (d.xml_nfse IS NOT NULL) AS tem_xml,
  i.cnpj AS emissor_cnpj, i.razao_social AS emissor_razao_social, i.professional_id AS emissor_professional_id,
  i.emissor_nacional_ok AS emissor_nacional_ok, i.ativo AS emissor_ativo,
  ARRAY(SELECT l.charge_id FROM fiscal_document_charges l WHERE l.document_id = d.id ORDER BY l.charge_id) AS charge_ids`;
const DOC_FROM = "FROM fiscal_documents d LEFT JOIN fiscal_issuers i ON i.id = d.issuer_id";

function withPendencias(row: any) {
  const pendencias: string[] = [];
  if (row.status === "rascunho") {
    if (!row.tomador?.cpf_cnpj) pendencias.push("Informe o CPF ou CNPJ do tomador");
    if (row.emissor_ativo === false) pendencias.push("O emissor está inativo");
    if (row.emissor_nacional_ok === false) pendencias.push("Confirme o acesso do emissor ao Emissor Nacional");
  }
  return { ...row, pendencias, pronta: row.status === "rascunho" && pendencias.length === 0 };
}

async function loadDoc(db: DbClient, id: string) {
  const r = await db.query(`SELECT ${DOC_COLS} ${DOC_FROM} WHERE d.id = $1`, [id]);
  if (!r.rows[0]) throw notFound("Nota fiscal");
  return withPendencias(r.rows[0]);
}

export const nfse = new Hono<AppEnv>();
nfse.use("*", requireAuth);

nfse.get("/", async (c) => {
  const q = readQuery(
    c,
    z.object({ status: z.enum(["rascunho", "emitida", "cancelada"]).optional(), issuer_id: z.uuid().optional(), from: dateOnly.optional(), to: dateOnly.optional() }),
  );
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${DOC_COLS} ${DOC_FROM}
          WHERE ($1::text IS NULL OR d.status = $1) AND ($2::uuid IS NULL OR d.issuer_id = $2)
            AND ($3::date IS NULL OR d.competencia >= date_trunc('month', $3::date)::date) AND ($4::date IS NULL OR d.competencia <= $4::date)
          ORDER BY d.created_at DESC LIMIT 200`,
        [q.status ?? null, q.issuer_id ?? null, q.from ?? null, q.to ?? null],
      )
    ).rows.map(withPendencias),
  );
  return c.json(rows);
});

// Cria o rascunho a partir de cobranças do mesmo tomador e da mesma competência (o padrão é uma nota por sessão).
nfse.post("/", requireRole("admin", "recepcao", "psicologo"), async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ issuer_id: z.uuid(), charge_ids: z.array(z.uuid()).min(1).max(50), data_emissao: dateOnly.optional() }));
  const ids = [...new Set(body.charge_ids)];
  const doc = await withSession(c.get("pool"), s, async (db) => {
    const issuer = (await db.query("SELECT id, ativo, professional_id, tipo, municipio_ibge, codigo_tributacao_padrao FROM fiscal_issuers WHERE id = $1", [body.issuer_id])).rows[0];
    if (!issuer) throw notFound("Emissor");
    if (!issuer.ativo) throw new HTTPException(422, { message: "O emissor está inativo" });

    const charges = (
      await db.query("SELECT id, patient_id, payer_id, professional_id, status, competencia::text AS competencia, liquido_centavos FROM charges WHERE id = ANY($1::uuid[])", [ids])
    ).rows;
    if (charges.length !== ids.length) throw notFound("Cobrança");
    if (charges.some((x: any) => x.status === "cancelada")) throw new HTTPException(422, { message: "Cobrança cancelada não entra em nota fiscal" });
    if (new Set(charges.map((x: any) => `${x.patient_id}|${x.payer_id ?? ""}|${x.competencia}`)).size > 1) {
      throw new HTTPException(422, { message: "Uma nota cobre cobranças do mesmo tomador e da mesma competência" });
    }
    if (issuer.tipo === "profissional" && charges.some((x: any) => x.professional_id !== issuer.professional_id)) {
      throw new HTTPException(422, { message: "A cobrança é de outro profissional: a nota deve sair no CNPJ de quem prestou o serviço" });
    }
    const ch = charges[0];
    const valor = charges.reduce((n: number, x: any) => n + x.liquido_centavos, 0);

    let tomador: Record<string, unknown>;
    if (ch.payer_id) {
      const p = (await db.query("SELECT nome, cpf_cnpj, email FROM payers WHERE id = $1", [ch.payer_id])).rows[0];
      if (!p) throw new HTTPException(422, { message: "Responsável financeiro não encontrado" });
      tomador = { nome: p.nome, cpf_cnpj: p.cpf_cnpj, email: p.email, origem: "responsavel" };
    } else {
      const p = (await db.query("SELECT nome, cpf, email FROM patients WHERE id = $1", [ch.patient_id])).rows[0];
      if (!p) throw new HTTPException(422, { message: "Paciente não encontrado" });
      tomador = { nome: p.nome, cpf_cnpj: p.cpf, email: p.email, origem: "paciente" };
    }
    const servico = { descricao: SERVICE_DESCRIPTION, codigo_tributacao: issuer.codigo_tributacao_padrao ?? null, municipio_ibge: issuer.municipio_ibge };
    const hoje = await clinicToday(db, s.clinicId);

    const ins = await db.query(
      `INSERT INTO fiscal_documents (clinic_id, issuer_id, tomador, servico, valor_centavos, competencia, data_emissao, created_by)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8) RETURNING id`,
      [s.clinicId, issuer.id, JSON.stringify(tomador), JSON.stringify(servico), valor, ch.competencia, body.data_emissao ?? hoje, s.userId],
    );
    for (const id of ids) {
      await db.query("INSERT INTO fiscal_document_charges (document_id, charge_id, clinic_id) VALUES ($1, $2, $3)", [ins.rows[0].id, id, s.clinicId]);
    }
    await audit(db, s, "nfse.create", "fiscal_document", ins.rows[0].id);
    return loadDoc(db, ins.rows[0].id);
  });
  return c.json(doc, 201);
});

nfse.get("/:id", async (c) => c.json(await withSession(c.get("pool"), c.get("session"), (db) => loadDoc(db, c.req.param("id")))));

// Ajustes do rascunho: data da emissão e dados do tomador (por exemplo, completar o CPF).
nfse.patch("/:id", requireRole("admin", "recepcao", "psicologo"), async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z
      .object({
        data_emissao: dateOnly,
        tomador: z.object({ nome: z.string().trim().min(2).max(160), cpf_cnpj: cpfCnpjSchema.nullable(), email: z.string().trim().email().max(160).nullable() }).partial(),
      })
      .partial(),
  );
  const doc = await withSession(c.get("pool"), s, async (db) => {
    const cur = await loadDoc(db, c.req.param("id"));
    if (cur.status !== "rascunho") throw new HTTPException(422, { message: "Só rascunho pode ser editado" });
    const tomador = body.tomador ? { ...cur.tomador, ...Object.fromEntries(Object.entries(body.tomador).filter(([, v]) => v !== undefined)) } : cur.tomador;
    await db.query("UPDATE fiscal_documents SET tomador = $2::jsonb, data_emissao = COALESCE($3::date, data_emissao) WHERE id = $1", [cur.id, JSON.stringify(tomador), body.data_emissao ?? null]);
    await audit(db, s, "nfse.update", "fiscal_document", cur.id);
    return loadDoc(db, cur.id);
  });
  return c.json(doc);
});

nfse.delete("/:id", requireRole("admin", "recepcao", "psicologo"), async (c) => {
  const s = c.get("session");
  await withSession(c.get("pool"), s, async (db) => {
    const cur = await loadDoc(db, c.req.param("id"));
    if (cur.status !== "rascunho") throw new HTTPException(422, { message: "Só rascunho pode ser descartado" });
    await db.query("DELETE FROM fiscal_documents WHERE id = $1", [cur.id]);
    await audit(db, s, "nfse.discard", "fiscal_document", cur.id);
  });
  return c.json({ ok: true });
});

// Dados prontos para digitar no Emissor Nacional.
nfse.get("/:id/dps-pack", async (c) => {
  const out = await withSession(c.get("pool"), c.get("session"), async (db) => {
    const d = await loadDoc(db, c.req.param("id"));
    if (d.status === "cancelada") throw new HTTPException(422, { message: "Nota cancelada" });
    const i = (await db.query("SELECT cnpj, razao_social, inscricao_municipal, municipio_ibge, regime FROM fiscal_issuers WHERE id = $1", [d.issuer_id])).rows[0];
    return {
      documento_id: d.id,
      status: d.status,
      emissor: i,
      tomador: d.tomador,
      servico: {
        ...d.servico,
        sugestao: "Item 4.16 da LC 116 (psicologia). Escolha o serviço na lista do portal e confirme o código com o seu contador.",
      },
      valor_centavos: d.valor_centavos,
      competencia: d.competencia,
      data_emissao: d.data_emissao,
      pendencias: d.pendencias,
      passos: [
        "Entre no Emissor Nacional com o CNPJ do emissor.",
        "Preencha tomador, serviço, valor e competência com os dados acima.",
        "Emita a nota e baixe o XML.",
        "Volte aqui e registre a chave de acesso (50 dígitos), o número e o XML.",
      ],
    };
  });
  return c.json(out);
});

// ---- registro da nota emitida fora do sistema

const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: false });

/** Procura a primeira ocorrência de `key` na árvore, opcionalmente dentro de um nó chamado `within`. */
function findFirst(node: unknown, key: string, within?: string, inside = !within): unknown {
  if (node === null || typeof node !== "object") return undefined;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === key && inside) return v;
    const found = findFirst(v, key, within, inside || k === within);
    if (found !== undefined) return found;
  }
  return undefined;
}

const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : undefined);

/**
 * Confere o XML contra o rascunho. Só diverge o que foi lido e é diferente; o que não foi encontrado vira aviso,
 * porque o leiaute exato do XML nacional ainda não foi verificado contra a documentação oficial.
 */
function checkXml(xml: string, doc: any, chave: string | undefined, numero: string) {
  if (XMLValidator.validate(xml) !== true) throw new HTTPException(422, { message: "O arquivo XML é inválido" });
  const tree = xmlParser.parse(xml);
  const divergencias: string[] = [];
  const avisos: string[] = [];

  const cnpj = text(findFirst(tree, "CNPJ", "emit")) ?? text(findFirst(tree, "CNPJ", "prest"));
  if (!cnpj) avisos.push("Não foi possível ler o CNPJ do prestador no XML");
  else if (cnpj.toUpperCase() !== doc.emissor_cnpj) divergencias.push(`CNPJ do prestador (esperado ${doc.emissor_cnpj}, no XML ${cnpj})`);

  const vServ = text(findFirst(tree, "vServ"));
  if (!vServ || Number.isNaN(Number(vServ))) avisos.push("Não foi possível ler o valor do serviço no XML");
  else if (Math.round(Number(vServ) * 100) !== doc.valor_centavos) {
    divergencias.push(`valor do serviço (esperado ${(doc.valor_centavos / 100).toFixed(2)}, no XML ${vServ})`);
  }

  const toma = text(findFirst(tree, "CPF", "toma")) ?? text(findFirst(tree, "CNPJ", "toma"));
  if (doc.tomador?.cpf_cnpj) {
    if (!toma) avisos.push("Não foi possível ler o documento do tomador no XML");
    else if (toma.toUpperCase() !== doc.tomador.cpf_cnpj) divergencias.push("documento do tomador");
  }

  // número da nota (nNFSe): compara sem zeros à esquerda
  const nNFSe = text(findFirst(tree, "nNFSe"));
  if (!nNFSe) avisos.push("Não foi possível ler o número da nota no XML");
  else if (nNFSe.replace(/^0+/, "") !== numero.replace(/^0+/, "")) divergencias.push(`número da nota (informado ${numero}, no XML ${nNFSe})`);

  // chave de acesso: o Id de infNFSe carrega a chave; só compara quando o Id traz exatamente 50 dígitos
  const infNFSe = findFirst(tree, "infNFSe");
  const id = infNFSe && typeof infNFSe === "object" ? text((infNFSe as Record<string, unknown>)["@_Id"]) : undefined;
  const idDigits = id?.replace(/\D/g, "");
  if (chave && idDigits?.length === 50) {
    if (idDigits !== chave) divergencias.push("chave de acesso (diferente da que consta no XML)");
  } else if (chave) avisos.push("Não foi possível ler a chave de acesso no XML");

  if (divergencias.length) throw new HTTPException(422, { message: `O XML não confere com o rascunho: ${divergencias.join("; ")}` });
  return avisos;
}

const mustBeIssuer = (s: { userId: string }, doc: any) => {
  if (doc.emissor_professional_id !== s.userId) {
    throw new HTTPException(403, { message: "Só o profissional emissor registra ou cancela a nota" });
  }
};

nfse.post("/:id/register", requireRole("admin", "psicologo"), async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z
      .object({
        origem: z.enum(["nacional", "municipal"]).default("nacional"),
        chave_acesso: z.string().trim().regex(/^\d{50}$/, "A chave de acesso tem 50 dígitos").optional(),
        numero_nfse: z.string().trim().min(1).max(20),
        emitida_em: z.iso.datetime({ offset: true }).optional(),
        xml: z.string().max(1_000_000).optional(),
      })
      .refine((b) => b.origem === "municipal" || !!b.chave_acesso, { message: "Informe a chave de acesso (50 dígitos)", path: ["chave_acesso"] }),
  );
  if (body.emitida_em && Date.parse(body.emitida_em) > Date.now() + 5 * 60_000) {
    throw new HTTPException(422, { message: "A data de emissão não pode ser futura" });
  }
  const out = await withSession(c.get("pool"), s, async (db) => {
    const doc = await loadDoc(db, c.req.param("id"));
    mustBeIssuer(s, doc);
    if (doc.status !== "rascunho") throw new HTTPException(422, { message: "Esta nota já foi registrada" });
    const avisos = body.xml && body.origem === "nacional" ? checkXml(body.xml, doc, body.chave_acesso, body.numero_nfse) : body.xml ? ["XML não conferido: só o padrão nacional é verificado"] : [];
    const hash = await sha256Hex(
      JSON.stringify([doc.emissor_cnpj, doc.tomador, doc.servico, doc.valor_centavos, doc.competencia, doc.data_emissao, body.chave_acesso ?? null, body.numero_nfse, body.xml ? await sha256Hex(body.xml) : null]),
    );
    await db.query(
      `UPDATE fiscal_documents SET status = 'emitida', origem = $2, chave_acesso = $3, numero_nfse = $4,
              emitida_em = COALESCE($5::timestamptz, now()), xml_nfse = $6, content_hash = $7 WHERE id = $1`,
      [doc.id, body.origem, body.chave_acesso ?? null, body.numero_nfse, body.emitida_em ?? null, body.xml ?? null, hash],
    );
    await audit(db, s, "nfse.register", "fiscal_document", doc.id);
    return { ...(await loadDoc(db, doc.id)), avisos };
  });
  return c.json(out);
});

// Registra o cancelamento feito no Emissor Nacional.
nfse.post("/:id/cancel", requireRole("admin", "psicologo"), async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ motivo: z.string().trim().min(5, "Informe o motivo (mínimo 5 caracteres)").max(300) }));
  const doc = await withSession(c.get("pool"), s, async (db) => {
    const cur = await loadDoc(db, c.req.param("id"));
    mustBeIssuer(s, cur);
    if (cur.status !== "emitida") throw new HTTPException(422, { message: "Só nota emitida pode ser cancelada" });
    await db.query("UPDATE fiscal_documents SET status = 'cancelada', cancelada_em = now(), cancel_motivo = $2 WHERE id = $1", [cur.id, body.motivo]);
    await audit(db, s, "nfse.cancel", "fiscal_document", cur.id);
    return loadDoc(db, cur.id);
  });
  return c.json(doc);
});

nfse.get("/:id/xml", async (c) => {
  const s = c.get("session");
  const row = await withSession(c.get("pool"), s, async (db) => {
    const r = (await db.query("SELECT xml_nfse, numero_nfse FROM fiscal_documents WHERE id = $1", [c.req.param("id")])).rows[0];
    if (r?.xml_nfse) await audit(db, s, "nfse.xml_download", "fiscal_document", c.req.param("id"));
    return r;
  });
  if (!row?.xml_nfse) throw notFound("XML");
  return c.body(row.xml_nfse, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Content-Disposition": `attachment; filename="nfse-${String(row.numero_nfse).replace(/[^\w.-]/g, "_")}.xml"`,
    "Cache-Control": "no-store",
  });
});
