// Trechos de JavaScript dos Code nodes do workflow SPIKE - Canva Autofill E2E.
// Cada Code node recebe HELPERS + o corpo específico.

export const CONFIG_NODE = 'A2 · Spike Config';

export const HELPERS = String.raw`// ---------------------------------------------------------------
// Helpers comuns do spike (repetidos em cada Code node de propósito:
// o n8n não compartilha código entre nodes).
// Rotas usadas pelos Switch: 0 = seguir, 1 = repetir/alternativa,
// 2 = falhar, 3 = concluir (modo upload_only).
// ---------------------------------------------------------------
const ROUTE = { NEXT: 0, RETRY: 1, FAIL: 2, DONE: 3 };
const cfg = $('${CONFIG_NODE}').first().json;

function fail(stage, code, message, opts = {}) {
  return [{
    json: {
      route: ROUTE.FAIL,
      step: stage,
      ok: false,
      error: {
        status: 'failed',
        run_id: cfg.run_id,
        stage,
        code,
        message,
        retryable: Boolean(opts.retryable),
        context: opts.context || {},
      },
    },
  }];
}

function parseBody(res) {
  let body = res && res.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { /* mantém texto */ }
  }
  return body;
}

function isNetworkError(res) {
  return !res || (res.statusCode === undefined && res.error !== undefined);
}

// Classifica uma resposta HTTP de erro no modelo padronizado (§32/§33 do spike).
function httpFail(stage, res, notFoundCode, context = {}) {
  if (isNetworkError(res)) {
    const msg = typeof res?.error === 'string' ? res.error : (res?.error?.message || 'sem resposta');
    return fail(stage, 'CANVA_NETWORK_ERROR', 'Falha de rede ao chamar o Canva: ' + msg, { retryable: true, context });
  }
  const body = parseBody(res) || {};
  const status = res.statusCode;
  const ctx = { ...context, http_status: status, canva_error_code: body.code, canva_error_message: body.message };
  if (status === 401) {
    return fail(stage, 'CANVA_UNAUTHORIZED',
      'O Canva recusou o access token. Execute o workflow de novo (o canva-auth renova o token); se persistir, autorize em ' + cfg.authorize_url,
      { context: ctx });
  }
  if (status === 403) {
    return fail(stage, 'CANVA_PERMISSION_OR_PLAN_ERROR',
      'Sem permissão: scope ausente, recurso de outra conta ou recurso indisponível no plano Canva. ' + (body.message || ''),
      { context: ctx });
  }
  if (status === 404) {
    return fail(stage, notFoundCode || 'CANVA_NOT_FOUND', body.message || 'Recurso não encontrado no Canva.', { context: ctx });
  }
  if (status === 429) {
    return fail(stage, 'CANVA_RATE_LIMITED', 'Limite de requisições do Canva atingido. Aguarde e execute novamente.', { retryable: true, context: ctx });
  }
  if (status >= 500) {
    return fail(stage, 'CANVA_SERVER_ERROR', 'Erro no servidor do Canva (HTTP ' + status + ').', { retryable: true, context: ctx });
  }
  return fail(stage, 'CANVA_API_ERROR', body.message || ('Canva respondeu HTTP ' + status + '.'), { context: ctx });
}

function ok(route, step, data) {
  return [{ json: { route, step, ok: true, ...data } }];
}
// ---------------------------------------------------------------
`;

