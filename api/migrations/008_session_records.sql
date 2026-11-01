-- Prontuário (registro) da sessão: um texto por sessão, escrito pelo psicólogo responsável.
-- Dado clínico sensível: só o próprio profissional da sessão (psicólogo, ou administrador que atende) lê e grava.
-- Administração sem atendimento e recepção nunca acessam o conteúdo. Não há exclusão física (sem DELETE).

CREATE TABLE session_records (
  appointment_id uuid PRIMARY KEY REFERENCES appointments (id),
  clinic_id uuid NOT NULL REFERENCES clinics (id),
  patient_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  conteudo text NOT NULL CHECK (length(btrim(conteudo)) BETWEEN 1 AND 20000),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id)
);
CREATE INDEX session_records_prof_idx ON session_records (clinic_id, professional_id);

CREATE TRIGGER session_records_updated BEFORE UPDATE ON session_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER session_records_clinic_fixed BEFORE UPDATE ON session_records FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();

ALTER TABLE session_records ENABLE ROW LEVEL SECURITY;

-- O registro pertence ao profissional da sessão; paciente e profissional precisam coincidir com a sessão.
CREATE POLICY session_records_all ON session_records FOR ALL TO app_runtime
  USING (clinic_id = app_clinic() AND professional_id = app_user()
    AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende())))
  WITH CHECK (clinic_id = app_clinic() AND professional_id = app_user()
    AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende()))
    AND EXISTS (SELECT 1 FROM appointments a
                WHERE a.id = appointment_id AND a.professional_id = session_records.professional_id AND a.patient_id = session_records.patient_id));

GRANT SELECT, INSERT ON session_records TO app_runtime;
GRANT UPDATE (conteudo, updated_by) ON session_records TO app_runtime;
