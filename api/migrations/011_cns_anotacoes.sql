-- CNS (Cartão Nacional de Saúde) do paciente e anotações privativas do psicólogo na sessão.
-- Prontuário (conteudo) é o registro formal e sintético; anotações privativas são o registro documental
-- do próprio psicólogo (hipóteses, impressões, manejo clínico). Ambos seguem a mesma RLS: só o psicólogo da sessão.

ALTER TABLE patients ADD COLUMN cns text CHECK (cns IS NULL OR cns ~ '^[0-9]{15}$');

ALTER TABLE session_records ADD COLUMN anotacoes text NOT NULL DEFAULT '' CHECK (length(anotacoes) <= 20000);
ALTER TABLE session_records DROP CONSTRAINT session_records_conteudo_check;
ALTER TABLE session_records ALTER COLUMN conteudo SET DEFAULT '';
ALTER TABLE session_records ADD CONSTRAINT session_records_conteudo_check CHECK (length(conteudo) <= 20000);
GRANT UPDATE (anotacoes) ON session_records TO app_runtime;

DROP TRIGGER patients_history ON patients;
CREATE TRIGGER patients_history AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION change_log_row('nome,cpf,cns,data_nascimento,telefone,email,genero,estado_civil,profissao');
