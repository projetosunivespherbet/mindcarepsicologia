-- Núcleo financeiro (fase 1): catálogo de serviços, responsáveis financeiros, cobranças e pagamentos.
-- Princípios: dinheiro em centavos (int); pagamento imutável (erro se corrige com estorno);
-- status e saldo da cobrança calculados por trigger a partir dos pagamentos.

-- Permite FK composta (clinic_id, appointment_id) a partir de charges.
ALTER TABLE appointments ADD CONSTRAINT appointments_clinic_id_uq UNIQUE (clinic_id, id);

-- ---------------------------------------------------------------- tabelas

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 80),
  valor_centavos int NOT NULL CHECK (valor_centavos BETWEEN 1 AND 10000000),
  duracao_min int CHECK (duracao_min IS NULL OR duracao_min BETWEEN 10 AND 480),
  professional_id uuid, -- nulo = vale para todos os profissionais
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id)
);

CREATE TABLE payers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 160),
  cpf_cnpj text CHECK (cpf_cnpj IS NULL OR length(cpf_cnpj) IN (11, 14)),
  email text,
  telefone text,
  vinculo text CHECK (vinculo IS NULL OR length(vinculo) <= 60),
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, created_by) REFERENCES users (clinic_id, id)
);

CREATE TABLE charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL,
  professional_id uuid NOT NULL,
  payer_id uuid, -- nulo = o próprio paciente
  appointment_id uuid,
  descricao text NOT NULL DEFAULT 'Atendimento psicológico' CHECK (length(descricao) BETWEEN 2 AND 200),
  competencia date NOT NULL CHECK (extract(day FROM competencia) = 1),
  valor_centavos int NOT NULL CHECK (valor_centavos BETWEEN 1 AND 10000000),
  desconto_centavos int NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  liquido_centavos int GENERATED ALWAYS AS (valor_centavos - desconto_centavos) STORED,
  paid_centavos int NOT NULL DEFAULT 0 CHECK (paid_centavos >= 0), -- só os triggers de pagamento alteram
  vencimento date,
  forma_prevista text CHECK (forma_prevista IS NULL OR forma_prevista IN ('pix', 'dinheiro', 'cartao', 'transferencia', 'convenio')),
  convenio boolean NOT NULL DEFAULT false,
  imposto_recolhido boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'parcial', 'paga', 'cancelada')),
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'sessao', 'migracao')),
  cancel_reason text CHECK (cancel_reason IS NULL OR length(trim(cancel_reason)) >= 5),
  cancelled_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients (clinic_id, id),
  FOREIGN KEY (clinic_id, professional_id) REFERENCES users (clinic_id, id),
  FOREIGN KEY (clinic_id, payer_id) REFERENCES payers (clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointments (clinic_id, id),
  FOREIGN KEY (clinic_id, created_by) REFERENCES users (clinic_id, id),
  CHECK (desconto_centavos < valor_centavos),
  CHECK (paid_centavos <= valor_centavos - desconto_centavos),
  CHECK ((status = 'cancelada') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);

-- Uma sessão tem no máximo uma cobrança ativa.
CREATE UNIQUE INDEX charges_one_active_per_appointment ON charges (appointment_id)
  WHERE appointment_id IS NOT NULL AND status <> 'cancelada';
CREATE INDEX charges_competencia_idx ON charges (clinic_id, competencia);
CREATE INDEX charges_professional_idx ON charges (clinic_id, professional_id, competencia);
CREATE INDEX charges_patient_idx ON charges (patient_id);
CREATE INDEX charges_open_idx ON charges (clinic_id, vencimento) WHERE status IN ('aberta', 'parcial');

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  charge_id uuid NOT NULL,
  valor_centavos int NOT NULL CHECK (valor_centavos BETWEEN 1 AND 10000000),
  metodo text NOT NULL CHECK (metodo IN ('pix', 'dinheiro', 'cartao', 'transferencia', 'boleto', 'convenio', 'outro')),
  pago_em date NOT NULL,
  observacao text CHECK (observacao IS NULL OR length(observacao) <= 300),
  recebido_por text NOT NULL DEFAULT 'profissional' CHECK (recebido_por IN ('profissional', 'clinica')),
  registrado_por uuid NOT NULL,
  reverses_id uuid REFERENCES payments(id), -- preenchido nas linhas de estorno
  motivo_estorno text CHECK (motivo_estorno IS NULL OR length(trim(motivo_estorno)) >= 5),
  idempotency_key text CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, charge_id) REFERENCES charges (clinic_id, id),
  FOREIGN KEY (clinic_id, registrado_por) REFERENCES users (clinic_id, id),
  CHECK ((reverses_id IS NULL) = (motivo_estorno IS NULL))
);