// A2 — configuração. Não usa HELPERS (cfg ainda não existe).
export const A2_CONFIG = String.raw`// A2 · Spike Config
// Valores vêm do .env (via docker-compose). Para testar algo pontual
// sem reiniciar o n8n, preencha OVERRIDES abaixo.
const OVERRIDES = {
  // mode: 'import',                 // 'full' | 'upload_only' | 'import'
  // template_id: '',                // Brand Template ID fixo (pula a busca por nome)
  // template_name: '',
  // image_path: '/workspace/spike/test-image.jpg',
  // headline: '',
  // subheadline: '',
  // design_title: '',
  // extra_autofill_fields: { NON_EXISTENT_FIELD: { type: 'text', text: 'x' } }, // teste negativo §40
};

const env = (key, fallback = '') => {
  const value = $env[key];
  return value === undefined || value === null || String(value).trim() === '' ? fallback : String(value).trim();
};

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate());

const apiBase = env('CANVA_API_BASE_URL', 'https://api.canva.com/rest/v1').replace(/\/+$/, '');
const authInternal = env('CANVA_AUTH_INTERNAL_URL', 'http://canva-auth:3001').replace(/\/+$/, '');
const authPublic = env('CANVA_AUTH_PUBLIC_URL', 'http://127.0.0.1:3001').replace(/\/+$/, '');

const cfg = {
  run_id: 'spike_' + stamp + '_' + $execution.id,
  started_at: now.toISOString(),
  mode: env('SPIKE_MODE', 'full').toLowerCase(),
  api_base: apiBase,
  auth_token_url: authInternal + '/auth/canva/token',
  authorize_url: authPublic + '/auth/canva/start',
  template_name: env('CANVA_TEST_TEMPLATE_NAME', 'SPIKE - Social Post Template'),
  template_id: env('CANVA_TEST_BRAND_TEMPLATE_ID', ''),
  image_path: env('SPIKE_IMAGE_PATH', '/workspace/spike/test-image.jpg'),
  // Modo import: todos os PDF/PPTX desta pasta viram designs editáveis via POST /imports.
  import_glob: env('SPIKE_IMPORT_GLOB', '/workspace/spike/import-test/*.{pdf,pptx}'),
  headline: env('SPIKE_HEADLINE', 'Winter 26'),
  subheadline: env('SPIKE_SUBHEADLINE', 'New Collection'),
  design_title: env('SPIKE_DESIGN_TITLE', 'SPIKE - Canva Autofill'),
  poll: {
    interval_seconds: Number(env('SPIKE_POLL_INTERVAL_SECONDS', '2')),
    max_attempts: Number(env('SPIKE_POLL_MAX_ATTEMPTS', '30')),
  },
  // Contrato esperado do template de teste (§10.2).
  required_fields: { COVER_IMAGE: 'image', HEADLINE: 'text', SUBHEADLINE: 'text' },
  extra_autofill_fields: {},
  ...OVERRIDES,
};

cfg.template_lookup = cfg.template_id
  ? { by: 'id', url: cfg.api_base + '/brand-templates/' + encodeURIComponent(cfg.template_id) }
  : { by: 'name', url: cfg.api_base + '/brand-templates?limit=100&query=' + encodeURIComponent(cfg.template_name) };

return [{ json: cfg }];
`;

export const B2_CHECK_TOKEN = String.raw`// B2 · Check Token — valida a resposta do canva-auth e escolhe o modo.
const res = $input.first().json;

const MODE_ROUTE = { full: ROUTE.NEXT, upload_only: ROUTE.RETRY, import: ROUTE.DONE };
if (!(cfg.mode in MODE_ROUTE)) {
  return fail('config', 'CONFIG_INVALID', 'SPIKE_MODE inválido: "' + cfg.mode + '". Use "full", "upload_only" ou "import".');
}

if (isNetworkError(res)) {
  return fail('oauth', 'CANVA_AUTH_UNREACHABLE',
    'Não foi possível falar com o canva-auth em ' + cfg.auth_token_url + '. O container está de pé?',
    { retryable: true });
}

const body = parseBody(res) || {};

if (res.statusCode === 200 && body.status === 'ok' && body.access_token) {
  return ok(MODE_ROUTE[cfg.mode], 'token', {
    mode: cfg.mode,
    token_expires_at: body.expires_at,
    token_refreshed: Boolean(body.refreshed),
  });
}

if (body.status === 'authorization_required') {
  return fail('oauth', body.code || 'AUTHORIZATION_REQUIRED', body.message || ('Autorize primeiro: ' + cfg.authorize_url),
    { context: { authorize_url: body.authorize_url || cfg.authorize_url } });
}

if (body.status === 'failed') {
  return fail(body.stage || 'token_refresh', body.code || 'CANVA_TOKEN_ERROR', body.message || 'Falha no canva-auth.',
    { retryable: body.retryable, context: { http_status: res.statusCode, ...(body.context || {}) } });
}

return fail('oauth', 'CANVA_AUTH_UNEXPECTED_RESPONSE', 'Resposta inesperada do canva-auth (HTTP ' + res.statusCode + ').',
  { context: { http_status: res.statusCode } });
`;

