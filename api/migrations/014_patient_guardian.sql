-- Responsável legal do paciente (crianças, adolescentes, pessoas com deficiência sob curatela).
-- Diferente do responsável financeiro (payers): é quem representa o paciente e pode pedir cópia do prontuário.
ALTER TABLE patients
  ADD COLUMN responsavel_nome text CHECK (responsavel_nome IS NULL OR length(responsavel_nome) BETWEEN 2 AND 160),
  ADD COLUMN responsavel_cpf text CHECK (responsavel_cpf IS NULL OR responsavel_cpf ~ '^[0-9]{11}$'),
  ADD COLUMN responsavel_vinculo text CHECK (responsavel_vinculo IS NULL OR length(responsavel_vinculo) BETWEEN 1 AND 60),
  ADD COLUMN responsavel_telefone text CHECK (responsavel_telefone IS NULL OR length(responsavel_telefone) BETWEEN 1 AND 30);

DROP TRIGGER patients_history ON patients;
CREATE TRIGGER patients_history AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION change_log_row('nome,cpf,cns,endereco,data_nascimento,telefone,email,genero,estado_civil,profissao,responsavel_nome,responsavel_cpf,responsavel_telefone');
