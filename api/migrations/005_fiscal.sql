-- NFS-e assistida (fase 2): o sistema monta e valida os dados, o psicólogo emite no Emissor Nacional e
-- registra aqui o resultado. Nenhum certificado digital passa pelo sistema.

ALTER TABLE patients ADD COLUMN cpf text CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');

-- ---------------------------------------------------------------- tabelas

CREATE TABLE fiscal_issuers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  tipo text NOT NULL CHECK (tipo IN ('clinica', 'profissional')),
  professional_id uuid,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  razao_social text NOT NULL CHECK (length(razao_social) BETWEEN 2 AND 160),
  inscricao_municipal text CHECK (inscricao_municipal IS NULL OR length(inscricao_municipal) <= 30),
  municipio_ibge text NOT NULL CHECK (municipio_ibge ~ '^[0-9]{7}$'),
  regime text NOT NULL DEFAULT 'simples' CHECK (regime IN ('mei', 'simples', 'presumido', 'outro')),
  serie text NOT NULL DEFAULT '1' CHECK (length(serie) BETWEEN 1 AND 5),
  codigo_tributacao_padrao text CHECK (codigo_tributacao_padrao IS NULL OR length(codigo_tributacao_padrao) <= 20),
  ambiente text NOT NULL DEFAULT 'producao' CHECK (ambiente IN ('homologacao', 'producao')),
  modo text NOT NULL DEFAULT 'assistida' CHECK (modo IN ('assistida', 'nacional', 'gateway')),
  emissor_nacional_ok boolean NOT NULL DEFAULT false, -- o psicólogo confirmou que consegue emitir no portal
  habilitado_em date,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id),
  FOREIGN KEY (clinic_id, created_by) REFERENCES users (clinic_id, id),
  CHECK ((tipo = 'profissional') = (professional_id IS NOT NULL))
);
CREATE UNIQUE INDEX fiscal_issuers_cnpj_uq ON fiscal_issuers (clinic_id, cnpj) WHERE ativo;

CREATE TABLE fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  issuer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'emitida', 'cancelada')),
  origem text NOT NULL DEFAULT 'nacional' CHECK (origem IN ('nacional', 'municipal')),
  tomador jsonb NOT NULL,   -- cópia (snapshot) do tomador no momento da criação
  servico jsonb NOT NULL,   -- cópia do serviço: código de tributação e descrição fixa
  tributos jsonb NOT NULL DEFAULT '{}'::jsonb,
  valor_centavos int NOT NULL CHECK (valor_centavos BETWEEN 1 AND 10000000),
  competencia date NOT NULL CHECK (extract(day FROM competencia) = 1),
  data_emissao date NOT NULL,
  chave_acesso text CHECK (chave_acesso IS NULL OR chave_acesso ~ '^[0-9]{50}$'),
  numero_nfse text CHECK (numero_nfse IS NULL OR length(numero_nfse) BETWEEN 1 AND 20),
  emitida_em timestamptz,
  xml_nfse text CHECK (xml_nfse IS NULL OR length(xml_nfse) <= 1048576),
  content_hash text,
  layout_version text,
  cancelada_em timestamptz,
  cancel_motivo text CHECK (cancel_motivo IS NULL OR length(trim(cancel_motivo)) >= 5),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, issuer_id) REFERENCES fiscal_issuers (clinic_id, id),
  FOREIGN KEY (clinic_id, created_by) REFERENCES users (clinic_id, id),
  CHECK (status = 'rascunho' OR (numero_nfse IS NOT NULL AND emitida_em IS NOT NULL)),
  CHECK (status = 'rascunho' OR origem = 'municipal' OR chave_acesso IS NOT NULL),
  CHECK ((status = 'cancelada') = (cancelada_em IS NOT NULL AND cancel_motivo IS NOT NULL))
);
CREATE UNIQUE INDEX fiscal_documents_chave_uq ON fiscal_documents (clinic_id, chave_acesso) WHERE chave_acesso IS NOT NULL;
CREATE INDEX fiscal_documents_issuer_idx ON fiscal_documents (clinic_id, issuer_id, competencia);

