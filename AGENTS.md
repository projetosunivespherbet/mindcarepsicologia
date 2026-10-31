# Regras de arquitetura

- O produto é um software de gestão para o psicólogo e sua clínica. A área do paciente e a mensageria foram descontinuadas; não reintroduza telas, rotas ou assinaturas de mensagens.
- Papéis e vínculos devem ser definidos no servidor (RLS, triggers ou funções), nunca só no front.
- Dados clínicos são sensíveis (LGPD): não exclua registros clínicos fisicamente e não envie conteúdo clínico a serviços externos.
