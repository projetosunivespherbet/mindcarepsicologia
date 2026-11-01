-- Chave Pix do profissional (para gerar o "copia e cola" das cobranças). Não é dado sensível: é feita para ser compartilhada
-- com quem paga, por isso todos os perfis da clínica a enxergam junto da lista de profissionais. Só a administração altera.

ALTER TABLE users ADD COLUMN pix_chave text CHECK (pix_chave IS NULL OR length(pix_chave) BETWEEN 1 AND 77);

GRANT SELECT (pix_chave) ON users TO app_runtime;
GRANT INSERT (pix_chave) ON users TO app_runtime;
GRANT UPDATE (pix_chave) ON users TO app_runtime;
