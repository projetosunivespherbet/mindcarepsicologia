-- Dados cadastrais da clínica (editáveis pelo administrador): CPF ou CNPJ, razão social, contato e endereço.
-- O CNPJ aceita o formato alfanumérico novo (12 caracteres + 2 dígitos), como em fiscal_issuers.
-- O histórico de alterações fica no audit_log (clinics não tem coluna clinic_id para o change_log_row).

ALTER TABLE clinics
  ADD COLUMN documento_tipo text CHECK (documento_tipo IN ('cpf', 'cnpj')),
  ADD COLUMN documento text,
  ADD COLUMN razao_social text CHECK (razao_social IS NULL OR length(razao_social) BETWEEN 2 AND 160),
  ADD COLUMN telefone text CHECK (telefone IS NULL OR length(telefone) <= 30),
  ADD COLUMN email text CHECK (email IS NULL OR length(email) <= 160),
  ADD COLUMN endereco text CHECK (endereco IS NULL OR length(endereco) <= 300),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE clinics ADD CONSTRAINT clinics_documento_ck CHECK (
  (documento_tipo IS NULL AND documento IS NULL)
  OR (documento_tipo = 'cpf' AND documento IS NOT NULL AND documento ~ '^[0-9]{11}$')
  OR (documento_tipo = 'cnpj' AND documento IS NOT NULL AND documento ~ '^[0-9A-Z]{12}[0-9]{2}$')
);

CREATE TRIGGER clinics_updated BEFORE UPDATE ON clinics FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT UPDATE (nome, timezone, documento_tipo, documento, razao_social, telefone, email, endereco) ON clinics TO app_runtime;
