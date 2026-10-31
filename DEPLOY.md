# Publicação (Neon + Cloudflare Workers + Cloudflare Pages)

Tempo estimado: 40 a 60 minutos na primeira vez. Você precisa de contas no GitHub, no Cloudflare e no Neon,
do Node 22 instalado e do repositório já enviado ao GitHub.

> Ordem importa: **banco → API → front → ajustar a API com a URL do front**.

## 1. Banco (Neon)

1. Crie um projeto no Neon (escolha a região mais próxima do Brasil disponível para você).
2. Em *Connection details*, copie duas strings do papel dono (`neondb_owner`): a **direta** (para migrar) e,
   depois, a **pooled** (host com `-pooler`) do papel da API.
3. Aplique o schema, com a string **direta** do dono:

   ```bash
   cd api && npm install
   DATABASE_URL="postgresql://neondb_owner:SENHA@ep-xxxx.REGIAO.aws.neon.tech/neondb?sslmode=require" npm run migrate
   ```

   Deve listar `001_schema.sql`, `002_documents.sql`, `003_rate_limit.sql`, `004_finance.sql`, `005_fiscal.sql` e `006_attendance_history.sql`.
4. No *SQL Editor* do Neon, crie o papel que a API usa (troque a senha por uma forte e guarde-a):

   ```sql
   CREATE ROLE app_user LOGIN PASSWORD 'TROQUE-ESTA-SENHA' IN ROLE app_runtime;
   ```

5. Monte a string da API (papel `app_user`, host **pooled**):
   `postgresql://app_user:TROQUE-ESTA-SENHA@ep-xxxx-pooler.REGIAO.aws.neon.tech/neondb?sslmode=require`

## 2. API (Cloudflare Workers)

```bash
cd api
npx wrangler login
npx wrangler secret put DATABASE_URL   # a string do app_user (passo 1.5)
npx wrangler secret put JWT_SECRET     # gere com: openssl rand -base64 48
npx wrangler secret put SETUP_TOKEN    # gere com: openssl rand -base64 32 (guarde: cria clínicas)
npx wrangler deploy
```

Anote a URL que o comando imprimir (`https://mindcare-api.SEU-SUBDOMINIO.workers.dev`).
Por enquanto `APP_URL` e `ALLOWED_ORIGIN` em `api/wrangler.toml` ainda têm o valor de exemplo; você os troca no passo 4.

## 3. Front (Cloudflare Pages)

1. No painel: *Workers & Pages → Create → Pages → Connect to Git* e escolha o repositório.
2. Configuração do build:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: (vazio)
   - Variáveis de ambiente: `VITE_API_URL` = URL da API (sem barra no final) e `NODE_VERSION` = `22`
3. Nada a editar nos cabeçalhos de segurança: a CSP de `public/_headers` já vem **bloqueando** e a origem da API é
   inserida automaticamente no build, a partir de `VITE_API_URL`.
4. Anote a URL do site (`https://SEU-APP.pages.dev`).

## 4. Ligar o front à API

Em `api/wrangler.toml`, ajuste (sem barra no final):

```toml
APP_URL = "https://SEU-APP.pages.dev"
ALLOWED_ORIGIN = "https://SEU-APP.pages.dev"
```

e publique de novo: `cd api && npx wrangler deploy`.

## 5. Verificar a instalação

```bash
cd api
API_URL="https://mindcare-api.SEU-SUBDOMINIO.workers.dev" ALLOWED_ORIGIN="https://SEU-APP.pages.dev" npm run smoke
```

Todas as linhas devem sair com ✓ (API no ar, banco alcançado, login protegido, CORS só para o seu front).

## 6. Criar a clínica e o primeiro administrador

```bash
curl -X POST "https://mindcare-api.SEU-SUBDOMINIO.workers.dev/platform/clinics" \
  -H "x-setup-token: SEU_SETUP_TOKEN" -H "content-type: application/json" \
  -d '{"clinic_nome":"Nome da Clínica","admin_nome":"Seu Nome","email":"voce@exemplo.com","password":"Senha@1234"}'
```

A senha precisa ter 8+ caracteres com maiúscula, minúscula, número e caractere especial. Troque-a depois do primeiro acesso.

## 7. Roteiro de teste no navegador (faça antes de usar com pacientes)

1. Entre como administrador e abra o console do navegador (F12): não deve haver erros em vermelho.
2. **Usuários → Novo usuário** (psicólogo, com CRP). Copie o link, abra numa janela anônima e conclua o cadastro.
3. **Papel timbrado**: crie um modelo em cada modo e use *Visualizar exemplo*. Teste o envio de logo e de imagem de fundo.
4. Como psicólogo: cadastre um paciente, preencha a anamnese e crie um **documento** de cada tipo que você usa.
5. **Pré-visualizar PDF**, depois **Emitir**, **Baixar PDF** e **Abrir para imprimir**. Imprima uma amostra no seu
   papel timbrado físico e ajuste as margens se algo ficar fora do lugar.
6. Leia o QR do PDF com o celular: a página de verificação deve mostrar "Documento autêntico e válido".
7. **Anule** um documento de teste e confira que a verificação passa a mostrar "ANULADO".
8. Entre como outro psicólogo: ele não deve ver pacientes nem documentos do primeiro.
9. Saia e entre de novo; teste uma senha errada 5 vezes (a conta bloqueia por 15 minutos).

## 8. Endurecer (depois do teste)

- **CSP (política de segurança de conteúdo):** já está ativa e foi testada em Chrome com todas as telas, envio de
  imagens e geração de PDF, sem bloqueios. O único trecho que o teste automático não cobre é o **visualizador de PDF**
  do navegador (botão "Abrir para imprimir"): confira no passo 5 do roteiro. Se algo legítimo for bloqueado, o console
  (F12) mostra a diretiva; ajuste `object-src`/`frame-src` em `public/_headers`. Para investigar sem bloquear,
  renomeie temporariamente `Content-Security-Policy` para `Content-Security-Policy-Report-Only`.
- **Segredos:** guarde `SETUP_TOKEN` e `JWT_SECRET` num cofre de senhas. Trocar o `JWT_SECRET` desconecta todo mundo.
- **Backup:** confira no Neon a retenção de histórico (restauração a um ponto no tempo) do seu plano e, se for curta,
  agende `pg_dump` periódico. São dados de saúde: defina quem acessa o painel do Neon e do Cloudflare e ative a
  verificação em duas etapas nas três contas.
- **Logs:** `cd api && npx wrangler tail` mostra erros da API em tempo real.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Telas abrem, mas as chamadas à API falham com aviso de CSP (`connect-src`) | `VITE_API_URL` ausente ou errada no build do Pages; corrija a variável e publique de novo |
| Erro de CORS no console | `ALLOWED_ORIGIN` diferente da URL do front (https, sem barra no final) ou API não republicada |
| `smoke` falha em `/health/db` | `DATABASE_URL` errada, papel `app_user` inexistente ou migrations não aplicadas |
| Erro 1102 / "exceeded CPU" ao entrar | o hash de senha (scrypt) estourou o limite de CPU do plano; use o plano pago ou reduza `SCRYPT_N` |
| "Muitas tentativas" (429) | mais de 10 tentativas de login ou aceite de convite em 1 minuto no mesmo IP |
| Tela em branco ao recarregar uma rota | exista um `404.html` na pasta `public` (o Pages só trata como SPA sem ele) |
| O PDF não abre | bloqueador de pop-up do navegador; libere o site |
