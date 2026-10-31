# Roteiro

## Fase 1 — limpeza e hardening (feita)
- [x] Remover dependências e arquivos exclusivos do Lovable (broker de sessão, tagger, Playwright e Drizzle do Lovable)
- [x] Remover o ramo do paciente do `AuthContext`
- [x] Migration: remover exposição de e-mail e telefone dos psicólogos, impedir troca de `role`, corrigir fuso da validação de horário
- [x] Migration de baseline para bancos novos
- [x] Corrigir erros de lint (`any`, `require`, hooks) e mover a fonte para o `index.html`

## Fase 2 — modelo da clínica
- [x] API em Hono + Neon (`api/`): clínica, usuários e papéis, RLS multi-tenant
- [x] Pré-cadastro pelos administradores com link de convite (sem e-mail), redefinição de senha pelo admin
- [x] Pacientes cadastrados pela clínica (sem conta própria); dados clínicos separados e restritos
- [x] Agendamento pela clínica (recorrência semanal, remarcação, falta, bloqueios) com conflito validado no banco
- [x] Auditoria de acesso a pacientes; testes de integração e CI no GitHub Actions
- [x] Front na API: login, convite por link, usuários, pacientes (com anamnese)
- [x] Documentos psicológicos (CFP 06/2019 + encaminhamento e termo/LGPD) com numeração, hash, QR de verificação e papel timbrado (3 modos)
- [ ] Agenda no front (a API já tem sessões, recorrência e bloqueios)
- [ ] Dashboard e financeiro/gestão de atendimento (referência em `src/legacy/`)
- [ ] Verificação do CRP (manual pelo administrador, no pré-cadastro)

## Publicação
- [x] Guia de deploy (`DEPLOY.md`), cabeçalhos do Pages, script de verificação pós-deploy e limite de tentativas por IP
- [x] CSP bloqueando, testada em Chrome real (13 passos, incluindo envio de imagens, PDF e bloqueios esperados)
- [ ] Primeira publicação e teste na Cloudflare/Neon reais (pendente de executar)

## Fase 3 — clínico e financeiro
- [ ] Prontuário e evolução por sessão, sem exclusão física
- [ ] Financeiro unificado (Receita Saúde, NFS-e, cobrança)
- [ ] Lembretes, documentos CFP, auditoria e exportação

## Pendências de banco
- [ ] Excluir a tabela `messages` (exige confirmação; contém dados)
- [ ] Gerar baseline com `supabase db dump` do banco real
