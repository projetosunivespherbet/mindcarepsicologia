-- Observações gerais do paciente: recados abertos à equipe (recepção, administração, psicólogo).
-- Não é lugar de conteúdo clínico (esse fica no prontuário e nas anotações privativas).
ALTER TABLE patients ADD COLUMN observacoes text CHECK (observacoes IS NULL OR length(observacoes) BETWEEN 1 AND 1000);