export const C2_SELECT_TEMPLATE = String.raw`// C2 · Select Brand Template
const res = $input.first().json;
const lookup = cfg.template_lookup;

if (isNetworkError(res) || res.statusCode !== 200) {
  return httpFail('brand_template_lookup', res, 'BRAND_TEMPLATE_NOT_FOUND', { lookup_by: lookup.by, template_id: cfg.template_id || undefined });
}
const body = parseBody(res) || {};

if (lookup.by === 'id') {
  const tpl = body.brand_template;
  if (!tpl || !tpl.id) {
    return fail('brand_template_lookup', 'BRAND_TEMPLATE_NOT_FOUND', 'Resposta sem brand_template para o ID ' + cfg.template_id + '.');
  }
  return ok(ROUTE.NEXT, 'brand_template_lookup', { lookup_by: 'id', brand_template_id: tpl.id, template_name: tpl.title });
}

const normalize = (s) => String(s || '').trim().toLowerCase();
const items = Array.isArray(body.items) ? body.items : [];
const matches = items.filter((t) => normalize(t.title) === normalize(cfg.template_name));

if (matches.length === 0) {
  return fail('brand_template_lookup', 'BRAND_TEMPLATE_NOT_FOUND',
    'Nenhum Brand Template com o título "' + cfg.template_name + '". Publique o template (§10) ou defina CANVA_TEST_BRAND_TEMPLATE_ID.',
    { context: { templates_returned: items.map((t) => ({ id: t.id, title: t.title })), more_pages: Boolean(body.continuation) } });
}
if (matches.length > 1) {
  return fail('brand_template_lookup', 'BRAND_TEMPLATE_AMBIGUOUS',
    'Há ' + matches.length + ' Brand Templates com o título "' + cfg.template_name + '". Defina CANVA_TEST_BRAND_TEMPLATE_ID.',
    { context: { candidates: matches.map((t) => ({ id: t.id, title: t.title, updated_at: t.updated_at })) } });
}

const tpl = matches[0];
return ok(ROUTE.NEXT, 'brand_template_lookup', {
  lookup_by: 'name',
  brand_template_id: tpl.id,
  template_name: tpl.title,
  hint: 'Listagem OK. Para as próximas execuções, grave CANVA_TEST_BRAND_TEMPLATE_ID=' + tpl.id + ' no .env.',
});
`;

export const D2_VALIDATE_DATASET = String.raw`// D2 · Validate Dataset — fail fast antes de qualquer upload (§20).
const res = $input.first().json;
const tpl = $('C2 · Select Brand Template').first().json;

if (isNetworkError(res) || res.statusCode !== 200) {
  return httpFail('template_dataset', res, 'BRAND_TEMPLATE_NOT_FOUND', { brand_template_id: tpl.brand_template_id });
}

const dataset = (parseBody(res) || {}).dataset || {};
const received = Object.fromEntries(Object.entries(dataset).map(([name, def]) => [name, def && def.type]));
const expected = cfg.required_fields;

const missing = Object.keys(expected).filter((name) => !(name in received));
const wrongType = Object.keys(expected)
  .filter((name) => name in received && received[name] !== expected[name])
  .map((name) => ({ field: name, expected: expected[name], received: received[name] }));

if (missing.length || wrongType.length) {
  return fail('template_dataset_validation', 'TEMPLATE_SCHEMA_MISMATCH',
    'O dataset do Brand Template não bate com o esperado.' +
      (missing.length ? ' Faltando: ' + missing.join(', ') + '.' : '') +
      (wrongType.length ? ' Tipo errado: ' + wrongType.map((w) => w.field).join(', ') + '.' : ''),
    { context: { brand_template_id: tpl.brand_template_id, missing_fields: missing, wrong_type: wrongType, expected, received } });
}

return ok(ROUTE.NEXT, 'template_dataset', {
  brand_template_id: tpl.brand_template_id,
  template_name: tpl.template_name,
  fields: Object.keys(received),
  dataset: received,
});
`;

