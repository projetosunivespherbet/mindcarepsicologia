-- MindCare API — schema multi-tenant (Neon / PostgreSQL 15+)
-- Aplique com o papel DONO do banco. A API conecta com um papel membro de app_runtime,
-- que não é dono das tabelas e por isso fica sujeito às policies de RLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------- tabelas

CREATE TABLE clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 160),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 160),
  email text,
  role text NOT NULL CHECK (role IN ('admin', 'psicologo', 'recepcao')),
  crp text,
  atende boolean NOT NULL DEFAULT false,
  telefone text,
  status text NOT NULL DEFAULT 'convidado' CHECK (status IN ('convidado', 'ativo', 'inativo')),
  password_hash text,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  CHECK (NOT atende OR crp IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('convite', 'redefinicao')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, user_id) REFERENCES users (clinic_id, id)
);

CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 160),
  data_nascimento date,
  telefone text,
  email text,
  genero text,
  estado_civil text,
  profissao text,
  professional_id uuid,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id)
);
CREATE INDEX patients_clinic_idx ON patients (clinic_id, nome);

-- Dados clínicos ficam separados: só o psicólogo responsável (e o admin que atende) enxergam.
CREATE TABLE patient_anamnesis (
  patient_id uuid PRIMARY KEY,
  clinic_id uuid NOT NULL,
  queixa_principal text,
  historico_familiar text,
  medicamentos text,
  tratamentos_anteriores text,
  expectativas text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id)
);

CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  tipo text NOT NULL DEFAULT 'individual' CHECK (tipo IN ('individual', 'grupo')),
  status text NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado', 'confirmado', 'realizado', 'faltou', 'cancelado')),
  valor numeric(10, 2) CHECK (valor IS NULL OR valor >= 0),
  payment_status text NOT NULL DEFAULT 'pendente' CHECK (payment_status IN ('pendente', 'pago', 'nao_pago')),
  convenio boolean NOT NULL DEFAULT false,
  imposto boolean NOT NULL DEFAULT false,
  series_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id)
);
CREATE INDEX appointments_prof_idx ON appointments (clinic_id, professional_id, starts_at);
CREATE INDEX appointments_time_idx ON appointments (clinic_id, starts_at);
CREATE INDEX appointments_patient_idx ON appointments (patient_id);

CREATE TABLE time_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  motivo text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id)
);
CREATE INDEX time_blocks_prof_idx ON time_blocks (clinic_id, professional_id, starts_at);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_idx ON audit_log (clinic_id, at DESC);

-- ---------------------------------------------------------------- helpers de sessão

CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_clinic() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.clinic_id', true), '')::uuid $$;

CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.role', true), '') $$;

CREATE FUNCTION app_atende() RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT coalesce(current_setting('app.atende', true), '') = 'true' $$;

-- ---------------------------------------------------------------- triggers

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER patients_updated BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER appointments_updated BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER anamnesis_updated BEFORE UPDATE ON patient_anamnesis FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE FUNCTION forbid_clinic_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id THEN
    RAISE EXCEPTION 'A clínica de um registro não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER users_clinic_fixed BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();
CREATE TRIGGER patients_clinic_fixed BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();
CREATE TRIGGER appointments_clinic_fixed BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();

-- A clínica nunca pode ficar sem um administrador ativo.
CREATE FUNCTION keep_one_admin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.status = 'ativo' AND (NEW.role <> 'admin' OR NEW.status <> 'ativo') THEN
    IF NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.clinic_id = OLD.clinic_id AND u.id <> OLD.id AND u.role = 'admin' AND u.status = 'ativo'
    ) THEN
      RAISE EXCEPTION 'A clínica precisa ter ao menos um administrador ativo' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_keep_admin BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION keep_one_admin();

-- Regras de agenda: horário válido, profissional que atende, sem conflito e sem bloqueio.
-- Sessões de grupo podem se sobrepor entre si; individual não sobrepõe nada.
CREATE FUNCTION check_appointment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  tz text;
  quando text;
