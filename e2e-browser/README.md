# Teste de navegador (Chrome headless)

Roda o app **compilado** num Chrome de verdade, com a API real e um Postgres local, e confere:

- login, convite por link, usuários, papel timbrado (envio real de logo e imagem de fundo), pacientes, anamnese,
  rascunho, emissão, **PDF baixado** (o texto do PDF é conferido) e verificação pública;
- agenda (agendar e marcar como realizada, com a cobrança criada junto), recebimento na aba Cobranças, emissor e
  registro de nota fiscal, sessão pro bono, pendências de emissão, histórico de alterações e **CSV do financeiro baixado**
  (o conteúdo é conferido). Campos de hora e data são definidos com `setInput` (o `fill` do Puppeteer não os altera);
- que a **CSP** do `public/_headers` não bloqueia nada do uso normal e que ela **bloqueia** o que deve
  (`fetch` para outro domínio, `eval`, script de outro domínio).

```bash
# precisa de um Postgres local com o usuário mc_owner (CREATEDB/CREATEROLE), como nos testes da API
cd e2e-browser && npm install
npm test               # CSP bloqueando (como em produção)
npm run test:report    # CSP só avisando (para investigar)
```

Usa `@sparticuz/chromium` (Chromium baixado pelo npm, sem instalar navegador). Telas dos passos que falham ficam
em `.work/shots`. Ao criar novas telas (por exemplo, a agenda), acrescente passos em `flow.mjs`.

Não cobre: o visualizador de PDF do navegador (o Chrome headless não tem) nem impressão em papel.