export const E2_VALIDATE_IMAGE = String.raw`// E2 · Validate Local Image (§21)
const items = $input.all();
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/tiff', 'image/gif', 'image/webp'];

const errored = items.find((i) => i.json && i.json.error);
if (errored) {
  const e = errored.json.error;
  const detail = typeof e === 'string' ? e : (e.message || JSON.stringify(e));
  if (/no file\(s\) found/i.test(detail)) {
    return fail('read_local_asset', 'LOCAL_ASSET_NOT_FOUND',
      'Arquivo não encontrado: ' + cfg.image_path + ' (o caminho é dentro do container; ./workspace do projeto = /workspace).',
      { context: { local_path: cfg.image_path } });
  }
  return fail('read_local_asset', 'LOCAL_ASSET_READ_FAILED',
    'Não foi possível ler ' + cfg.image_path + ': ' + (typeof e === 'string' ? e : (e.message || JSON.stringify(e))),
    { context: { local_path: cfg.image_path } });
}

const files = items.filter((i) => i.binary && i.binary.data);
if (files.length === 0) {
  return fail('read_local_asset', 'LOCAL_ASSET_NOT_FOUND',
    'Arquivo não encontrado: ' + cfg.image_path + ' (o caminho é dentro do container; ./workspace do projeto = /workspace).',
    { context: { local_path: cfg.image_path } });
}
if (files.length > 1) {
  return fail('read_local_asset', 'LOCAL_ASSET_AMBIGUOUS',
    'O caminho casou com ' + files.length + ' arquivos; o spike envia exatamente uma imagem.',
    { context: { local_path: cfg.image_path, matched: files.map((f) => f.binary.data.fileName) } });
}

const bin = files[0].binary.data;
const mime = String(bin.mimeType || '').toLowerCase();
if (!ALLOWED.includes(mime)) {
  return fail('read_local_asset', 'LOCAL_ASSET_UNSUPPORTED_TYPE',
    'Tipo de arquivo não suportado para upload: ' + (mime || 'desconhecido') + '. Use JPEG ou PNG no spike.',
    { context: { local_path: cfg.image_path, mime_type: mime } });
}

let bytes = typeof bin.bytes === 'number' ? bin.bytes : undefined;
if (bytes === undefined && typeof bin.data === 'string' && !bin.id) {
  bytes = Math.floor(bin.data.length * 3 / 4);
}
if (bytes !== undefined && bytes > MAX_BYTES) {
  return fail('read_local_asset', 'LOCAL_ASSET_TOO_LARGE', 'Arquivo com ' + bytes + ' bytes; o limite é 50 MB.',
    { context: { local_path: cfg.image_path, bytes } });
}

// Nome do asset no Canva: até 50 caracteres, enviado em Base64 no header Asset-Upload-Metadata.
const baseName = String(bin.fileName || 'spike-asset').replace(/\.[^.]+$/, '');
const assetName = ('spike-' + baseName).slice(0, 50);
const nameBase64 = Buffer.from(assetName, 'utf8').toString('base64');

return [{
  json: {
    route: ROUTE.NEXT,
    step: 'read_local_asset',
    ok: true,
    local_path: cfg.image_path,
    file_name: bin.fileName,
    mime_type: mime,
    bytes: bytes ?? null,
    asset_name: assetName,
    upload_metadata: JSON.stringify({ name_base64: nameBase64 }),
  },
  binary: { data: bin },
}];
`;