CREATE UNIQUE INDEX payments_reverses_uq ON payments (reverses_id) WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX payments_idem_uq ON payments (clinic_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX payments_charge_idx ON payments (charge_id);
CREATE INDEX payments_date_idx ON payments (clinic_id, pago_em);

-- ---------------------------------------------------------------- triggers

CREATE TRIGGER services_updated BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payers_updated BEFORE UPDATE ON payers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER charges_updated BEFORE UPDATE ON charges FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER services_clinic_fixed BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();
CREATE TRIGGER payers_clinic_fixed BEFORE UPDATE ON payers FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();
CREATE TRIGGER charges_clinic_fixed BEFORE UPDATE ON charges FOR EACH ROW EXECUTE FUNCTION forbid_clinic_change();

-- Regras de alteração da cobrança. Atualizações vindas de outros triggers (pagamento, cancelamento de
-- sessão) têm pg_trigger_depth() > 1 e passam; as vindas direto da API só fazem o que está abaixo.
CREATE FUNCTION charges_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF OLD.status = 'cancelada' THEN
    RAISE EXCEPTION 'Cobrança cancelada não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'cancelada' AND OLD.paid_centavos = 0 THEN
      NEW.cancelled_at := now();
    ELSIF NEW.status = 'cancelada' THEN
      RAISE EXCEPTION 'Cobrança com pagamento ativo: estorne os pagamentos antes de cancelar' USING ERRCODE = 'check_violation';
    ELSE
      RAISE EXCEPTION 'O status da cobrança é calculado a partir dos pagamentos' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.paid_centavos IS DISTINCT FROM OLD.paid_centavos THEN
    RAISE EXCEPTION 'O valor pago é calculado a partir dos pagamentos' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.desconto_centavos IS DISTINCT FROM OLD.desconto_centavos AND OLD.paid_centavos > 0 THEN
    RAISE EXCEPTION 'Cobrança com pagamento: o desconto não pode mudar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER charges_guard BEFORE UPDATE ON charges FOR EACH ROW EXECUTE FUNCTION charges_guard();
REVOKE ALL ON FUNCTION charges_guard() FROM PUBLIC;

-- Pagamentos nunca são editados nem apagados.
CREATE FUNCTION payments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Pagamento não pode ser alterado nem apagado: registre um estorno' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_immutable();
REVOKE ALL ON FUNCTION payments_immutable() FROM PUBLIC;

-- Valida o pagamento sob trava da cobrança (dois pagamentos simultâneos não estouram o saldo).
CREATE FUNCTION payments_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c charges%ROWTYPE;
  orig payments%ROWTYPE;
BEGIN
  SELECT * INTO c FROM charges WHERE id = NEW.charge_id AND clinic_id = NEW.clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobrança não encontrada' USING ERRCODE = 'check_violation';
  END IF;
  IF c.status = 'cancelada' THEN
    RAISE EXCEPTION 'Cobrança cancelada não recebe pagamento' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses_id IS NULL THEN
    IF c.paid_centavos + NEW.valor_centavos > c.valor_centavos - c.desconto_centavos THEN
      RAISE EXCEPTION 'O pagamento excede o saldo da cobrança' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO orig FROM payments WHERE id = NEW.reverses_id;
    IF NOT FOUND OR orig.charge_id <> NEW.charge_id OR orig.reverses_id IS NOT NULL THEN
      RAISE EXCEPTION 'Pagamento a estornar inválido' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.valor_centavos <> orig.valor_centavos THEN
      RAISE EXCEPTION 'O estorno deve ter o mesmo valor do pagamento' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_check BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payments_check();
REVOKE ALL ON FUNCTION payments_check() FROM PUBLIC;

-- Recalcula valor pago e status da cobrança.
CREATE FUNCTION payments_apply() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  paid int;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN reverses_id IS NULL THEN valor_centavos ELSE -valor_centavos END), 0)
    INTO paid FROM payments WHERE charge_id = NEW.charge_id;
  UPDATE charges
     SET paid_centavos = paid,
         status = CASE WHEN paid = 0 THEN 'aberta' WHEN paid < valor_centavos - desconto_centavos THEN 'parcial' ELSE 'paga' END
   WHERE id = NEW.charge_id;
  RETURN NULL;
