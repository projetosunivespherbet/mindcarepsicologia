-- Plano terapêutico (metas + avanço por sessão) e escalas de rastreio (PHQ-9, GAD-7).
-- Dado clínico: só o psicólogo que registrou (ou administração que atende, nos próprios registros) lê e grava.
-- Nada é apagado: metas mudam de situação; avanços e aplicações de escala são imutáveis.

CREATE TABLE therapy_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id),
  patient_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 2 AND 200),
  descricao text CHECK (descricao IS NULL OR length(descricao) <= 2000),
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'alcancada', 'suspensa')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id)
);
CREATE INDEX therapy_goals_patient_idx ON therapy_goals (clinic_id, patient_id);

CREATE TABLE goal_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id),
  goal_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  appointment_id uuid,
  nota int NOT NULL CHECK (nota BETWEEN 0 AND 10),
  comentario text CHECK (comentario IS NULL OR length(comentario) <= 500),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, goal_id) REFERENCES therapy_goals (clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments (clinic_id, id)
);
CREATE INDEX goal_progress_goal_idx ON goal_progress (goal_id, created_at);

CREATE TABLE scale_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics (id),
  patient_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  appointment_id uuid,
  escala text NOT NULL CHECK (escala IN ('phq9', 'gad7')),
  respostas int[] NOT NULL,
  pontuacao int NOT NULL CHECK (pontuacao >= 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((escala = 'phq9' AND cardinality(respostas) = 9) OR (escala = 'gad7' AND cardinality(respostas) = 7)),
  CHECK (0 <= ALL (respostas) AND 3 >= ALL (respostas)),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments (clinic_id, id)
);
CREATE INDEX scale_applications_patient_idx ON scale_applications (clinic_id, patient_id, created_at);

CREATE TRIGGER therapy_goals_updated BEFORE UPDATE ON therapy_goals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER therapy_goals_clinic_fixed BEFORE UPDATE ON therapy_goals FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();

ALTER TABLE therapy_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE scale_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY therapy_goals_all ON therapy_goals FOR ALL TO app_runtime
  USING (clinic_id = app_clinic() AND professional_id = app_user() AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende())))
  WITH CHECK (clinic_id = app_clinic() AND professional_id = app_user() AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende())));
CREATE POLICY goal_progress_all ON goal_progress FOR ALL TO app_runtime
  USING (clinic_id = app_clinic() AND professional_id = app_user() AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende())))
  WITH CHECK (clinic_id = app_clinic() AND professional_id = app_user() AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende()))
    AND EXISTS (SELECT 1 FROM therapy_goals g WHERE g.id = goal_id AND g.professional_id = app_user()));
CREATE POLICY scale_applications_all ON scale_applications FOR ALL TO app_runtime
  USING (clinic_id = app_clinic() AND professional_id = app_user() AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende())))
  WITH CHECK (clinic_id = app_clinic() AND professional_id = app_user() AND (app_role() = 'psicologo' OR (app_role() = 'admin' AND app_atende())));

GRANT SELECT, INSERT ON therapy_goals, goal_progress, scale_applications TO app_runtime;
GRANT UPDATE (titulo, descricao, status) ON therapy_goals TO app_runtime;