// Compartilhado pela resposta do POST (run 0) e pelos GETs de polling (runs 1..N).
export const F2_CHECK_UPLOAD = String.raw`// F2 · Check Upload Job (§22–§23)
const res = $input.first().json;
const attempt = $runIndex; // 0 = resposta do POST; 1..N = polling
const stage = attempt === 0 ? 'asset_upload' : 'asset_upload_polling';
const previous = attempt > 0 ? $('G0 · Wait Upload').first().json : null;
const image = $('E2 · Validate Local Image').first().json;
const knownJobId = previous ? previous.upload_job_id : undefined;

const retry = (jobId, reason) => {
  if (attempt >= cfg.poll.max_attempts) {
    return fail('asset_upload_polling', 'CANVA_ASSET_UPLOAD_TIMEOUT',
      'Upload não terminou após ' + attempt + ' consultas (' + cfg.poll.interval_seconds + 's cada).',
      { retryable: true, context: { job_id: jobId, last_reason: reason } });
  }
  return [{ json: { route: ROUTE.RETRY, step: stage, ok: true, upload_job_id: jobId, attempt, waiting_for: reason } }];
};

if (knownJobId && (isNetworkError(res) || res.statusCode === 429 || res.statusCode >= 500)) {
  return retry(knownJobId, isNetworkError(res) ? 'network_error' : 'http_' + res.statusCode);
}
if (isNetworkError(res) || res.statusCode < 200 || res.statusCode >= 300) {
  return httpFail(stage, res, 'CANVA_ASSET_UPLOAD_JOB_NOT_FOUND', { job_id: knownJobId });
}

const job = (parseBody(res) || {}).job || {};
if (!job.id) {
  return fail(stage, 'CANVA_UNEXPECTED_RESPONSE', 'Resposta do upload sem job.id.', { context: { http_status: res.statusCode } });
}

if (job.status === 'success') {
  const asset = job.asset || {};
  if (!asset.id) {
    return fail(stage, 'CANVA_UNEXPECTED_RESPONSE', 'Upload concluído sem job.asset.id.', { context: { job_id: job.id } });
  }
  return ok(cfg.mode === 'full' ? ROUTE.NEXT : ROUTE.DONE, 'asset_upload', {
    upload_job_id: job.id,
    canva_asset_id: asset.id,
    canva_asset_name: asset.name,
    local_path: image.local_path,
    attempts: attempt,
  });
}

if (job.status === 'failed') {
  const e = job.error || {};
  return fail(stage, 'CANVA_ASSET_UPLOAD_FAILED', 'O Canva recusou o upload: ' + (e.message || e.code || 'sem detalhes'),
    { context: { job_id: job.id, canva_error_code: e.code } });
}

return retry(job.id, job.status || 'unknown_status');
`;

export const F9_UPLOAD_RESULT = String.raw`// F9 · Resultado (upload_only)
const up = $input.first().json;
return [{
  json: {
    status: 'success',
    mode: 'upload_only',
    run_id: cfg.run_id,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
    asset: {
      local_path: up.local_path,
      canva_asset_id: up.canva_asset_id,
      name: up.canva_asset_name,
    },
    upload: { job_id: up.upload_job_id, polling_attempts: up.attempts },
    next_step: 'Publique o Brand Template de teste e rode com SPIKE_MODE=full.',
  },
}];
`;

export const H1_BUILD_REQUEST = String.raw`// H1 · Build Autofill Request (§24) — objeto intermediário validado antes do POST.
const up = $input.first().json;
const tpl = $('D2 · Validate Dataset').first().json;

const data = {
  COVER_IMAGE: { type: 'image', asset_id: up.canva_asset_id },
  HEADLINE: { type: 'text', text: cfg.headline },
  SUBHEADLINE: { type: 'text', text: cfg.subheadline },
  ...(cfg.extra_autofill_fields || {}),
};

const autofillRequest = {
  type: 'create_from_brand_template',
  brand_template_id: tpl.brand_template_id,
  title: cfg.design_title,
  data,
};

// Validação contra o dataset real do template.
const problems = [];
if (!autofillRequest.title || autofillRequest.title.length > 255) problems.push({ field: 'title', problem: 'deve ter entre 1 e 255 caracteres' });
for (const [name, value] of Object.entries(data)) {
  const expectedType = tpl.dataset[name];
  if (!expectedType) { problems.push({ field: name, problem: 'não existe no dataset do template' }); continue; }
  if (!value || value.type !== expectedType) { problems.push({ field: name, problem: 'tipo ' + (value && value.type) + ' != ' + expectedType }); continue; }
  if (value.type === 'text' && !String(value.text || '').trim()) problems.push({ field: name, problem: 'texto vazio' });
  if (value.type === 'image' && !String(value.asset_id || '').trim()) problems.push({ field: name, problem: 'asset_id vazio' });
}

if (problems.length) {
  return fail('autofill_request_validation', 'AUTOFILL_REQUEST_INVALID',
    'AutofillRequest inválido: ' + problems.map((p) => p.field + ' (' + p.problem + ')').join('; '),
    { context: { problems, dataset_fields: tpl.fields } });
}

const unfilled = tpl.fields.filter((f) => !(f in data));
return ok(ROUTE.NEXT, 'autofill_request_validation', {
  autofill_request: autofillRequest,
  unfilled_template_fields: unfilled,
  canva_asset_id: up.canva_asset_id,
  upload_job_id: up.upload_job_id,
});
`;

