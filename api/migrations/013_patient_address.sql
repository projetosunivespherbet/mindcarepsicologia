-- Endereço do paciente (opcional), para documentos que pedem identificação completa.
ALTER TABLE patients ADD COLUMN endereco text CHECK (endereco IS NULL OR length(endereco) BETWEEN 1 AND 300);

DROP TRIGGER patients_history ON patients;
CREATE TRIGGER patients_history AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION change_log_row('nome,cpf,cns,endereco,data_nascimento,telefone,email,genero,estado_civil,profissao');