END $$;
CREATE TRIGGER payments_apply AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payments_apply();
REVOKE ALL ON FUNCTION payments_apply() FROM PUBLIC;

-- appointments.payment_status passa a ser derivado da cobrança (mantido por compatibilidade).
CREATE FUNCTION charges_sync_appointment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.appointment_id IS NOT NULL AND NEW.status IN ('aberta', 'parcial', 'paga') THEN
    UPDATE appointments
       SET payment_status = CASE NEW.status WHEN 'paga' THEN 'pago' ELSE 'pendente' END
     WHERE id = NEW.appointment_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER charges_sync_appointment AFTER UPDATE OF status ON charges
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION charges_sync_appointment();
REVOKE ALL ON FUNCTION charges_sync_appointment() FROM PUBLIC;

-- Sessão cancelada cancela a cobrança; se já houve pagamento, é preciso estornar antes.
CREATE FUNCTION appointments_cancel_charge() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ch charges%ROWTYPE;
BEGIN
  SELECT * INTO ch FROM charges WHERE appointment_id = NEW.id AND status <> 'cancelada' FOR UPDATE;
  IF FOUND THEN
    IF ch.paid_centavos > 0 THEN
      RAISE EXCEPTION 'Há pagamento registrado nesta sessão: estorne-o antes de cancelar a sessão' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE charges SET status = 'cancelada', cancel_reason = 'Sessão cancelada', cancelled_at = now() WHERE id = ch.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER appointments_cancel_charge AFTER UPDATE OF status ON appointments
  FOR EACH ROW WHEN (NEW.status = 'cancelado' AND OLD.status IS DISTINCT FROM 'cancelado') EXECUTE FUNCTION appointments_cancel_charge();
REVOKE ALL ON FUNCTION appointments_cancel_charge() FROM PUBLIC;

-- ---------------------------------------------------------------- RLS

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Catálogo: todos leem; administração edita tudo; psicólogo edita só os próprios preços.
CREATE POLICY services_select ON services FOR SELECT TO app_runtime USING (clinic_id = app_clinic());
CREATE POLICY services_insert ON services FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND (app_role() = 'admin' OR (app_role() = 'psicologo' AND professional_id = app_user())));
CREATE POLICY services_update ON services FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() = 'admin' OR (app_role() = 'psicologo' AND professional_id = app_user())))
  WITH CHECK (clinic_id = app_clinic() AND (app_role() = 'admin' OR (app_role() = 'psicologo' AND professional_id = app_user())));

-- Responsáveis: administração e recepção veem todos; psicólogo vê os que criou ou que usa nas próprias cobranças.
CREATE POLICY payers_select ON payers FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND (
    app_role() IN ('admin', 'recepcao') OR created_by = app_user()
    OR EXISTS (SELECT 1 FROM charges c WHERE c.payer_id = payers.id AND c.professional_id = app_user())));
CREATE POLICY payers_insert ON payers FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND created_by = app_user());
CREATE POLICY payers_update ON payers FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR created_by = app_user()))
  WITH CHECK (clinic_id = app_clinic());

