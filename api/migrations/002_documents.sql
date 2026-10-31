-- Documentos psicológicos e papéis timbrados.

CREATE TABLE letterheads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 80),
  modo text NOT NULL CHECK (modo IN ('padrao', 'imagem', 'impresso')),
  margem_top_mm int NOT NULL DEFAULT 25 CHECK (margem_top_mm BETWEEN 5 AND 80),
  margem_bottom_mm int NOT NULL DEFAULT 20 CHECK (margem_bottom_mm BETWEEN 5 AND 80),
  margem_left_mm int NOT NULL DEFAULT 25 CHECK (margem_left_mm BETWEEN 10 AND 50),
  margem_right_mm int NOT NULL DEFAULT 20 CHECK (margem_right_mm BETWEEN 10 AND 50),
  logo_data_url text CHECK (logo_data_url IS NULL OR length(logo_data_url) <= 600000),
  linhas text[] NOT NULL DEFAULT '{}' CHECK (cardinality(linhas) <= 6),
  rodape text CHECK (rodape IS NULL OR length(rodape) <= 300),
  fundo_data_url text CHECK (fundo_data_url IS NULL OR length(fundo_data_url) <= 4500000),
  is_default boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id)
);
CREATE UNIQUE INDEX letterheads_one_default ON letterheads (clinic_id) WHERE is_default AND ativo;
CREATE TRIGGER letterheads_updated BEFORE UPDATE ON letterheads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER letterheads_clinic_fixed BEFORE UPDATE ON letterheads FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();

CREATE TABLE document_counters (
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  ano int NOT NULL,
  ultimo int NOT NULL,
  PRIMARY KEY (clinic_id, ano)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('declaracao', 'atestado', 'relatorio', 'relatorio_multiprofissional',
                                      'laudo', 'parecer', 'encaminhamento', 'termo_consentimento')),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 2 AND 200),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'emitido', 'anulado')),
  solicitante text,
  finalidade text,
  local text,
  data_documento date NOT NULL,
  conteudo jsonb NOT NULL DEFAULT '{}',
  identificacao jsonb NOT NULL,
  numero text,
  codigo text UNIQUE,
  content_hash text,
  letterhead jsonb,
  emitted_at timestamptz,
  annulled_at timestamptz,
  annul_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id),
  UNIQUE (clinic_id, numero),
  CHECK (status = 'rascunho' OR (numero IS NOT NULL AND codigo IS NOT NULL AND content_hash IS NOT NULL AND emitted_at IS NOT NULL))
);
CREATE INDEX documents_patient_idx ON documents (clinic_id, patient_id, created_at DESC);
CREATE INDEX documents_prof_idx ON documents (clinic_id, professional_id, created_at DESC);

CREATE TRIGGER documents_updated BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER documents_clinic_fixed BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();

-- Documento emitido é registro documental: não muda. Só pode ser anulado (com motivo), e nunca apagado.
CREATE FUNCTION documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'rascunho' THEN
      RAISE EXCEPTION 'Documento emitido não pode ser excluído; anule-o com um motivo' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'rascunho' THEN
    IF NEW.status NOT IN ('rascunho', 'emitido') THEN
      RAISE EXCEPTION 'Emita o documento antes de anulá-lo' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'emitido' AND NEW.status = 'anulado'
     AND NEW.annul_reason IS NOT NULL AND length(trim(NEW.annul_reason)) >= 5
     AND (to_jsonb(NEW) - 'status' - 'annulled_at' - 'annul_reason' - 'updated_at')
       = (to_jsonb(OLD) - 'status' - 'annulled_at' - 'annul_reason' - 'updated_at') THEN
    NEW.annulled_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Documento emitido não pode ser alterado' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER documents_guard_upd BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION documents_guard();
CREATE TRIGGER documents_guard_del BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION documents_guard();

ALTER TABLE letterheads ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY letterheads_select ON letterheads FOR SELECT TO app_runtime USING (clinic_id = app_clinic());
CREATE POLICY letterheads_insert ON letterheads FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND app_role() = 'admin');
CREATE POLICY letterheads_update ON letterheads FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic() AND app_role() = 'admin') WITH CHECK (clinic_id = app_clinic());

-- Leitura: autor ou administrador que atende. Escrita: só o autor (psicólogo ou admin que atende).
CREATE POLICY documents_select ON documents FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND (professional_id = app_user() OR (app_role() = 'admin' AND app_atende())));
CREATE POLICY documents_insert ON documents FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND professional_id = app_user()
              AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende())));
CREATE POLICY documents_update ON documents FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic() AND professional_id = app_user()) WITH CHECK (clinic_id = app_clinic() AND professional_id = app_user());
CREATE POLICY documents_delete ON documents FOR DELETE TO app_runtime
  USING (clinic_id = app_clinic() AND professional_id = app_user() AND status = 'rascunho');

GRANT SELECT, INSERT, UPDATE ON letterheads TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO app_runtime;

-- Numeração sequencial por clínica e ano (2026/0001), sem buracos: roda na mesma transação da emissão.
CREATE FUNCTION app_next_document_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  tz text;
  y int;
  n int;
BEGIN
  IF app_clinic() IS NULL THEN
    RAISE EXCEPTION 'Sem contexto de clínica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT timezone INTO tz FROM clinics WHERE id = app_clinic();
  y := extract(year FROM now() AT TIME ZONE tz)::int;
  INSERT INTO document_counters (clinic_id, ano, ultimo) VALUES (app_clinic(), y, 1)
  ON CONFLICT (clinic_id, ano) DO UPDATE SET ultimo = document_counters.ultimo + 1
  RETURNING ultimo INTO n;
  RETURN y::text || '/' || lpad(n::text, 4, '0');
END $$;

-- Verificação pública: confirma autenticidade sem expor a pessoa atendida.
CREATE FUNCTION app_verify_document(p_codigo text)
RETURNS TABLE (tipo text, titulo text, numero text, status text, emitted_at timestamptz, annulled_at timestamptz,
               psicologo_nome text, psicologo_crp text, clinica_nome text, content_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d.tipo, d.titulo, d.numero, d.status, d.emitted_at, d.annulled_at,
         d.identificacao ->> 'psicologo_nome', d.identificacao ->> 'psicologo_crp',
         d.identificacao ->> 'clinica_nome', d.content_hash
  FROM documents d
  WHERE d.codigo = upper(replace(p_codigo, '-', '')) AND d.status <> 'rascunho'
$$;

REVOKE ALL ON FUNCTION app_next_document_number(), app_verify_document(text), documents_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_next_document_number(), app_verify_document(text) TO app_runtime;
