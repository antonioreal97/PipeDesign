import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(join(here, 'asset-index.mjs'), 'utf8').replace(/^export /gm, '');
const assetSchema = JSON.parse(readFileSync(join(here, '../../schemas/asset-analysis.schema.json'), 'utf8'));
for (const key of ['$schema', '$id', 'title', 'description']) delete assetSchema[key];

const HELPERS = `const ROUTE = { NEXT: 0, SKIP: 1, FAIL: 2 };
function fail(stage, code, message, context = {}) {
  return [{ json: { route: ROUTE.FAIL, ok: false, step: stage, error: { status: 'failed', stage, code, message, retryable: false, context } } }];
}
`;

export const CONFIG = `${HELPERS}
const brandSlug = String($env.ASSET_INDEX_BRAND || 'exemplo');
const brandRow = $input.first().json || {};
if (brandRow.error) return fail('config', 'BRAND_LOAD_FAILED', brandRow.error.message || String(brandRow.error), { brand_id: brandSlug });
if (!brandRow.slug || !brandRow.workspace_path) {
  return fail('config', 'BRAND_NOT_FOUND', 'Marca ' + brandSlug + ' não encontrada na tabela brands ou sem workspace_path.', { brand_id: brandSlug });
}
const clientRoot = String(brandRow.workspace_path).replace(/\\\/$/, '');
const limit = Number($env.ASSET_INDEX_LIMIT || 3);
const fileGlob = String($env.ASSET_INDEX_GLOB || clientRoot + '/Fotos/*.jpg');
const ollamaBase = String($env.OLLAMA_BASE_URL || $env.LOCAL_VISION_BASE_URL || 'http://ollama:11434').replace(/\\\/$/, '');
if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
  return fail('config', 'CONFIG_INVALID', 'ASSET_INDEX_LIMIT deve ser inteiro entre 1 e 50.');
}
if (!fileGlob.startsWith(clientRoot + '/Fotos/')) {
  return fail('config', 'CONFIG_INVALID', 'ASSET_INDEX_GLOB deve ficar dentro de ' + clientRoot + '/Fotos/.', { brand_id: brandSlug, file_glob: fileGlob });
}
if (!/^http:\\/\\/(ollama|host\\.docker\\.internal|127\\.0\\.0\\.1|localhost)(:\\d+)?$/i.test(ollamaBase)) {
  return fail('config', 'OLLAMA_URL_INVALID', 'OLLAMA_BASE_URL deve apontar para um host local permitido. Não há fallback externo.', { ollama_base_url: ollamaBase });
}
return [{ json: {
  route: ROUTE.NEXT, ok: true, step: 'config', brand_id: brandRow.slug, brand_name: brandRow.name, client_root: clientRoot,
  file_glob: fileGlob, limit,
  ollama_base_url: ollamaBase,
  vision_model: $env.LOCAL_VISION_MODEL || 'gemma3:4b',
  embedding_model: $env.LOCAL_EMBEDDING_MODEL || 'embeddinggemma',
  embedding_dimensions: 768,
} }];
`;

export const PREPARE_FILES = `${lib}
${HELPERS}
const cfg = $('A2 · Index Config').first().json;
const item = $input.first();
if (!item.binary || !item.binary.data) {
  return [{ json: { route: ROUTE.FAIL, ok: false, step: 'read_assets', error: {
    status: 'failed', stage: 'read_assets', code: 'ASSET_FILES_NOT_FOUND',
    message: 'Nenhuma foto encontrada para o glob configurado.', retryable: false,
    context: { file_glob: cfg.file_glob },
  } } }];
}
const bin = item.binary.data;
// This node runs once per item, so index zero is always the current binary.
// Processing each file in isolation avoids n8n's ambiguous paired-item links
// produced by a multi-file Read/Write Files node.
const bytes = await this.helpers.getBinaryDataBuffer(0, 'data');
const fileName = bin.fileName || ('asset-' + $itemIndex + '.jpg');
const filePath = normalizeAssetPath(bin.directory, fileName, cfg.client_root);
const mime = bin.mimeType || (fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
const dimensions = imageDimensions(bytes);
const imageBase64 = Buffer.from(bytes).toString('base64');
return [{ json: {
  route: ROUTE.NEXT, ok: true, step: 'prepare_asset', brand_id: cfg.brand_id,
  file_path: filePath, file_name: fileName, mime_type: mime,
  width: dimensions.width, height: dimensions.height,
  orientation: dimensions.width && dimensions.height ? (dimensions.width === dimensions.height ? 'square' : dimensions.width > dimensions.height ? 'landscape' : 'portrait') : null,
  sha256: sha256Bytes(bytes),
  vision_request: {
    model: cfg.vision_model,
    messages: [
      { role: 'system', content: 'Analise a foto para seleção de assets de design. Descreva somente o que está visível e responda estritamente no JSON Schema fornecido.' },
      { role: 'user', content: 'Marca ' + cfg.brand_name + '. Arquivo: ' + filePath + '. Identifique produto, pessoa, composição, espaço negativo e usos adequados.', images: [imageBase64] },
    ],
    format: ${JSON.stringify(assetSchema)},
    stream: false,
    options: { temperature: 0, num_predict: 800 },
  },
} }];
`;

