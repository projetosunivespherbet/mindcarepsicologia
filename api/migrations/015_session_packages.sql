-- Pacote de sessões: o paciente paga N sessões de uma vez (uma cobrança) e cada sessão realizada desconta do saldo.
-- Falta só desconta se o profissional escolher. Sessão do pacote não gera cobrança avulsa.

ALTER TABLE charges DROP CONSTRAINT charges_origem_check;
ALTER TABLE charges ADD CONSTRAINT charges_origem_check CHECK (origem IN ('manual', 'sessao', 'migracao', 'pacote'));

CREATE TABLE session_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id),
  patient_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  sessoes int NOT NULL CHECK (sessoes BETWEEN 1 AND 100),
  valor_centavos int NOT NULL CHECK (valor_centavos > 0),
  charge_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'encerrado')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id),
  FOREIGN KEY (clinic_id, charge_id) REFERENCES charges (clinic_id, id)
);
CREATE INDEX session_packages_patient_idx ON session_packages (clinic_id, patient_id);

ALTER TABLE appointments ADD COLUMN package_id uuid;
ALTER TABLE appointments ADD CONSTRAINT appointments_package_fk FOREIGN KEY (clinic_id, package_id) REFERENCES session_packages (clinic_id, id);
CREATE INDEX appointments_package_idx ON appointments (package_id) WHERE package_id IS NOT NULL;

CREATE TRIGGER session_packages_updated BEFORE UPDATE ON session_packages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER session_packages_clinic_fixed BEFORE UPDATE ON session_packages FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();
CREATE TRIGGER session_packages_history AFTER INSERT OR UPDATE OR DELETE ON session_packages FOR EACH ROW EXECUTE FUNCTION change_log_row();

ALTER TABLE session_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_packages_select ON session_packages FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()));
CREATE POLICY session_packages_insert ON session_packages FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND created_by = app_user()
    AND (app_role() IN ('admin', 'recepcao') OR (app_role() = 'psicologo' AND professional_id = app_user())));
CREATE POLICY session_packages_update ON session_packages FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()))
  WITH CHECK (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()));

GRANT SELECT, INSERT ON session_packages TO app_runtime;
GRANT UPDATE (status) ON session_packages TO app_runtime;
