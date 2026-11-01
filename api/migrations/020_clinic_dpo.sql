-- Encarregado pelo tratamento de dados pessoais (LGPD, art. 41): nome e contato publicados nas políticas internas.
ALTER TABLE clinics
  ADD COLUMN encarregado_nome text CHECK (encarregado_nome IS NULL OR length(encarregado_nome) BETWEEN 2 AND 160),
  ADD COLUMN encarregado_email text CHECK (encarregado_email IS NULL OR length(encarregado_email) BETWEEN 3 AND 160);
GRANT UPDATE (encarregado_nome, encarregado_email) ON clinics TO app_runtime;