export const CHECK_EXISTING = `${HELPERS}
const source = $('B2 · Prepare Files').item.json;
const payload = $input.first().json || {};
if (payload.error) return fail('asset_lookup', 'ASSET_LOOKUP_FAILED', payload.error.message || String(payload.error), { file_path: source.file_path });
if (payload.id) return [{ json: { route: ROUTE.SKIP, ok: true, step: 'asset_skip', status: 'skipped', asset_id: payload.id, file_path: source.file_path, sha256: source.sha256 } }];
return [{ json: { ...source, route: ROUTE.NEXT } }];
`;

export const PARSE_ANALYSIS = `${lib}
${HELPERS}
const source = $('C2 · Existing?').item.json;
const response = $input.first().json || {};
if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
  return fail('vision', 'LOCAL_VISION_ERROR', response.body?.error || ('Ollama HTTP ' + (response.statusCode || 'sem status')), { file_path: source.file_path, model: $env.LOCAL_VISION_MODEL || 'gemma3:4b' });
}
let analysis;
try { analysis = normalizeAssetAnalysis(JSON.parse(response.body?.message?.content || '')); }
catch (error) { return fail('vision', 'ANALYSIS_INVALID', 'Resposta do modelo visual local não é JSON válido: ' + error.message, { file_path: source.file_path }); }
const check = validateAssetAnalysis(analysis);
if (!check.ok) return fail('vision', 'ANALYSIS_INVALID', check.errors.join('; '), { file_path: source.file_path });
const analysisText = analysisToText(analysis, source.file_path);
return [{ json: {
  route: ROUTE.NEXT, ok: true, step: 'vision',
  brand_id: source.brand_id, file_path: source.file_path, file_name: source.file_name,
  mime_type: source.mime_type, width: source.width, height: source.height, orientation: source.orientation,
  sha256: source.sha256, analysis, analysis_text: analysisText, category: analysis.asset_type,
  embedding_request: { model: $env.LOCAL_EMBEDDING_MODEL || 'embeddinggemma', input: analysisText, truncate: true },
} }];
`;

export const PARSE_EMBEDDING = `${HELPERS}
const source = $('D2 · Parse Analysis').item.json;
const response = $input.first().json || {};
if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
  return fail('embedding', 'LOCAL_EMBEDDING_ERROR', response.body?.error || ('Ollama HTTP ' + (response.statusCode || 'sem status')), { file_path: source.file_path, model: $env.LOCAL_EMBEDDING_MODEL || 'embeddinggemma' });
}
const embedding = response.body?.embeddings?.[0];
if (!Array.isArray(embedding) || embedding.length !== 768 || embedding.some((v) => typeof v !== 'number')) {
  return fail('embedding', 'EMBEDDING_INVALID', 'Embedding local deve ter 768 números.', { file_path: source.file_path, dimensions: Array.isArray(embedding) ? embedding.length : null });
}
return [{ json: { ...source, route: ROUTE.NEXT, step: 'embedding', embedding_vector: '[' + embedding.join(',') + ']' } }];
`;

export const CHECK_INSERT = `${HELPERS}
const source = $('E2 · Parse Embedding').item.json;
const payload = $input.first().json || {};
if (payload.error || !payload.id) return fail('persist_asset', 'ASSET_PERSIST_FAILED', payload.error?.message || 'INSERT não retornou asset.', { file_path: source.file_path });
return [{ json: { route: ROUTE.NEXT, ok: true, step: 'persist_asset', status: 'indexed', asset_id: payload.id, file_path: payload.file_path, sha256: payload.sha256 } }];
`;