BEGIN
  IF NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'Horário inválido: o início deve ser antes do fim' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'cancelado' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = NEW.professional_id AND u.clinic_id = NEW.clinic_id AND u.atende AND u.status <> 'inativo'
  ) THEN
    RAISE EXCEPTION 'O profissional informado não atende nesta clínica' USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.timezone INTO tz FROM clinics c WHERE c.id = NEW.clinic_id;
  quando := to_char(NEW.starts_at AT TIME ZONE tz, 'DD/MM/YYYY HH24:MI');

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.professional_id::text, 0));

  IF EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.professional_id = NEW.professional_id AND a.id <> NEW.id AND a.status <> 'cancelado'
      AND a.starts_at < NEW.ends_at AND a.ends_at > NEW.starts_at
      AND NOT (a.tipo = 'grupo' AND NEW.tipo = 'grupo')
  ) THEN
    RAISE EXCEPTION 'Conflito de agenda em %', quando USING ERRCODE = 'exclusion_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM time_blocks b
    WHERE b.professional_id = NEW.professional_id AND b.starts_at < NEW.ends_at AND b.ends_at > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'Horário bloqueado pelo profissional em %', quando USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END $$;
CREATE TRIGGER appointments_check BEFORE INSERT OR UPDATE OF starts_at, ends_at, professional_id, tipo, status
  ON appointments FOR EACH ROW EXECUTE FUNCTION check_appointment();

-- ---------------------------------------------------------------- RLS

ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_anamnesis ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinics_select ON clinics FOR SELECT TO app_runtime USING (id = app_clinic());
CREATE POLICY clinics_update ON clinics FOR UPDATE TO app_runtime
  USING (id = app_clinic() AND app_role() = 'admin') WITH CHECK (id = app_clinic());

CREATE POLICY users_select ON users FOR SELECT TO app_runtime USING (clinic_id = app_clinic());
CREATE POLICY users_insert ON users FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND app_role() = 'admin');
CREATE POLICY users_update ON users FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic() AND app_role() = 'admin') WITH CHECK (clinic_id = app_clinic());

CREATE POLICY invites_all ON invites FOR ALL TO app_runtime
  USING (clinic_id = app_clinic() AND app_role() = 'admin')
  WITH CHECK (clinic_id = app_clinic() AND app_role() = 'admin');

CREATE POLICY patients_select ON patients FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic()
    AND (app_role() IN ('admin', 'recepcao') OR professional_id IS NULL OR professional_id = app_user()));
CREATE POLICY patients_insert ON patients FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic()
    AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()));
CREATE POLICY patients_update ON patients FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic()
    AND (app_role() IN ('admin', 'recepcao') OR professional_id IS NULL OR professional_id = app_user()))
  WITH CHECK (clinic_id = app_clinic()
    AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()));

CREATE POLICY anamnesis_all ON patient_anamnesis FOR ALL TO app_runtime
  USING (clinic_id = app_clinic() AND (
    (app_role() = 'psicologo' AND EXISTS (
      SELECT 1 FROM patients p WHERE p.id = patient_id AND p.professional_id = app_user()))
    OR (app_role() = 'admin' AND app_atende())))
  WITH CHECK (clinic_id = app_clinic() AND (
    (app_role() = 'psicologo' AND EXISTS (
      SELECT 1 FROM patients p WHERE p.id = patient_id AND p.professional_id = app_user()))
    OR (app_role() = 'admin' AND app_atende())));

CREATE POLICY appointments_all ON appointments FOR ALL TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()))
  WITH CHECK (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()));

CREATE POLICY time_blocks_all ON time_blocks FOR ALL TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()))
  WITH CHECK (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()));

CREATE POLICY audit_insert ON audit_log FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND user_id = app_user());
CREATE POLICY audit_select ON audit_log FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND app_role() = 'admin');

-- ---------------------------------------------------------------- privilégios

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT ON clinics TO app_runtime;
GRANT UPDATE (nome, timezone) ON clinics TO app_runtime;
-- password_hash e contadores de bloqueio nunca são legíveis pela API diretamente.
GRANT SELECT (id, clinic_id, nome, email, role, crp, atende, telefone, status, last_login_at, created_at, updated_at)
  ON users TO app_runtime;
GRANT INSERT (clinic_id, nome, email, role, crp, atende, telefone, status) ON users TO app_runtime;
GRANT UPDATE (nome, email, role, crp, atende, telefone, status) ON users TO app_runtime;
GRANT SELECT, INSERT ON invites TO app_runtime;
GRANT UPDATE (revoked_at) ON invites TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON patients, patient_anamnesis, appointments TO app_runtime;
GRANT SELECT, INSERT, DELETE ON time_blocks TO app_runtime;
GRANT SELECT, INSERT ON audit_log TO app_runtime;

