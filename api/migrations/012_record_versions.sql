-- Trilha dos registros clínicos: cada gravação do prontuário/anotações privativas guarda uma versão imutável.
-- Só o psicólogo da sessão lê; ninguém (nem o aplicativo) altera ou apaga versões.

CREATE TABLE session_record_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments (id),
  clinic_id uuid NOT NULL REFERENCES clinics (id),
  professional_id uuid NOT NULL,
  conteudo text NOT NULL,
  anotacoes text NOT NULL,
  saved_by uuid NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_record_versions_idx ON session_record_versions (appointment_id, saved_at);

ALTER TABLE session_record_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_record_versions_select ON session_record_versions FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND professional_id = app_user()
    AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende())));
GRANT SELECT ON session_record_versions TO app_runtime;

CREATE FUNCTION record_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO session_record_versions (appointment_id, clinic_id, professional_id, conteudo, anotacoes, saved_by)
  VALUES (NEW.appointment_id, NEW.clinic_id, NEW.professional_id, NEW.conteudo, NEW.anotacoes, NEW.updated_by);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION record_version() FROM PUBLIC;

CREATE TRIGGER session_records_version AFTER INSERT OR UPDATE ON session_records FOR EACH ROW EXECUTE FUNCTION record_version();

-- registros já existentes entram como primeira versão
INSERT INTO session_record_versions (appointment_id, clinic_id, professional_id, conteudo, anotacoes, saved_by, saved_at)
  SELECT appointment_id, clinic_id, professional_id, conteudo, anotacoes, updated_by, updated_at FROM session_records;
