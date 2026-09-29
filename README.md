# PipeDesign

Automação de rascunhos de peças de social media com **n8n + Canva**.
O n8n (local) orquestra; o Canva mantém os templates e os designs editáveis; o designer sempre finaliza.

- Arquitetura: [`docs/ARQUITETURA_N8N_AUTOMACAO_DESIGN_CANVA.md`](docs/ARQUITETURA_N8N_AUTOMACAO_DESIGN_CANVA.md)
- Spike Canva ↔ n8n: [`docs/CANVA_INTEGRATION_SPIKE.md`](docs/CANVA_INTEGRATION_SPIKE.md)
- Briefing criativo (Form n8n): [`workflows/WF-04-creative-briefing.json`](workflows/WF-04-creative-briefing.json) — contrato em [`schemas/job-brief.schema.json`](schemas/job-brief.schema.json)

## Serviços locais

| Serviço | URL (host) | Função |
|---|---|---|
| n8n | http://127.0.0.1:5678 | Orquestração dos workflows |
| canva-auth | http://127.0.0.1:3001 | OAuth 2.0 + PKCE com o Canva e renovação de tokens |
| Ollama | http://127.0.0.1:11434 | Análise visual local das fotos no WF-02 |
| PostgreSQL + pgvector | 127.0.0.1:5432 | Banco `n8n` (interno do n8n) e banco `pipedesign` (aplicação, com `vector`) |

Todas as portas ficam presas a `127.0.0.1`. Dentro da rede Docker, o n8n acessa o auth em `http://canva-auth:3001` e o banco em `postgres:5432`.

## Primeiros passos

```bash
cp .env.example .env
openssl rand -hex 32   # use em N8N_ENCRYPTION_KEY
openssl rand -hex 32   # use em CANVA_AUTH_API_KEY (opcional, recomendado)
# preencha também POSTGRES_PASSWORD, CANVA_CLIENT_ID e CANVA_CLIENT_SECRET

docker compose up -d --build
docker compose ps
```

Baixe uma vez os modelos locais de visão e embeddings:

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull gemma3:4b
docker compose exec ollama ollama pull embeddinggemma
```

O WF-02 envia a foto e o texto estruturado apenas para `http://ollama:11434` dentro da rede Docker. O `gemma3:4b` faz a análise visual e o `embeddinggemma` gera o vetor de 768 dimensões. No WF-05, o briefing usa o mesmo modelo local para recuperar primeiro os assets da marca. Quando nenhuma foto local representa uma cena, o draft-renderer pode consultar o Pexels, baixar uma alternativa de apoio coerente com a paleta e registrar fotógrafo e links em `{job_id}.credits.json`. Fotos Pexels nunca são tratadas como produto verificado da marca. A OpenAI permanece somente no Art Director, configurado por padrão com o econômico `gpt-4o-mini`; o resultado informa o consumo de tokens.

