-- CPF do profissional (11 dígitos, sem máscara): exigido no arquivo de lote do Receita Saúde.
-- Só a administração lê e altera (as policies de users já restringem a escrita ao admin).

ALTER TABLE users ADD COLUMN cpf text CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');

GRANT SELECT (cpf) ON users TO app_runtime;
GRANT INSERT (cpf) ON users TO app_runtime;
GRANT UPDATE (cpf) ON users TO app_runtime;
