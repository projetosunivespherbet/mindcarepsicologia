-- Endereço do paciente em partes (CEP, rua, número, complemento, bairro, cidade, UF).
-- `endereco` continua existindo: é o texto montado a partir das partes, usado nos documentos.
ALTER TABLE patients
  ADD COLUMN end_cep text CHECK (end_cep IS NULL OR end_cep ~ '^[0-9]{8}$'),
  ADD COLUMN end_logradouro text CHECK (end_logradouro IS NULL OR length(end_logradouro) BETWEEN 1 AND 160),
  ADD COLUMN end_numero text CHECK (end_numero IS NULL OR length(end_numero) BETWEEN 1 AND 20),
  ADD COLUMN end_complemento text CHECK (end_complemento IS NULL OR length(end_complemento) BETWEEN 1 AND 80),
  ADD COLUMN end_bairro text CHECK (end_bairro IS NULL OR length(end_bairro) BETWEEN 1 AND 80),
  ADD COLUMN end_cidade text CHECK (end_cidade IS NULL OR length(end_cidade) BETWEEN 1 AND 80),
  ADD COLUMN end_uf text CHECK (end_uf IS NULL OR end_uf ~ '^[A-Z]{2}$');

DROP TRIGGER patients_history ON patients;
CREATE TRIGGER patients_history AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION change_log_row('nome,cpf,cns,endereco,end_cep,end_logradouro,end_numero,end_complemento,end_bairro,data_nascimento,telefone,email,genero,estado_civil,profissao,responsavel_nome,responsavel_cpf,responsavel_telefone');