-- ---------------------------------------------------------------- funções de acesso (antes do login)

CREATE FUNCTION app_login_lookup(p_email text)
RETURNS TABLE (id uuid, clinic_id uuid, role text, atende boolean, nome text, status text,
               password_hash text, locked_until timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.clinic_id, u.role, u.atende, u.nome, u.status, u.password_hash, u.locked_until
  FROM users u WHERE lower(u.email) = lower(p_email)
$$;

CREATE FUNCTION app_login_register(p_user uuid, p_ok boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE users SET
    failed_attempts = CASE WHEN p_ok OR failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
    locked_until = CASE WHEN p_ok THEN NULL
                        WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
                        ELSE locked_until END,
    last_login_at = CASE WHEN p_ok THEN now() ELSE last_login_at END
  WHERE id = p_user
$$;

CREATE FUNCTION app_session_check(p_user uuid)
RETURNS TABLE (clinic_id uuid, role text, atende boolean, status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.clinic_id, u.role, u.atende, u.status FROM users u WHERE u.id = p_user
$$;

CREATE FUNCTION app_invite_peek(p_token_hash text)
RETURNS TABLE (kind text, nome text, role text, email text, clinic_nome text, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.kind, u.nome, u.role, u.email, c.nome, i.expires_at
  FROM invites i
  JOIN users u ON u.id = i.user_id
  JOIN clinics c ON c.id = i.clinic_id
  WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.revoked_at IS NULL
    AND i.expires_at > now() AND u.status <> 'inativo'
$$;

CREATE FUNCTION app_invite_accept(p_token_hash text, p_email text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  inv invites%ROWTYPE;
  usr users%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM invites
  WHERE token_hash = p_token_hash AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite inválido ou expirado' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO usr FROM users WHERE id = inv.user_id FOR UPDATE;
  IF usr.status = 'inativo' THEN
    RAISE EXCEPTION 'Convite inválido ou expirado' USING ERRCODE = 'no_data_found';
  END IF;

  IF inv.kind = 'convite' THEN
    IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
      RAISE EXCEPTION 'Informe o e-mail para concluir o cadastro' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE users SET email = lower(trim(p_email)), password_hash = p_password_hash, status = 'ativo'
    WHERE id = usr.id;
  ELSE
    UPDATE users SET password_hash = p_password_hash, failed_attempts = 0, locked_until = NULL,
                     status = CASE WHEN status = 'convidado' THEN 'ativo' ELSE status END
    WHERE id = usr.id;
  END IF;

  UPDATE invites SET used_at = now() WHERE id = inv.id;
  UPDATE invites SET revoked_at = now() WHERE user_id = usr.id AND used_at IS NULL AND revoked_at IS NULL;
  RETURN usr.id;
END $$;

CREATE FUNCTION app_get_password_hash(p_user uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT password_hash FROM users WHERE id = p_user AND p_user = app_user()
$$;

CREATE FUNCTION app_set_password(p_user uuid, p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_user IS DISTINCT FROM app_user() THEN
    RAISE EXCEPTION 'Operação não permitida' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE users SET password_hash = p_hash WHERE id = p_user;
END $$;

-- Usada só pelo operador da plataforma (rota protegida por SETUP_TOKEN).
CREATE FUNCTION app_create_clinic(p_clinic_nome text, p_admin_nome text, p_email text, p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cid uuid;
BEGIN
  INSERT INTO clinics (nome) VALUES (p_clinic_nome) RETURNING id INTO cid;
  INSERT INTO users (clinic_id, nome, email, role, status, password_hash)
  VALUES (cid, p_admin_nome, lower(trim(p_email)), 'admin', 'ativo', p_hash);
  RETURN cid;
END $$;

REVOKE ALL ON FUNCTION app_login_lookup(text), app_login_register(uuid, boolean), app_session_check(uuid),
  app_invite_peek(text), app_invite_accept(text, text, text), app_get_password_hash(uuid),
  app_set_password(uuid, text), app_create_clinic(text, text, text, text),
  check_appointment(), keep_one_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_login_lookup(text), app_login_register(uuid, boolean), app_session_check(uuid),
  app_invite_peek(text), app_invite_accept(text, text, text), app_get_password_hash(uuid),
  app_set_password(uuid, text), app_create_clinic(text, text, text, text),
  app_user(), app_clinic(), app_role(), app_atende() TO app_runtime;