export const J1_CHECK_AUTOFILL = String.raw`// J1 · Check Autofill Job (§25–§26)
const res = $input.first().json;
const attempt = $runIndex; // 0 = resposta do POST; 1..N = polling
const stage = attempt === 0 ? 'autofill_create' : 'autofill_polling';
const previous = attempt > 0 ? $('J0 · Wait Autofill').first().json : null;
const knownJobId = previous ? previous.autofill_job_id : undefined;

const retry = (jobId, reason) => {
  if (attempt >= cfg.poll.max_attempts) {
    return fail('autofill_polling', 'CANVA_AUTOFILL_TIMEOUT',
      'Autofill não terminou após ' + attempt + ' consultas (' + cfg.poll.interval_seconds + 's cada).',
      { retryable: true, context: { job_id: jobId, last_reason: reason } });
  }
  return [{ json: { route: ROUTE.RETRY, step: stage, ok: true, autofill_job_id: jobId, attempt, waiting_for: reason } }];
};

if (knownJobId && (isNetworkError(res) || res.statusCode === 429 || res.statusCode >= 500)) {
  return retry(knownJobId, isNetworkError(res) ? 'network_error' : 'http_' + res.statusCode);
}
if (isNetworkError(res) || res.statusCode < 200 || res.statusCode >= 300) {
  const out = httpFail(stage, res, 'CANVA_AUTOFILL_JOB_NOT_FOUND', { job_id: knownJobId });
  if (res && res.statusCode === 403) {
    out[0].json.error.context.autofill_capability = 'BLOCKED_BY_PLAN';
    out[0].json.error.message = 'Autofill indisponível para esta conta/integração (exige Canva Enterprise ou acesso de desenvolvimento). ' +
      (out[0].json.error.context.canva_error_message || '');
  }
  return out;
}

const job = (parseBody(res) || {}).job || {};
if (!job.id) {
  return fail(stage, 'CANVA_UNEXPECTED_RESPONSE', 'Resposta do Autofill sem job.id.', { context: { http_status: res.statusCode } });
}

if (job.status === 'success') {
  const design = (job.result && job.result.design) || {};
  if (!design.id) {
    return fail(stage, 'CANVA_UNEXPECTED_RESPONSE', 'Autofill concluído sem result.design.id.', { context: { job_id: job.id } });
  }
  return ok(ROUTE.NEXT, 'autofill', {
    autofill_job_id: job.id,
    design_id: design.id,
    attempts: attempt,
  });
}

if (job.status === 'failed') {
  const e = job.error || {};
  return fail(stage, 'CANVA_AUTOFILL_FAILED', 'O Canva não conseguiu criar o design: ' + (e.message || e.code || 'sem detalhes'),
    { context: { job_id: job.id, canva_error_code: e.code } });
}

return retry(job.id, job.status || 'unknown_status');
`;

export const K2_RESULT = String.raw`// K2 · Check Design + monta o resultado final (§27–§28)
const res = $input.first().json;
const af = $('J1 · Check Autofill Job').last().json;
const req = $('H1 · Build Autofill Request').first().json;
const tpl = $('D2 · Validate Dataset').first().json;
const img = $('E2 · Validate Local Image').first().json;

if (isNetworkError(res) || res.statusCode !== 200) {
  return httpFail('design_lookup', res, 'DESIGN_NOT_FOUND', { design_id: af.design_id });
}
const design = (parseBody(res) || {}).design || {};
const urls = design.urls || {};

return ok(ROUTE.NEXT, 'design_lookup', {
  result: {
    status: 'success',
    mode: 'full',
    run_id: cfg.run_id,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
    autofill_capability: 'AVAILABLE_OR_DEVELOPMENT_TRIAL',
    source: { brand_template_id: tpl.brand_template_id, template_name: tpl.template_name, fields: tpl.fields },
    asset: { local_path: img.local_path, canva_asset_id: req.canva_asset_id, upload_job_id: req.upload_job_id },
    autofill: { job_id: af.autofill_job_id, polling_attempts: af.attempts, unfilled_template_fields: req.unfilled_template_fields },
    design: {
      id: design.id || af.design_id,
      title: design.title,
      page_count: design.page_count,
      // URLs temporárias: o identificador permanente é design.id (§27).
      edit_url: urls.edit_url,
      view_url: urls.view_url,
    },
  },
});
`;

