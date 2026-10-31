import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_KEYS,
  canonicalize,
  type DocumentTypeKey,
  type Identificacao,
  type LetterheadData,
} from "../../../shared/documents";
import { audit, withDb, withSession, type DbClient, type Session } from "../db";
import { rateLimit, requireAuth, requireRole } from "../middleware";
import { sha256Hex } from "../security";
import type { AppEnv } from "../types";
import { optText, readBody, readQuery } from "../validation";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newCodigo = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => ALPHABET[b % 32]).join("");

const LIST_COLS = `id, patient_id, professional_id, tipo, titulo, status, numero, codigo, data_documento::text AS data_documento,
                   emitted_at, identificacao ->> 'paciente_nome' AS paciente_nome`;
const FULL_COLS = `id, patient_id, professional_id, tipo, titulo, status, solicitante, finalidade, local,
                   data_documento::text AS data_documento, conteudo, identificacao, numero, codigo, content_hash,
                   letterhead, emitted_at, annul_reason, created_at, updated_at`;

// ------------------------------------------------------------------ papel timbrado

const dataUrl = (max: number) =>
  z.string().regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/, "Imagem inválida: use PNG ou JPEG").max(max, "Imagem muito grande");

const letterheadShape = {
  nome: z.string().trim().min(2).max(80),
  modo: z.enum(["padrao", "imagem", "impresso"]),
  margem_top_mm: z.number().int().min(5).max(80),
  margem_bottom_mm: z.number().int().min(5).max(80),
  margem_left_mm: z.number().int().min(10).max(50),
  margem_right_mm: z.number().int().min(10).max(50),
  logo_data_url: dataUrl(600_000).nullable(),
  linhas: z.array(z.string().trim().min(1).max(120)).max(6),
  rodape: optText(300),
  fundo_data_url: dataUrl(4_500_000).nullable(),
  is_default: z.boolean(),
  ativo: z.boolean(),
};

const LH_COLS =
  "id, nome, modo, margem_top_mm, margem_bottom_mm, margem_left_mm, margem_right_mm, logo_data_url, linhas, rodape, fundo_data_url, is_default, ativo";

function checkLetterhead(l: { modo: string; fundo_data_url?: string | null }) {
  if (l.modo === "imagem" && !l.fundo_data_url) {
    throw new HTTPException(422, { message: "O modo com imagem de fundo exige a imagem do papel timbrado" });
  }
}

export const letterheads = new Hono<AppEnv>();
letterheads.use("*", requireAuth);

letterheads.get("/", async (c) => {
  const s = c.get("session");
  const rows = await withSession(c.get("pool"), s, async (db) =>
    (await db.query(`SELECT ${LH_COLS} FROM letterheads WHERE ($1 OR ativo) ORDER BY is_default DESC, nome`, [s.role === "admin"])).rows,
  );
  return c.json(rows);
});

letterheads.post("/", requireRole("admin"), async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      ...letterheadShape,
      margem_top_mm: letterheadShape.margem_top_mm.default(25),
      margem_bottom_mm: letterheadShape.margem_bottom_mm.default(20),
      margem_left_mm: letterheadShape.margem_left_mm.default(25),
      margem_right_mm: letterheadShape.margem_right_mm.default(20),
      logo_data_url: letterheadShape.logo_data_url.default(null),
      linhas: letterheadShape.linhas.default([]),
      fundo_data_url: letterheadShape.fundo_data_url.default(null),
      is_default: letterheadShape.is_default.default(false),
      ativo: z.literal(true).default(true),
    }),
  );
  checkLetterhead(body);
  const row = await withSession(c.get("pool"), s, async (db) => {
    if (body.is_default) await db.query("UPDATE letterheads SET is_default = false WHERE is_default");
    const r = await db.query(
      `INSERT INTO letterheads (clinic_id, nome, modo, margem_top_mm, margem_bottom_mm, margem_left_mm, margem_right_mm,
                                logo_data_url, linhas, rodape, fundo_data_url, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${LH_COLS}`,
      [s.clinicId, body.nome, body.modo, body.margem_top_mm, body.margem_bottom_mm, body.margem_left_mm, body.margem_right_mm,
       body.logo_data_url, body.linhas, body.rodape ?? null, body.fundo_data_url, body.is_default],
    );
    await audit(db, s, "letterhead.create", "letterhead", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row, 201);
});