CREATE POLICY charges_select ON charges FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()));
CREATE POLICY charges_insert ON charges FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND created_by = app_user()
    AND (app_role() IN ('admin', 'recepcao') OR (app_role() = 'psicologo' AND professional_id = app_user())));
CREATE POLICY charges_update ON charges FOR UPDATE TO app_runtime
  USING (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()))
  WITH CHECK (clinic_id = app_clinic() AND (app_role() IN ('admin', 'recepcao') OR professional_id = app_user()));

CREATE POLICY payments_select ON payments FOR SELECT TO app_runtime
  USING (clinic_id = app_clinic() AND (
    app_role() IN ('admin', 'recepcao')
    OR EXISTS (SELECT 1 FROM charges c WHERE c.id = payments.charge_id AND c.professional_id = app_user())));
-- Pagamento: administração, recepção e o psicólogo das próprias cobranças. Estorno: não vale para a recepção.
CREATE POLICY payments_insert ON payments FOR INSERT TO app_runtime
  WITH CHECK (clinic_id = app_clinic() AND registrado_por = app_user() AND (
    (app_role() IN ('admin', 'recepcao') AND reverses_id IS NULL)
    OR app_role() = 'admin'
    OR (app_role() = 'psicologo'
        AND EXISTS (SELECT 1 FROM charges c WHERE c.id = payments.charge_id AND c.professional_id = app_user()))));

-- ---------------------------------------------------------------- privilégios

GRANT SELECT, INSERT, UPDATE ON services, payers TO app_runtime;
GRANT SELECT ON charges, payments TO app_runtime;
GRANT INSERT (clinic_id, patient_id, professional_id, payer_id, appointment_id, descricao, competencia,
              valor_centavos, desconto_centavos, vencimento, forma_prevista, convenio, imposto_recolhido, origem, created_by)
  ON charges TO app_runtime;
GRANT UPDATE (payer_id, descricao, desconto_centavos, vencimento, forma_prevista, convenio, imposto_recolhido, status, cancel_reason)
  ON charges TO app_runtime;
GRANT INSERT (clinic_id, charge_id, valor_centavos, metodo, pago_em, observacao, recebido_por, registrado_por,
              reverses_id, motivo_estorno, idempotency_key)
  ON payments TO app_runtime;

-- ---------------------------------------------------------------- backfill
-- Sessões realizadas com valor viram cobrança; as marcadas como pagas ganham um pagamento
-- "migrado". O legado não guardou a data real do pagamento: usamos a data da sessão.

INSERT INTO charges (clinic_id, patient_id, professional_id, appointment_id, descricao, competencia,
                     valor_centavos, convenio, imposto_recolhido, origem, created_by, created_at)
SELECT a.clinic_id, a.patient_id, a.professional_id, a.id, 'Atendimento psicológico',
       date_trunc('month', a.starts_at AT TIME ZONE cl.timezone)::date,
       round(a.valor * 100)::int, a.convenio, a.imposto, 'migracao', a.created_by, a.created_at
  FROM appointments a
  JOIN clinics cl ON cl.id = a.clinic_id
 WHERE a.status = 'realizado' AND a.valor IS NOT NULL AND round(a.valor * 100) BETWEEN 1 AND 10000000
   AND NOT EXISTS (SELECT 1 FROM charges c WHERE c.appointment_id = a.id AND c.status <> 'cancelada');

INSERT INTO payments (clinic_id, charge_id, valor_centavos, metodo, pago_em, observacao, recebido_por, registrado_por)
SELECT ch.clinic_id, ch.id, ch.valor_centavos, 'outro', (a.starts_at AT TIME ZONE cl.timezone)::date,
       'migrado', 'profissional', a.created_by
  FROM charges ch
  JOIN appointments a ON a.id = ch.appointment_id
  JOIN clinics cl ON cl.id = ch.clinic_id
 WHERE ch.origem = 'migracao' AND a.payment_status = 'pago'
   AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.charge_id = ch.id);