export const K9_FINAL = String.raw`// K9 · Resultado Final — abra design.edit_url para validar no Canva (§39, teste 7).
return [{ json: $input.first().json.result }];
`;

export const M2_PREPARE_IMPORTS = String.raw`// M2 · Prepare Import Files — um item por arquivo, com Import-Metadata (§ design imports)
const MIME = {
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  ai: 'application/illustrator',
  psd: 'image/vnd.adobe.photoshop',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  key: 'application/vnd.apple.keynote',
};
const MAX_BYTES = 300 * 1024 * 1024;
const items = $input.all();

const errored = items.find((i) => i.json && i.json.error);
const files = items.filter((i) => i.binary && i.binary.data);
if (files.length === 0) {
  const detail = errored ? (typeof errored.json.error === 'string' ? errored.json.error : (errored.json.error.message || '')) : '';
  return fail('read_import_files', 'IMPORT_FILES_NOT_FOUND',
    'Nenhum arquivo para importar em ' + cfg.import_glob + (detail ? ' (' + detail + ')' : '') + '.',
    { context: { import_glob: cfg.import_glob } });
}
if (files.length > 10) {
  return fail('read_import_files', 'IMPORT_TOO_MANY_FILES', 'Encontrados ' + files.length + ' arquivos; o teste aceita no máximo 10 (limite de 20 imports/min do Canva).',
    { context: { import_glob: cfg.import_glob } });
}

const out = [];
const skipped = [];
for (const item of files) {
  const bin = item.binary.data;
  const fileName = bin.fileName || 'arquivo';
  const ext = String(bin.fileExtension || fileName.split('.').pop() || '').toLowerCase();
  const mime = MIME[ext];
  const bytes = typeof bin.bytes === 'number' ? bin.bytes : null;
  if (!mime) { skipped.push({ file_name: fileName, reason: 'extensão não suportada: ' + ext }); continue; }
  if (bytes !== null && bytes > MAX_BYTES) { skipped.push({ file_name: fileName, reason: 'maior que 300 MB' }); continue; }
  // Título do design no Canva: até 50 caracteres (antes do Base64).
  const title = ('IMPORT TESTE - ' + fileName.replace(/\.[^.]+$/, '')).slice(0, 50);
  out.push({
    json: {
      route: ROUTE.NEXT,
      step: 'read_import_files',
      ok: true,
      file_name: fileName,
      mime_type: mime,
      bytes,
      title,
      import_metadata: JSON.stringify({ title_base64: Buffer.from(title, 'utf8').toString('base64'), mime_type: mime }),
      skipped,
    },
    // O HTTP Request envia o Content-Type do binário; forçamos octet-stream como a API pede.
    binary: { data: { ...bin, mimeType: 'application/octet-stream' } },
  });
}
if (out.length === 0) {
  return fail('read_import_files', 'IMPORT_FILES_UNSUPPORTED', 'Nenhum arquivo com formato suportado.', { context: { skipped } });
}
return out;
`;