letterheads.patch("/:id", requireRole("admin"), async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object(letterheadShape).partial());
  const row = await withSession(c.get("pool"), s, async (db) => {
    const cur = (await db.query(`SELECT ${LH_COLS} FROM letterheads WHERE id = $1 FOR UPDATE`, [c.req.param("id")])).rows[0];
    if (!cur) throw new HTTPException(404, { message: "Papel timbrado não encontrado" });
    const merged: Record<string, any> = { ...cur, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) };
    checkLetterhead({ modo: merged.modo, fundo_data_url: merged.fundo_data_url });
    if (merged.ativo === false) merged.is_default = false;
    if (merged.is_default) await db.query("UPDATE letterheads SET is_default = false WHERE is_default AND id <> $1", [cur.id]);
    const r = await db.query(
      `UPDATE letterheads SET nome = $2, modo = $3, margem_top_mm = $4, margem_bottom_mm = $5, margem_left_mm = $6,
              margem_right_mm = $7, logo_data_url = $8, linhas = $9, rodape = $10, fundo_data_url = $11,
              is_default = $12, ativo = $13 WHERE id = $1 RETURNING ${LH_COLS}`,
      [cur.id, merged.nome, merged.modo, merged.margem_top_mm, merged.margem_bottom_mm, merged.margem_left_mm,
       merged.margem_right_mm, merged.logo_data_url, merged.linhas, merged.rodape, merged.fundo_data_url,
       merged.is_default, merged.ativo],
    );
    await audit(db, s, "letterhead.update", "letterhead", cur.id);
    return r.rows[0];
  });
  return c.json(row);
});

// ------------------------------------------------------------------ documentos

const authorOnly = createMiddleware<AppEnv>(async (c, next) => {
  const s = c.get("session");
  if (!(s.role === "psicologo" || (s.role === "admin" && s.atende))) {
    throw new HTTPException(403, { message: "Apenas psicólogos podem produzir documentos psicológicos" });
  }
  await next();
});

const typeSchema = z.enum(DOCUMENT_TYPE_KEYS as [DocumentTypeKey, ...DocumentTypeKey[]]);
const fields = {
  titulo: z.string().trim().min(2).max(200),
  solicitante: optText(200),
  finalidade: optText(500),
  local: optText(120),
  data_documento: z.iso.date(),
  conteudo: z.record(z.string(), z.string().max(20000)),
};

function cleanContent(tipo: DocumentTypeKey, conteudo: Record<string, string>) {
  const keys = new Set(DOCUMENT_TYPES[tipo].sections.map((x) => x.key));
  return Object.fromEntries(Object.entries(conteudo).filter(([k]) => keys.has(k)));
}

async function buildIdentificacao(db: DbClient, s: Session, patientId: string): Promise<Identificacao> {
  const p = (await db.query("SELECT nome, data_nascimento::text AS nascimento FROM patients WHERE id = $1", [patientId])).rows[0];
  if (!p) throw new HTTPException(404, { message: "Paciente não encontrado" });
  const u = (await db.query("SELECT nome, crp FROM users WHERE id = $1", [s.userId])).rows[0];
  const cl = (await db.query("SELECT nome FROM clinics WHERE id = $1", [s.clinicId])).rows[0];
  if (!u?.crp) throw new HTTPException(422, { message: "Informe o CRP no seu cadastro antes de produzir documentos" });
  return {
    paciente_nome: p.nome,
    paciente_nascimento: p.nascimento,
    psicologo_nome: u.nome,
    psicologo_crp: u.crp,
    clinica_nome: cl.nome,
  };
}

