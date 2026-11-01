-- Observação do agendamento: recado administrativo visível a quem vê a sessão (recepção, administração, psicólogo).
-- Não é lugar de conteúdo clínico (esse fica no prontuário e nas anotações privativas).
ALTER TABLE appointments ADD COLUMN observacao text CHECK (observacao IS NULL OR length(observacao) BETWEEN 1 AND 500);