-- Cobranças cobertas por cada nota. Uma cobrança tem no máximo uma nota ativa.
CREATE TABLE fiscal_document_charges (
  document_id uuid NOT NULL,
  charge_id uuid NOT NULL,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  ativo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (document_id, charge_id),
  FOREIGN KEY (clinic_id, document_id) REFERENCES fiscal_documents (clinic_id, id) ON DELETE CASCADE,
  FOREIGN KEY (clinic_id, charge_id) REFERENCES charges (clinic_id, id)
);
CREATE UNIQUE INDEX fiscal_one_active_doc_per_charge ON fiscal_document_charges (charge_id) WHERE ativo;

-- ---------------------------------------------------------------- triggers

CREATE TRIGGER fiscal_issuers_updated BEFORE UPDATE ON fiscal_issuers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fiscal_documents_updated BEFORE UPDATE ON fiscal_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER fiscal_issuers_clinic_fixed BEFORE UPDATE ON fiscal_issuers FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();
CREATE TRIGGER fiscal_documents_clinic_fixed BEFORE UPDATE ON fiscal_documents FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();

-- Rascunho edita livremente; emitida só pode ser cancelada (nada mais muda); cancelada não muda.
-- Emitir e cancelar valem só para o próprio profissional emissor (o certificado e a nota são dele).
CREATE FUNCTION fiscal_documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'cancelada' THEN
    RAISE EXCEPTION 'Nota cancelada não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'emitida' AND NEW.status = 'emitida' THEN
    RAISE EXCEPTION 'Nota emitida não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'rascunho' AND NEW.status = 'cancelada' THEN
    RAISE EXCEPTION 'Rascunho não se cancela: descarte-o' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (SELECT 1 FROM fiscal_issuers i WHERE i.id = NEW.issuer_id AND i.professional_id = app_user()) THEN
      RAISE EXCEPTION 'Só o profissional emissor registra ou cancela a nota' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF OLD.status = 'emitida' AND NEW.status = 'cancelada' THEN
    IF (NEW.issuer_id, NEW.origem, NEW.tomador, NEW.servico, NEW.tributos, NEW.valor_centavos, NEW.competencia, NEW.data_emissao,
        NEW.chave_acesso, NEW.numero_nfse, NEW.emitida_em, NEW.xml_nfse, NEW.content_hash)
       IS DISTINCT FROM
       (OLD.issuer_id, OLD.origem, OLD.tomador, OLD.servico, OLD.tributos, OLD.valor_centavos, OLD.competencia, OLD.data_emissao,
        OLD.chave_acesso, OLD.numero_nfse, OLD.emitida_em, OLD.xml_nfse, OLD.content_hash) THEN
      RAISE EXCEPTION 'Ao cancelar, os dados da nota não podem mudar' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_documents_guard BEFORE UPDATE ON fiscal_documents FOR EACH ROW EXECUTE FUNCTION fiscal_documents_guard();
REVOKE ALL ON FUNCTION fiscal_documents_guard() FROM PUBLIC;

-- Só rascunho se descarta.
CREATE FUNCTION fiscal_documents_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Só rascunho pode ser descartado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER fiscal_documents_no_delete BEFORE DELETE ON fiscal_documents FOR EACH ROW EXECUTE FUNCTION fiscal_documents_no_delete();
REVOKE ALL ON FUNCTION fiscal_documents_no_delete() FROM PUBLIC;

-- Cancelar a nota libera as cobranças para uma nova nota.
CREATE FUNCTION fiscal_documents_release_charges() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE fiscal_document_charges SET ativo = false WHERE document_id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER fiscal_documents_release_charges AFTER UPDATE OF status ON fiscal_documents
  FOR EACH ROW WHEN (NEW.status = 'cancelada' AND OLD.status IS DISTINCT FROM 'cancelada') EXECUTE FUNCTION fiscal_documents_release_charges();
REVOKE ALL ON FUNCTION fiscal_documents_release_charges() FROM PUBLIC;