async function loadForUpdate(db: DbClient, id: string) {
  const d = (await db.query(`SELECT ${FULL_COLS} FROM documents WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!d) throw new HTTPException(404, { message: "Documento não encontrado" });
  return d;
}

export const documents = new Hono<AppEnv>();
documents.use("*", requireAuth, authorOnly);

documents.get("/", async (c) => {
  const q = readQuery(c, z.object({ patient_id: z.uuid().optional(), status: z.enum(["rascunho", "emitido", "anulado"]).optional() }));
  const rows = await withSession(c.get("pool"), c.get("session"), async (db) =>
    (
      await db.query(
        `SELECT ${LIST_COLS} FROM documents
         WHERE ($1::uuid IS NULL OR patient_id = $1) AND ($2::text IS NULL OR status = $2)
         ORDER BY created_at DESC LIMIT 300`,
        [q.patient_id ?? null, q.status ?? null],
      )
    ).rows,
  );
  return c.json(rows);
});

documents.post("/", async (c) => {
  const s = c.get("session");
  const body = await readBody(
    c,
    z.object({
      patient_id: z.uuid(),
      tipo: typeSchema,
      titulo: fields.titulo.optional(),
      solicitante: fields.solicitante,
      finalidade: fields.finalidade,
      local: fields.local,
      data_documento: fields.data_documento.optional(),
      conteudo: fields.conteudo.default({}),
    }),
  );
  const row = await withSession(c.get("pool"), s, async (db) => {
    const ident = await buildIdentificacao(db, s, body.patient_id);
    const r = await db.query(
      `INSERT INTO documents (clinic_id, patient_id, professional_id, tipo, titulo, solicitante, finalidade, local,
                              data_documento, conteudo, identificacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               COALESCE($9::date, (SELECT (now() AT TIME ZONE timezone)::date FROM clinics WHERE id = $1)), $10, $11)
       RETURNING ${FULL_COLS}`,
      [s.clinicId, body.patient_id, s.userId, body.tipo, body.titulo ?? DOCUMENT_TYPES[body.tipo].titulo,
       body.solicitante ?? null, body.finalidade ?? null, body.local ?? null, body.data_documento ?? null,
       JSON.stringify(cleanContent(body.tipo, body.conteudo)), JSON.stringify(ident)],
    );
    await audit(db, s, "document.create", "document", r.rows[0].id);
    return r.rows[0];
  });
  return c.json(row, 201);
});

documents.get("/:id", async (c) => {
  const s = c.get("session");
  const row = await withSession(c.get("pool"), s, async (db) => {
    const d = (await db.query(`SELECT ${FULL_COLS} FROM documents WHERE id = $1`, [c.req.param("id")])).rows[0];
    if (d) await audit(db, s, "document.view", "document", d.id);
    return d;
  });
  if (!row) throw new HTTPException(404, { message: "Documento não encontrado" });
  return c.json(row);
});

documents.patch("/:id", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object(fields).partial());
  const row = await withSession(c.get("pool"), s, async (db) => {
    const cur = await loadForUpdate(db, c.req.param("id"));
    if (cur.status !== "rascunho") throw new HTTPException(409, { message: "Documento já emitido: não pode ser alterado" });
    const ident = await buildIdentificacao(db, s, cur.patient_id);
    const next = {
      titulo: body.titulo ?? cur.titulo,
      solicitante: body.solicitante !== undefined ? body.solicitante : cur.solicitante,
      finalidade: body.finalidade !== undefined ? body.finalidade : cur.finalidade,
      local: body.local !== undefined ? body.local : cur.local,
      data_documento: body.data_documento ?? cur.data_documento,
      conteudo: body.conteudo ? cleanContent(cur.tipo, body.conteudo) : cur.conteudo,
    };
    const r = await db.query(
      `UPDATE documents SET titulo = $2, solicitante = $3, finalidade = $4, local = $5, data_documento = $6,
              conteudo = $7, identificacao = $8 WHERE id = $1 RETURNING ${FULL_COLS}`,
      [cur.id, next.titulo, next.solicitante ?? null, next.finalidade ?? null, next.local ?? null, next.data_documento,
       JSON.stringify(next.conteudo), JSON.stringify(ident)],
    );
    await audit(db, s, "document.update", "document", cur.id);
    return r.rows[0];
  });
  return c.json(row);
});

documents.delete("/:id", async (c) => {
  const s = c.get("session");
  await withSession(c.get("pool"), s, async (db) => {
    const cur = await loadForUpdate(db, c.req.param("id"));
    if (cur.status !== "rascunho") throw new HTTPException(409, { message: "Documento emitido não pode ser excluído; anule-o com um motivo" });
    await db.query("DELETE FROM documents WHERE id = $1", [cur.id]);
    await audit(db, s, "document.delete_draft", "document", cur.id);
  });
  return c.body(null, 204);
});

// Emitir = numerar, congelar o conteúdo e o papel timbrado, e gerar código e hash de verificação.
documents.post("/:id/emit", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ letterhead_id: z.uuid().nullable().optional() }));
  const row = await withSession(c.get("pool"), s, async (db) => {
    const cur = await loadForUpdate(db, c.req.param("id"));
    if (cur.status !== "rascunho") throw new HTTPException(409, { message: "Este documento já foi emitido" });

    const def = DOCUMENT_TYPES[cur.tipo as DocumentTypeKey];
    const missing: string[] = [];
    if (def.needsFinalidade && !cur.finalidade?.trim()) missing.push("Finalidade");
    if (def.needsSolicitante && !cur.solicitante?.trim()) missing.push("Solicitante");
    for (const sec of def.sections) if (sec.required && !cur.conteudo[sec.key]?.trim()) missing.push(sec.label);
    if (missing.length) throw new HTTPException(422, { message: `Preencha antes de emitir: ${missing.join(", ")}` });

    const ident = await buildIdentificacao(db, s, cur.patient_id);

    let letterhead: LetterheadData | null = null;
    if (body.letterhead_id !== null) {
      const lh = (
        await db.query(
          `SELECT ${LH_COLS} FROM letterheads WHERE ativo AND ${body.letterhead_id ? "id = $1" : "is_default AND $1::uuid IS NULL"}`,
          [body.letterhead_id ?? null],
        )
      ).rows[0];
      if (body.letterhead_id && !lh) throw new HTTPException(404, { message: "Papel timbrado não encontrado" });
      if (lh) {
        letterhead = {
          modo: lh.modo, margem_top_mm: lh.margem_top_mm, margem_bottom_mm: lh.margem_bottom_mm,
          margem_left_mm: lh.margem_left_mm, margem_right_mm: lh.margem_right_mm, logo_data_url: lh.logo_data_url,
          linhas: lh.linhas, rodape: lh.rodape, fundo_data_url: lh.fundo_data_url,
        };
      }
    }

    const numero = (await db.query("SELECT app_next_document_number() AS n")).rows[0].n as string;
    const codigo = newCodigo();
    const hash = await sha256Hex(
      canonicalize({
        tipo: cur.tipo, titulo: cur.titulo, numero, data_documento: cur.data_documento, local: cur.local,
        solicitante: cur.solicitante, finalidade: cur.finalidade, conteudo: cur.conteudo, identificacao: ident,
      }),
    );
    const r = await db.query(
      `UPDATE documents SET status = 'emitido', numero = $2, codigo = $3, content_hash = $4, letterhead = $5,
              identificacao = $6, emitted_at = now() WHERE id = $1 RETURNING ${FULL_COLS}`,
      [cur.id, numero, codigo, hash, letterhead ? JSON.stringify(letterhead) : null, JSON.stringify(ident)],
    );
    await audit(db, s, "document.emit", "document", cur.id);
    return r.rows[0];
  });
  return c.json(row);
});

documents.post("/:id/annul", async (c) => {
  const s = c.get("session");
  const body = await readBody(c, z.object({ motivo: z.string().trim().min(5, "Informe o motivo da anulação").max(300) }));
  const row = await withSession(c.get("pool"), s, async (db) => {
    const cur = await loadForUpdate(db, c.req.param("id"));
    if (cur.status === "rascunho") throw new HTTPException(409, { message: "Documentos em rascunho podem ser excluídos" });
    if (cur.status === "anulado") throw new HTTPException(409, { message: "Documento já anulado" });
    const r = await db.query(`UPDATE documents SET status = 'anulado', annul_reason = $2 WHERE id = $1 RETURNING ${FULL_COLS}`, [cur.id, body.motivo]);
    await audit(db, s, "document.annul", "document", cur.id);
    return r.rows[0];
  });
  return c.json(row);
});

// Verificação pública (sem login): confirma autenticidade sem revelar a pessoa atendida.
export const publicDocuments = new Hono<AppEnv>();
publicDocuments.get("/verify/:codigo", async (c) => {
  await rateLimit(c, "verify", 30);
  const codigo = c.req.param("codigo");
  if (!/^[0-9A-Za-z-]{8,20}$/.test(codigo)) throw new HTTPException(404, { message: "Documento não encontrado" });
  const row = await withDb(c.get("pool"), async (db) => (await db.query("SELECT * FROM app_verify_document($1)", [codigo])).rows[0]);
  if (!row) throw new HTTPException(404, { message: "Documento não encontrado" });
  return c.json(row);
});
