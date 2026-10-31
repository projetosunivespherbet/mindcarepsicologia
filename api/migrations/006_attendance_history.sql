-- 1) Tipo de atendimento: particular (padrão), convênio ou pro bono.
--    Particular exige valor; pro bono não pode ter valor nem cobrança. Quem não quer cobrar precisa dizer isso
--    de forma explícita, e a escolha fica registrada no histórico.
-- 2) Histórico de alterações: o banco grava quem mudou o quê, com o valor antigo e o novo, e ninguém altera ou
--    apaga esse histórico pelo aplicativo.

-- ---------------------------------------------------------------- tipo de atendimento

ALTER TABLE appointments ADD COLUMN atendimento text NOT NULL DEFAULT 'particular'
  CHECK (atendimento IN ('particular', 'convenio', 'pro_bono'));

-- Sessões antigas marcadas como convênio. Sem mexer em updated_at: não foi uma edição de ninguém.
ALTER TABLE appointments DISABLE TRIGGER appointments_updated;
UPDATE appointments SET atendimento = 'convenio' WHERE convenio;
ALTER TABLE appointments ENABLE TRIGGER appointments_updated;

ALTER TABLE appointments ADD CONSTRAINT appointments_atendimento_convenio CHECK ((atendimento = 'convenio') = convenio);

CREATE FUNCTION appointments_realizado_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'realizado' THEN
    IF NEW.atendimento = 'pro_bono' THEN
      IF COALESCE(NEW.valor, 0) > 0 THEN
        RAISE EXCEPTION 'Atendimento pro bono não tem valor: remova o valor ou mude o tipo de atendimento' USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM charges c WHERE c.appointment_id = NEW.id AND c.status <> 'cancelada') THEN
        RAISE EXCEPTION 'Esta sessão já tem cobrança: cancele a cobrança antes de marcá-la como pro bono' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.atendimento = 'particular' THEN
      IF COALESCE(NEW.valor, 0) <= 0 AND NOT EXISTS (
           SELECT 1 FROM services sv
            WHERE sv.clinic_id = NEW.clinic_id AND sv.ativo AND (sv.professional_id = NEW.professional_id OR sv.professional_id IS NULL)) THEN
        RAISE EXCEPTION 'Atendimento particular precisa de valor (ou de um serviço cadastrado). Se não haverá cobrança, marque como pro bono' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_realizado_check BEFORE INSERT OR UPDATE OF status, atendimento, valor ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_realizado_check();
REVOKE ALL ON FUNCTION appointments_realizado_check() FROM PUBLIC;

-- ---------------------------------------------------------------- histórico de alterações

CREATE TABLE change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  user_id uuid,             -- quem fez; nulo quando a mudança não veio do aplicativo (migration, console do banco)
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changes jsonb NOT NULL,   -- INSERT/DELETE: valores da linha; UPDATE: {campo: {de, para}}
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_log_row_idx ON change_log (clinic_id, table_name, row_id, at);
CREATE INDEX change_log_at_idx ON change_log (clinic_id, at DESC);

-- Registra INSERT, UPDATE e DELETE. Colunas listadas em TG_ARGV[0] são dados pessoais: o histórico guarda
-- que mudaram, não o conteúdo (evita copiar dados sensíveis para uma segunda tabela).
CREATE FUNCTION change_log_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  oldj jsonb;
  newj jsonb;
  base jsonb;
  ch jsonb := '{}'::jsonb;
  k text;
  skip text[] := ARRAY['created_at', 'updated_at'];
  mask text[] := string_to_array(COALESCE(TG_ARGV[0], ''), ',');
BEGIN
  IF TG_OP <> 'INSERT' THEN oldj := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN newj := to_jsonb(NEW); END IF;
  base := COALESCE(newj, oldj);

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(newj) LOOP
      CONTINUE WHEN k = ANY(skip);
      IF newj -> k IS DISTINCT FROM oldj -> k THEN
        ch := ch || jsonb_build_object(k, CASE WHEN k = ANY(mask)
                                               THEN jsonb_build_object('alterado', true)
                                               ELSE jsonb_build_object('de', oldj -> k, 'para', newj -> k) END);
      END IF;
    END LOOP;
    IF ch = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSE
    ch := base - skip;
    FOREACH k IN ARRAY mask LOOP
      IF k <> '' AND ch ? k AND ch -> k <> 'null'::jsonb THEN ch := jsonb_set(ch, ARRAY[k], '"[omitido]"'::jsonb); END IF;
    END LOOP;
  END IF;

  INSERT INTO change_log (clinic_id, user_id, table_name, row_id, action, changes)
  VALUES ((base ->> 'clinic_id')::uuid, app_user(), TG_TABLE_NAME, (base ->> 'id')::uuid, TG_OP, ch);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION change_log_row() FROM PUBLIC;

CREATE TRIGGER appointments_history AFTER INSERT OR UPDATE OR DELETE ON appointments FOR EACH ROW EXECUTE FUNCTION change_log_row();
CREATE TRIGGER charges_history AFTER INSERT OR UPDATE OR DELETE ON charges FOR EACH ROW EXECUTE FUNCTION change_log_row();
CREATE TRIGGER services_history AFTER INSERT OR UPDATE OR DELETE ON services FOR EACH ROW EXECUTE FUNCTION change_log_row();
CREATE TRIGGER fiscal_issuers_history AFTER INSERT OR UPDATE OR DELETE ON fiscal_issuers FOR EACH ROW EXECUTE FUNCTION change_log_row();
CREATE TRIGGER fiscal_documents_history AFTER INSERT OR UPDATE OR DELETE ON fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION change_log_row('tomador,xml_nfse');
CREATE TRIGGER payers_history AFTER INSERT OR UPDATE OR DELETE ON payers
  FOR EACH ROW EXECUTE FUNCTION change_log_row('nome,cpf_cnpj,email,telefone');
CREATE TRIGGER patients_history AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION change_log_row('nome,cpf,data_nascimento,telefone,email,genero,estado_civil,profissao');

-- Imutável: nem UPDATE, nem DELETE, nem TRUNCATE (nem para o dono do banco, a menos que desligue o trigger de propósito).
CREATE FUNCTION change_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de alterações não pode ser alterado nem apagado' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER change_log_immutable BEFORE UPDATE OR DELETE ON change_log FOR EACH ROW EXECUTE FUNCTION change_log_immutable();
CREATE TRIGGER change_log_no_truncate BEFORE TRUNCATE ON change_log FOR EACH STATEMENT EXECUTE FUNCTION change_log_immutable();
REVOKE ALL ON FUNCTION change_log_immutable() FROM PUBLIC;

-- Só a administração lê; ninguém escreve pelo aplicativo (os triggers gravam como dono).
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY change_log_select ON change_log FOR SELECT TO app_runtime USING (clinic_id = app_clinic() AND app_role() = 'admin');
GRANT SELECT ON change_log TO app_runtime;