-- A nota é do profissional que prestou o serviço: a cobrança precisa ser dele e estar ativa.
CREATE FUNCTION fiscal_links_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ch charges%ROWTYPE;
  iss fiscal_issuers%ROWTYPE;
BEGIN
  SELECT * INTO ch FROM charges WHERE id = NEW.charge_id;
  SELECT i.* INTO iss FROM fiscal_issuers i JOIN fiscal_documents d ON d.issuer_id = i.id WHERE d.id = NEW.document_id;
  IF ch.status = 'cancelada' THEN
    RAISE EXCEPTION 'Cobrança cancelada não entra em nota fiscal' USING ERRCODE = 'check_violation';
  END IF;
  IF iss.tipo = 'profissional' AND ch.professional_id IS DISTINCT FROM iss.professional_id THEN
    RAISE EXCEPTION 'A cobrança é de outro profissional: a nota deve sair no CNPJ de quem prestou o serviço' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_links_check BEFORE INSERT ON fiscal_document_charges FOR EACH ROW EXECUTE FUNCTION fiscal_links_check();
REVOKE ALL ON FUNCTION fiscal_links_check() FROM PUBLIC;

-- ---------------------------------------------------------------- RLS

ALTER TABLE fiscal_issuers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_document_charges ENABLE ROW LEVEL SECURITY;

-- Emissor: administração e recepção leem (para escolher ao montar a nota); só o próprio profissional cria e edita.
CREATE POLICY fiscal_issuers_select ON fiscal_issuers FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()));
CREATE POLICY fiscal_issuers_insert ON fiscal_issuers FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND created_by = app_user() AND tipo = 'profissional' AND professional_id = app_user()
    AND app_role() IN ('admin', 'psicologo'));
CREATE POLICY fiscal_issuers_update ON fiscal_issuers FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic() AND professional_id = app_user() AND app_role() IN ('admin', 'psicologo'))
  WITH CHECK (clinic_id = app_clinic() AND professional_id = app_user() AND app_role() IN ('admin', 'psicologo'));

CREATE POLICY fiscal_documents_select ON fiscal_documents FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao')
    OR EXISTS (SELECT 1 FROM fiscal_issuers i WHERE i.id = fiscal_documents.issuer_id AND i.professional_id = app_user())));
CREATE POLICY fiscal_documents_insert ON fiscal_documents FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND created_by = app_user() AND status = 'rascunho' AND (app_role() IN ('admin', 'recepcao')
    OR EXISTS (SELECT 1 FROM fiscal_issuers i WHERE i.id = fiscal_documents.issuer_id AND i.professional_id = app_user())));
CREATE POLICY fiscal_documents_update ON fiscal_documents FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao')
    OR EXISTS (SELECT 1 FROM fiscal_issuers i WHERE i.id = fiscal_documents.issuer_id AND i.professional_id = app_user())))
  WITH CHECK (clinic_id = app_clinic());
CREATE POLICY fiscal_documents_delete ON fiscal_documents FOR DELETE TO app_runtime
  USING (clinic_id = app_clinic() AND status = 'rascunho' AND (app_role() IN ('admin', 'recepcao')
    OR EXISTS (SELECT 1 FROM fiscal_issuers i WHERE i.id = fiscal_documents.issuer_id AND i.professional_id = app_user())));

CREATE POLICY fiscal_links_select ON fiscal_document_charges FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND EXISTS (SELECT 1 FROM fiscal_documents d WHERE d.id = fiscal_document_charges.document_id));
CREATE POLICY fiscal_links_insert ON fiscal_document_charges FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND EXISTS (SELECT 1 FROM fiscal_documents d WHERE d.id = fiscal_document_charges.document_id AND d.status = 'rascunho'));

-- ---------------------------------------------------------------- privilégios

GRANT SELECT, INSERT, UPDATE ON fiscal_issuers TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_documents TO app_runtime;
GRANT SELECT, INSERT ON fiscal_document_charges TO app_runtime;