Para habilitar o fallback, crie uma chave gratuita em [Pexels API](https://www.pexels.com/api/), preencha `PEXELS_API_KEY` no `.env` e recrie o renderer: `docker compose up -d --build draft-renderer`. Sem a chave, o fluxo continua usando apenas a biblioteca local.

### 1. Integração no Canva Developer Portal

1. Crie a integração (ex.: *Agency Design Automation - Local Dev*).
2. Redirect URL: `http://127.0.0.1:3001/auth/canva/callback` (o Canva **não** aceita `localhost`).
3. Habilite os scopes: `asset:read asset:write brandtemplate:meta:read brandtemplate:content:read design:content:write design:meta:read`.
4. Copie Client ID e Client Secret para o `.env` e rode `docker compose up -d canva-auth` para recarregar.

### 2. Autorizar uma vez

Abra no navegador: **http://127.0.0.1:3001/auth/canva/start**

Depois confira: `curl -s http://127.0.0.1:3001/health` → `"authorized": true` e `"missing_scopes": []`.

A partir daí o access token é renovado automaticamente (o Canva rotaciona o refresh token a cada uso; o serviço serializa os refreshes e grava o arquivo de forma atômica no volume `canva_auth_data`).

### 3. Banco da aplicação (jobs / briefing)

O `db/init/` só roda na **primeira** subida do volume do Postgres. Depois:

```bash
./db/migrate.sh   # cria brands + jobs e o seed da marca `exemplo`
```

No n8n, crie a credencial **PipeDesign Postgres** (`host: postgres`, `database: pipedesign`, user/senha do `.env`) e importe [`workflows/WF-04-creative-briefing.json`](workflows/WF-04-creative-briefing.json). Ative o workflow e abra **http://127.0.0.1:5678/form/briefing**. Detalhes em [`workflows/README.md`](workflows/README.md).

### Adicionar uma nova empresa

O repositório traz só a marca de exemplo `exemplo`. Para cada empresa:

1. Copie `brands/exemplo` para `brands/<slug>` (minúsculas, números e hífen) e ajuste `brand_id`, cores, fontes, medidas e voz no `brand.json`. O guia está em [`brands/exemplo/README.md`](brands/exemplo/README.md).
2. Coloque fotos e logos em `workspace/clients/<slug>/` (`Fotos/…` e `Logos/…`). Essa pasta não entra no Git.
3. Cadastre a marca no banco:

   ```sql
   INSERT INTO brands (slug, name, workspace_path, status)
   VALUES ('<slug>', '<Nome da marca>', '/workspace/clients/<slug>', 'active');
   ```

4. Regenere os workflows, que leem as marcas de `brands/` no build, e reimporte-os no n8n:

   ```bash
   node workflows/src/wf-02-build.mjs && node workflows/src/wf-04-build.mjs && node workflows/src/wf-05-build.mjs
   ```

5. Indexe as fotos com o WF-02 usando `ASSET_INDEX_BRAND=<slug>`. Depois, escolha a marca no Form do WF-04 e gere os rascunhos no WF-05.

### 4. Rodar o workflow do spike

Importe `workflows/spike-canva-autofill.json` no n8n e execute. Os modos, os blocos e os códigos de erro estão em [`workflows/README.md`](workflows/README.md).

- `SPIKE_MODE=upload_only`: testa token + upload de `./workspace/spike/test-image.jpg`.
- `SPIKE_MODE=full`: fluxo completo até o design editável (precisa do Brand Template de teste).

### 5. Usar o token em outros workflows

HTTP Request node:

- **GET** `{{ $env.CANVA_AUTH_INTERNAL_URL }}/auth/canva/token`
- Header `x-api-key: {{ $env.CANVA_AUTH_API_KEY }}` (se configurado)
- Nas chamadas ao Canva: `Authorization: Bearer {{ $json.access_token }}` e base `{{ $env.CANVA_API_BASE_URL }}`

## API do canva-auth

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Estado do serviço e da autorização (nunca retorna tokens) |
| GET | `/auth/canva/start` | Redireciona para o consentimento do Canva (`?format=json` devolve a URL) |
| GET | `/auth/canva/callback` | Recebe `code`/`state`, valida o state e troca o código por tokens |
| GET | `/auth/canva/token` | Access token válido (renova se faltar < 5 min) — protegido por `x-api-key` se configurado |
| POST | `/auth/canva/refresh` | Força a renovação — protegido por `x-api-key` se configurado |

Respostas de `/auth/canva/token`:

```jsonc
// 200
{ "status": "ok", "access_token": "…", "token_type": "Bearer", "expires_at": 1780000000, "scope": "…", "refreshed": false }
// 401 — ainda não autorizado, ou refresh token revogado/expirado
{ "status": "authorization_required", "code": "AUTHORIZATION_REQUIRED | REAUTHORIZATION_REQUIRED",
  "message": "… Autorize primeiro: http://127.0.0.1:3001/auth/canva/start", "authorize_url": "…" }
// 502/503 — falha ao renovar (modelo de erro padronizado do spike)
{ "status": "failed", "stage": "token_refresh", "code": "CANVA_TOKEN_REFRESH_FAILED", "message": "…", "retryable": true, "context": { … } }
```

> No n8n, o HTTP Request trata 401 como erro e interrompe o workflow exibindo a mensagem acima. Para tratar em um IF, ative *Options → Response → Never Error*.

### Desenvolvimento do serviço

```bash
cd services/canva-auth
npm install
npm test            # testes unitários + integração com um Canva simulado
npm run build
npm run start:local # roda fora do Docker usando ../../.env (token em .data/)
```

Requer Node.js 22+.

## Estrutura

```text
.
├── docker-compose.yml
├── .env.example
├── db/
│   ├── init/          # executado só na 1ª subida do Postgres (cria banco da app + pgvector)
│   ├── migrations/    # ./db/migrate.sh — brands, jobs (WF-04)
│   └── seeds/
├── docs/
│   ├── decisions/
│   └── spike-results/
├── prompts/
├── schemas/           # job-brief.schema.json (WF-04)
├── services/
│   └── canva-auth/    # OAuth 2.0 + PKCE, token store, refresh
├── workflows/         # exports JSON dos workflows n8n
└── workspace/         # montado em /workspace no n8n (assets reais NÃO vão para o Git)
    ├── clients/
    ├── jobs/          # {job_id}.json gerado pelo WF-04
    └── spike/         # coloque aqui test-image.jpg para o spike
```

## Segurança

- `.env`, tokens e assets reais nunca entram no Git.
- `CANVA_CLIENT_SECRET` só existe no container `canva-auth`; o n8n recebe apenas variáveis não secretas (e a `CANVA_AUTH_API_KEY`).
- O refresh token nunca sai do `canva-auth`; logs mascaram tokens, secret, `code` e `code_verifier`.
- O n8n só lê/grava arquivos dentro de `/workspace`.
- Se o volume do Postgres já existia antes do script em `db/init/`, crie o banco da aplicação manualmente ou recrie o volume (`docker compose down -v` apaga **todos** os dados).
