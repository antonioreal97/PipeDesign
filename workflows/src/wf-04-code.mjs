import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const lib = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'job-brief.mjs'), 'utf8')
  .replace(/^export /gm, '');

const HELPERS = `const ROUTE = { NEXT: 0, FAIL: 2 };

function fail(stage, code, message, opts = {}) {
  return [{
    json: {
      route: ROUTE.FAIL,
      step: stage,
      ok: false,
      error: {
        status: 'failed',
        stage,
        code,
        message,
        retryable: Boolean(opts.retryable),
        context: opts.context || {},
      },
    },
  }];
}
`;

export const MAP_NODE = 'B1 · Map JobBrief';

export const B1_MAP = `${lib}

${HELPERS}
const form = $input.first().json;
const result = buildJobBriefFromForm(form, {
  jobId: uuidV4(),
  createdAt: new Date().toISOString(),
});
if (!result.ok) {
  return fail('map_brief', 'BRIEF_INVALID', result.error.message, { context: result.error.context || {} });
}
const brief = result.brief;
return [{
  json: {
    route: ROUTE.NEXT,
    step: 'map_brief',
    ok: true,
    job_id: brief.job_id,
    brand_id: brief.brand_id,
    status: brief.status,
    content_type: brief.content_type,
    brief,
    brief_path: '/workspace/jobs/' + brief.job_id + '.json',
  },
}];
`;

export const C2_CHECK_INSERT = `${HELPERS}
const mapped = $('${MAP_NODE}').first().json;
const item = $input.first();
const payload = item && item.json ? item.json : {};

if (payload.error) {
  const detail = typeof payload.error === 'string' ? payload.error : (payload.error.message || JSON.stringify(payload.error));
  return fail('persist_job', 'BRIEF_PERSIST_FAILED', 'Falha ao gravar o job no Postgres: ' + detail, {
    retryable: true,
    context: { brand_id: mapped.brand_id, job_id: mapped.job_id },
  });
}

if (!payload.id) {
  return fail('persist_job', 'BRAND_NOT_FOUND',
    'Marca não encontrada no banco: ' + mapped.brand_id + '. Rode db/migrate.sh e insira a marca na tabela brands.',
    { context: { brand_id: mapped.brand_id, job_id: mapped.job_id } });
}

const binary = await this.helpers.prepareBinaryData(
  Buffer.from(JSON.stringify(mapped.brief, null, 2) + '\\n', 'utf8'),
  mapped.job_id + '.json',
  'application/json',
);

return [{
  json: {
    route: ROUTE.NEXT,
    step: 'persist_job',
    ok: true,
    job_id: mapped.job_id,
    brand_id: mapped.brand_id,
    status: mapped.status,
    content_type: mapped.content_type,
    brief: mapped.brief,
    brief_path: mapped.brief_path,
    db_id: payload.id,
  },
  binary: { data: binary },
}];
`;

export const D2_CHECK_WRITE = `${HELPERS}
const mapped = $('${MAP_NODE}').first().json;
const item = $input.first();
const payload = item && item.json ? item.json : {};

if (payload.error) {
  const detail = typeof payload.error === 'string' ? payload.error : (payload.error.message || JSON.stringify(payload.error));
  return fail('write_brief', 'BRIEF_WRITE_FAILED',
    'Job gravado no Postgres, mas falhou escrever ' + mapped.brief_path + ': ' + detail,
    { retryable: true, context: { job_id: mapped.job_id, brief_path: mapped.brief_path } });
}

const written = payload.fileName || mapped.brief_path;
return [{
  json: {
    route: ROUTE.NEXT,
    step: 'write_brief',
    ok: true,
    job_id: mapped.job_id,
    brand_id: mapped.brand_id,
    status: mapped.status,
    content_type: mapped.content_type,
    brief: mapped.brief,
    brief_path: mapped.brief_path,
    fileName: written,
  },
}];
`;
