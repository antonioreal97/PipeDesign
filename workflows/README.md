# Workflows n8n

## `WF-02-index-assets.json` — WF-02 Index Assets

Indexação incremental das fotos por SHA-256. A análise visual usa exclusivamente o Ollama local com `gemma3:4b`; não há fallback para APIs externas. Instale o modelo uma vez com:

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull gemma3:4b
docker compose exec ollama ollama pull embeddinggemma
```

O lote indexa a marca de `ASSET_INDEX_BRAND` (slug na tabela `brands`). O `workspace_path` dessa linha define a pasta permitida, e `ASSET_INDEX_GLOB` precisa ficar dentro de `<workspace_path>/Fotos/` (vazio = `<workspace_path>/Fotos/*.jpg`). Por padrão, o lote lê até três fotos (`ASSET_INDEX_LIMIT`). O JSON visual é validado e enviado ao `embeddinggemma` no próprio Ollama, gerando o vetor de 768 dimensões salvo no PostgreSQL. Tanto a foto quanto o embedding permanecem locais. O WF-05 usa exatamente o mesmo modelo para criar o vetor do briefing; não misture modelos entre indexação e busca.

## `WF-04-creative-briefing.json` — WF-04 Creative Briefing

Form local para o designer estruturar um `JobBrief`. **Não** lê `SPIKE_HEADLINE` / Autofill e **não** dispara rascunhos no Canva. Um envio = um carrossel; o fluxo para em `READY_FOR_PLANNING`.

Contrato: [`schemas/job-brief.schema.json`](../schemas/job-brief.schema.json).

### Importar

1. Aplique a migration no banco da aplicação: `./db/migrate.sh` (cria `brands` + `jobs` e o seed da marca `exemplo`).
2. Abra http://127.0.0.1:5678. **Create workflow → menu `…` → Import from File…** e selecione `workflows/WF-04-creative-briefing.json`.
3. Crie a credencial **PipeDesign Postgres** e associe ao node `C1 · Insert Job`:
   - Host: `postgres` (nome do serviço Docker; de dentro do n8n não use `127.0.0.1`)
   - Database: `pipedesign` (`POSTGRES_APP_DB`)
   - User / Password: os mesmos de `POSTGRES_USER` / `POSTGRES_PASSWORD` no `.env`
   - SSL: off
4. Salve e **publique / ative** o workflow. Sem isso a URL de produção do Form não responde.

Form: **http://127.0.0.1:5678/form/briefing**

Depois de alterar o workflow na interface, exporte-o de volta para este arquivo (**… → Download**), ou regenere pelo código:

```bash
node workflows/src/wf-04-build.mjs workflows/WF-04-creative-briefing.json
```

O mapper/validador vive em `workflows/src/job-brief.mjs`. Teste: `node --test workflows/src/job-brief.test.mjs`.

### O que o Form grava

| Campo no Form | JobBrief |
|---|---|
| Marca (slugs das pastas em `brands/`) | `brand_id` (ex.: `exemplo`) |
| Tipo de peça | `content_type` (`carousel`) |
| Telas do carrossel (2–10) | `slides` |
| Canal | `channel` (`instagram_feed`) |
| Motivo do post | `objective` |
| Título, conceito, mensagem, CTA e status da copy | `campaign` |
| Roteiro no formato `Tela N: …` | `slide_copy[]` (validado contra o número de telas) |
| Referências visuais, uma URL por linha | `references[]` |
| Nome, SKU, cor e link do produto | `product` |
| Abordagem visual (min. 1) | `visual_direction[]` |
| Continuidade, cenas/assets e regra para fotos ausentes | `production` |
| Evitar sujeito no centro | `asset_constraints.avoid_subject_position` |
| Outras restrições | `asset_constraints.notes` (omitido se vazio) |

Para `Destaque de produto`, ao menos um dado de produto é obrigatório. Se o roteiro for preenchido, ele deve conter exatamente a quantidade informada em **Telas do carrossel**, em sequência (`Tela 1`, `Tela 2`, …). URLs inválidas são recusadas antes da persistência.

Persistência, nesta ordem: Postgres `jobs.brief_json` → `/workspace/jobs/{job_id}.json` (no host: `./workspace/jobs/…`). A pasta `jobs` já existe no volume; o n8n 2.39 não tem node de `mkdir`. Se o arquivo falhar, o job no banco permanece. O WF-05 é acionado separadamente em `/form/gerar-rascunhos` com o Job ID gerado pelo briefing.

### Códigos de erro

| `code` | `stage` | Significado |
|---|---|---|
| `BRIEF_INVALID` | map_brief | Campo obrigatório ausente ou fora do contrato |
| `BRAND_NOT_FOUND` | persist_job | Slug da marca não está em `brands` (rode `./db/migrate.sh`) |
| `BRIEF_PERSIST_FAILED` | persist_job | Erro ao inserir no Postgres (credencial, rede, SQL) |
| `BRIEF_WRITE_FAILED` | write_brief | Job no banco, mas `/workspace/jobs/{id}.json` não foi escrito |

---

## `spike-canva-autofill.json` — SPIKE - Canva Autofill E2E

Implementa o fluxo do [`docs/CANVA_INTEGRATION_SPIKE.md`](../docs/CANVA_INTEGRATION_SPIKE.md), do token até o design editável, em um único workflow com gatilho manual.

### Importar

1. Abra http://127.0.0.1:5678. No primeiro acesso, o n8n pede para criar a conta de owner.
2. **Create workflow → menu `…` → Import from File…** e selecione `workflows/spike-canva-autofill.json`.
3. Salve. Não há credenciais para configurar: o token vem do `canva-auth`.

Depois de alterar o workflow na interface, exporte-o de volta para este arquivo (**… → Download**) para manter o Git como fonte da verdade.

### Pré-requisitos

- `docker compose up -d` com o `.env` preenchido.
- Autorização feita uma vez: http://127.0.0.1:3001/auth/canva/start (confira em `/health` se `authorized` está `true`).
- Uma imagem JPEG/PNG em `./workspace/spike/test-image.jpg`. O `./workspace` do projeto aparece como `/workspace` no n8n.

### Modos (`SPIKE_MODE` no `.env`)

| Modo | Blocos executados | Quando usar |
|---|---|---|
| `upload_only` | A → B → E → F/G → resultado com `canva_asset_id` | Antes de existir o Brand Template de teste |
| `full` | A → B → C → D → E → F/G → H → I/J → K → resultado com `design.edit_url` | Depois de publicar o template (§10). **Exige Autofill (Canva Enterprise ou acesso de dev)** |
| `import` | A → B → M → resultado com um `edit_url` por arquivo | Importar PDF/PPTX de `SPIKE_IMPORT_GLOB` como designs editáveis. **Funciona no Canva Pro** |

Depois de mudar o `.env`, recrie o n8n com `docker compose up -d n8n`. Para um teste pontual sem reiniciar, preencha `OVERRIDES` no node **A2 · Spike Config**.

Outras variáveis lidas: `SPIKE_IMPORT_GLOB` (padrão `/workspace/spike/import-test/*.{pdf,pptx}`), `CANVA_TEST_TEMPLATE_NAME`, `CANVA_TEST_BRAND_TEMPLATE_ID`, `SPIKE_IMAGE_PATH`, `SPIKE_HEADLINE`, `SPIKE_SUBHEADLINE`, `SPIKE_DESIGN_TITLE`, `SPIKE_POLL_INTERVAL_SECONDS` (padrão 2) e `SPIKE_POLL_MAX_ATTEMPTS` (padrão 30).

### Blocos

| Bloco | Nodes | O que faz |
|---|---|---|
| A | `A1 · Start`, `A2 · Spike Config` | Gatilho manual e configuração (`run_id`, modo, URLs, contrato de campos) |
| B | `B1`–`B3` | `GET canva-auth/auth/canva/token` (com `x-api-key`) e escolha do modo |
| C | `C1`–`C3` | Brand Template pelo ID fixo ou pelo título exato |
| D | `D1`–`D3` | Dataset do template; exige `COVER_IMAGE` (image), `HEADLINE` e `SUBHEADLINE` (text) antes de qualquer upload |
| E | `E1`–`E3` | Lê a imagem local e valida existência, tipo e tamanho (≤ 50 MB) |
| F/G | `F1`–`F3`, `G0`, `G1`, `F9` | `POST /asset-uploads` (binário + `Asset-Upload-Metadata`) e polling a cada 2 s, até 30 vezes. 429, 5xx ou falha de rede no polling geram nova tentativa |
| H | `H1`, `H2` | Monta o `AutofillRequest` e o valida contra o dataset real (campos, tipos, textos vazios) |
| I/J | `I1`, `J0`–`J3` | `POST /autofills` e polling do job |
| K | `K1`–`K3`, `K9` | `GET /designs/{id}` e resultado final com `design.id`, `edit_url` e `view_url` |
| M | `M1`–`M9` | Modo `import`. Lê até 10 arquivos (PDF, PPTX, PPT, AI, PSD, DOCX, KEY) e cria um `POST /imports` por arquivo, com o header `Import-Metadata` (`title_base64` ≤ 50 caracteres e `mime_type`). Acompanha todos os jobs juntos com `GET /imports/{id}` e devolve `edit_url` e `view_url` (válidas por 30 dias). Falha parcial vira `status: partial` |
| X | `X · Stop With Error` | Ponto único de falha, com o erro padronizado (§32) |

Cada node de checagem (`B2`, `C2`, `D2`, `E2`, `F2`, `H1`, `J1`, `K2`) devolve `{ step, ok, ... }` e um campo `route` usado pelo Switch seguinte: 0 = seguir, 1 = aguardar/alternativa, 2 = falhar, 3 = concluir `upload_only`.

### Códigos de erro

| `code` | `stage` | Significado |
|---|---|---|
| `CONFIG_INVALID` | config | `SPIKE_MODE` diferente de `full` e `upload_only` |
| `AUTHORIZATION_REQUIRED` / `REAUTHORIZATION_REQUIRED` | oauth | Falta autorizar (ou reautorizar) em `/auth/canva/start` |
| `INVALID_API_KEY` | auth | `CANVA_AUTH_API_KEY` diferente entre n8n e canva-auth |
| `CANVA_AUTH_UNREACHABLE` | oauth | Container `canva-auth` fora do ar |
| `BRAND_TEMPLATE_NOT_FOUND` / `BRAND_TEMPLATE_AMBIGUOUS` | brand_template_lookup | Template inexistente ou título duplicado |
| `TEMPLATE_SCHEMA_MISMATCH` | template_dataset_validation | Campos de Autofill faltando ou com tipo errado |
| `LOCAL_ASSET_NOT_FOUND` / `_UNSUPPORTED_TYPE` / `_TOO_LARGE` / `_AMBIGUOUS` / `_READ_FAILED` | read_local_asset | Problema com a imagem local |
| `CANVA_ASSET_UPLOAD_FAILED` / `CANVA_ASSET_UPLOAD_TIMEOUT` | asset_upload(_polling) | Upload recusado, ou sem conclusão dentro do limite de tentativas |
| `AUTOFILL_REQUEST_INVALID` | autofill_request_validation | Payload não bate com o dataset (a chamada ao Canva não acontece) |
| `CANVA_PERMISSION_OR_PLAN_ERROR` | autofill_create | 403. Com `context.autofill_capability = BLOCKED_BY_PLAN`, o Autofill exige Enterprise ou acesso de desenvolvimento |
| `CANVA_AUTOFILL_FAILED` / `CANVA_AUTOFILL_TIMEOUT` | autofill(_polling) | Job de Autofill falhou ou não terminou |
| `IMPORT_FILES_NOT_FOUND` / `IMPORT_FILES_UNSUPPORTED` / `IMPORT_TOO_MANY_FILES` | read_import_files | Pasta vazia, formato não suportado ou mais de 10 arquivos |
| `CANVA_IMPORT_FAILED` / `CANVA_IMPORT_TIMEOUT` / `CANVA_IMPORT_ALL_FAILED` | design_import | Importação recusada pelo Canva, sem conclusão no prazo, ou nenhum arquivo importado |
| `CANVA_UNAUTHORIZED` · `CANVA_RATE_LIMITED` · `CANVA_SERVER_ERROR` · `CANVA_NETWORK_ERROR` · `CANVA_API_ERROR` | qualquer | Classificação genérica de respostas HTTP |

### Código-fonte

O JSON é gerado por `workflows/src/build.mjs`, e o código dos Code nodes fica em `workflows/src/code-snippets.mjs`. Para mudar o workflow pelo código, edite esses arquivos e rode:

```bash
node workflows/src/build.mjs workflows/spike-canva-autofill.json
```

Depois reimporte o workflow no n8n. O build é determinístico: os IDs dos nodes são estáveis.

### Teste de conversão (modo `import`)

Resultado em [`docs/spike-results/canva-import-fidelity.md`](../docs/spike-results/canva-import-fidelity.md). Em resumo: **PPTX preserva os elementos; PDF funde as caixas de texto.** Os arquivos de teste são gerados por `scripts/import-fidelity-test/`.

### Verificação feita

O workflow foi importado e executado pela CLI no n8n **2.39.6**, contra um canva-auth e uma Canva API simulados. Cenários cobertos:

- **Sucesso:** `upload_only` e `full`, com o template localizado pelo título e pelo ID.
- **Polling:** um 429 no meio do polling é repetido.
- **Falhas:** sem autorização, `x-api-key` errada, canva-auth fora do ar, modo inválido, template inexistente, duplicado e com ID inválido, dataset sem `COVER_IMAGE`, imagem inexistente, arquivo que não é imagem, upload recusado, timeout de upload, campo `NON_EXISTENT_FIELD` e Autofill com 403.

Todos terminaram no node e com o código esperados.

O modo `import` também foi testado no mock: sucesso, sucesso parcial, 403, timeout, 429 no polling e pasta vazia. Depois rodou **contra a API real do Canva** (conta Pro) em 17/09/2026: 5 de 5 arquivos importados. Os modos `upload_only` e `full` ainda não rodaram contra o Canva real.

### Limitações conhecidas

- **Token nos dados de execução:** o access token aparece nos dados das execuções salvas pelo n8n (no Postgres local) e expira em cerca de 4 h. O resultado final não o inclui.
- **401 do Canva:** não há renovação automática com nova tentativa. O erro orienta a executar de novo, e o `canva-auth` renova o token na próxima execução.
- **Busca por título:** considera só a primeira página, com até 100 templates. Use `CANVA_TEST_BRAND_TEMPLATE_ID` depois do primeiro sucesso.
- **Uploads duplicados:** o mapeamento `sha256 → canva_asset_id` fica para depois do spike (§34), então a mesma imagem pode ser enviada mais de uma vez.