// Agregador do polling: recebe N respostas (POST na 1ª execução, GET nas seguintes)
// e devolve UM item com o estado de todos os jobs.
export const M5_CHECK_IMPORTS = String.raw`// M5 · Check Import Jobs
const responses = $input.all();
const attempt = $runIndex; // 0 = respostas dos POST; 1..N = polling
const previous = attempt === 0
  ? $('M2 · Prepare Import Files').all().map((i) => ({ file_name: i.json.file_name, mime_type: i.json.mime_type, bytes: i.json.bytes, title: i.json.title, status: 'pending' }))
  : $('M7 · Expand Pending Jobs').all().map((i) => i.json);
const skipped = attempt === 0 ? ($('M2 · Prepare Import Files').first().json.skipped || []) : $('M6 · Wait Import').first().json.skipped;
const carried = attempt === 0 ? [] : $('M6 · Wait Import').first().json.jobs.filter((j) => j.status === 'success' || j.status === 'failed');

const classify = (res) => {
  if (isNetworkError(res)) return { kind: 'transient', reason: 'network_error' };
  if (res.statusCode === 429 || res.statusCode >= 500) return { kind: 'transient', reason: 'http_' + res.statusCode };
  if (res.statusCode < 200 || res.statusCode >= 300) return { kind: 'http_error' };
  return { kind: 'ok' };
};

const jobs = previous.map((prev, idx) => {
  const res = responses[idx] ? responses[idx].json : undefined;
  const c = classify(res);
  if (c.kind === 'transient') {
    // No POST, erro transitório = não criou job: marca como falha retryable.
    if (!prev.job_id) return { ...prev, status: 'failed', error: { code: 'CANVA_IMPORT_CREATE_FAILED', message: 'Falha temporária ao criar a importação (' + c.reason + ').', retryable: true } };
    return { ...prev, status: 'in_progress', last_reason: c.reason };
  }
  if (c.kind === 'http_error') {
    const e = httpFail(attempt === 0 ? 'design_import_create' : 'design_import_polling', res, 'CANVA_IMPORT_JOB_NOT_FOUND', { file_name: prev.file_name })[0].json.error;
    if (res.statusCode === 403) e.context.import_capability = 'BLOCKED';
    return { ...prev, status: 'failed', error: e };
  }
  const job = (parseBody(res) || {}).job || {};
  if (!job.id) return { ...prev, status: 'failed', error: { code: 'CANVA_UNEXPECTED_RESPONSE', message: 'Resposta sem job.id.' } };
  const base = { ...prev, job_id: job.id, status: job.status || 'in_progress' };
  if (job.status === 'success') {
    const designs = ((job.result && job.result.designs) || []).map((d) => ({
      id: d.id,
      title: d.title,
      page_count: d.page_count,
      edit_url: d.urls && d.urls.edit_url,
      view_url: d.urls && d.urls.view_url,
      thumbnail: d.thumbnail ? { width: d.thumbnail.width, height: d.thumbnail.height } : undefined,
    }));
    return { ...base, designs };
  }
  if (job.status === 'failed') {
    const e = job.error || {};
    return { ...base, error: { code: 'CANVA_IMPORT_FAILED', message: 'O Canva não conseguiu importar: ' + (e.message || e.code || 'sem detalhes'), canva_error_code: e.code } };
  }
  return base;
});

const all = [...carried, ...jobs];
const pending = all.filter((j) => j.status !== 'success' && j.status !== 'failed');

if (pending.length && attempt < cfg.poll.max_attempts) {
  return [{ json: { route: ROUTE.RETRY, step: 'design_import_polling', ok: true, attempt, pending: pending.length, jobs: all, skipped } }];
}

// Terminou (ou estourou o limite de tentativas).
const finalJobs = all.map((j) => (j.status === 'success' || j.status === 'failed')
  ? j
  : { ...j, status: 'failed', error: { code: 'CANVA_IMPORT_TIMEOUT', message: 'Importação não terminou após ' + attempt + ' consultas.', retryable: true } });
const succeeded = finalJobs.filter((j) => j.status === 'success');

if (succeeded.length === 0) {
  const blocked = finalJobs.every((j) => j.error && j.error.context && j.error.context.import_capability === 'BLOCKED');
  return fail(blocked ? 'design_import_create' : 'design_import', blocked ? 'CANVA_PERMISSION_OR_PLAN_ERROR' : 'CANVA_IMPORT_ALL_FAILED',
    blocked ? 'O Canva recusou a importação de designs para esta conta/integração (403).' : 'Nenhum arquivo foi importado.',
    { context: { jobs: finalJobs, skipped } });
}

return [{ json: {
  route: ROUTE.NEXT,
  step: 'design_import',
  ok: true,
  result: {
    status: succeeded.length === finalJobs.length ? 'success' : 'partial',
    mode: 'import',
    run_id: cfg.run_id,
    started_at: cfg.started_at,
    finished_at: new Date().toISOString(),
    polling_attempts: attempt,
    imported: succeeded.length,
    failed: finalJobs.length - succeeded.length,
    files: finalJobs.map((j) => ({
      file_name: j.file_name,
      status: j.status,
      job_id: j.job_id,
      designs: j.designs,
      error: j.error,
    })),
    skipped,
    next_step: 'Abra cada edit_url (válida por 30 dias) e avalie: texto em caixas editáveis, fontes, foto substituível e layout.',
  },
} }];
`;

export const M7_EXPAND_PENDING = String.raw`// M7 · Expand Pending Jobs — um item por job ainda em andamento
return $input.first().json.jobs
  .filter((j) => j.status !== 'success' && j.status !== 'failed')
  .map((j) => ({ json: j }));
`;
