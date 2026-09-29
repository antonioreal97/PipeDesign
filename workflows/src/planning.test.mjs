import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisToText, imageDimensions, normalizeAssetAnalysis, normalizeAssetPath, sha256Bytes, validateAssetAnalysis } from './asset-index.mjs';
import { applyApprovedCopy, attachStockCredits, briefEmbeddingText, buildStockSceneRequests, filterAssetCandidates, filterMissingStockScenes, mergeAssetCandidates, normalizePlanForRenderer, parseChatJson, validatePlanEnvelope } from './creative-planning.mjs';

test('sha256 puro coincide com node:crypto', () => {
  const bytes = new TextEncoder().encode('PipeDesign exemplo');
  assert.equal(sha256Bytes(bytes), createHash('sha256').update(bytes).digest('hex'));
});

test('lê dimensões de PNG', () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  new DataView(bytes.buffer).setUint32(16, 1080, false);
  new DataView(bytes.buffer).setUint32(20, 1350, false);
  assert.deepEqual(imageDimensions(bytes), { width: 1080, height: 1350 });
});

test('normaliza path relativo e bloqueia saída do cliente', () => {
  const root = '/workspace/clients/exemplo';
  assert.equal(normalizeAssetPath(root + '/Fotos/MASCULINO', 'a.jpg', root), 'Fotos/MASCULINO/a.jpg');
  assert.throws(() => normalizeAssetPath('/tmp', 'a.jpg', root), /fora do workspace/);
  assert.throws(() => normalizeAssetPath(root + '/Fotos', 'a.jpg'), /clientRoot é obrigatório/);
});

const analysis = {
  asset_type: 'campaign',
  subjects: ['male_model'],
  products: ['polo'],
  dominant_colors: ['gray'],
  background: 'neutral_studio',
  shot_type: 'full_body',
  composition: { subject_position: 'right', negative_space: { left: 'high', right: 'low', top: 'medium', bottom: 'low' } },
  style_keywords: ['editorial'],
  suitable_for: ['carousel_cover'],
};

test('valida e transforma análise em texto', () => {
  assert.equal(validateAssetAnalysis(analysis).ok, true);
  assert.match(analysisToText(analysis, 'Fotos/a.jpg'), /posição: right/);
});

test('normaliza listas repetidas produzidas pelo modelo visual local', () => {
  const duplicated = { ...analysis, suitable_for: ['product_closeup', 'product_closeup', 'story'] };
  assert.deepEqual(normalizeAssetAnalysis(duplicated).suitable_for, ['product_closeup', 'story']);
});

test('filtro avoid_center remove candidatos centrais', () => {
  const rows = [
    { file_path: 'Fotos/center.jpg', similarity: 0.9, analysis_json: { composition: { subject_position: 'center' } } },
    { file_path: 'Fotos/right.jpg', similarity: 0.8, analysis_json: { composition: { subject_position: 'right' } } },
  ];
  const result = filterAssetCandidates(rows, { asset_constraints: { avoid_subject_position: ['center'] } });
  assert.deepEqual(result.candidates.map((item) => item.file_path), ['Fotos/right.jpg']);
});

test('fallback aprovado recupera candidatos filtrados', () => {
  const rows = [{ file_path: 'Fotos/center.jpg', analysis_json: { composition: { subject_position: 'center' } } }];
  const result = filterAssetCandidates(rows, {
    asset_constraints: { avoid_subject_position: ['center'] },
    production: { fallback_if_missing_assets: 'approved_alternatives_only' },
  });
  assert.equal(result.usedFallback, true);
  assert.equal(result.candidates.length, 1);
});

test('gera buscas de cenas preservando capa e assinatura para assets da marca', () => {
  const scenes = buildStockSceneRequests({
    slides: 4,
    slide_copy: [
      { slide: 1, copy: 'Capa' },
      { slide: 2, copy: '6:45\nTreino' },
      { slide: 3, copy: '8:00\nDaily com a equipe' },
      { slide: 4, copy: 'Assinatura' },
    ],
  }, 7);
  assert.deepEqual(scenes.map((item) => [item.slide, item.scene]), [[2, 'treino'], [3, 'reunião de trabalho']]);
  assert.equal(scenes[0].query, 'man workout at gym');
  assert.ok(scenes[0].relevance_terms.includes('gym'));
  assert.equal(scenes[0].color, '');
});

test('mescla fotos locais antes das externas e elimina duplicatas', () => {
  const result = mergeAssetCandidates(
    [{ path: 'Fotos/local.jpg', source: 'local' }],
    [{ path: 'Fotos/local.jpg', source: 'pexels' }, { path: 'Fotos/BANCO/PEXELS/10.jpg', source: 'pexels' }],
  );
  assert.deepEqual(result.map((item) => item.path), ['Fotos/local.jpg', 'Fotos/BANCO/PEXELS/10.jpg']);
});

test('só busca no banco quando a cena não está comprovada nos assets locais', () => {
  const scenes = [
    { slide: 2, scene: 'treino' },
    { slide: 3, scene: 'reunião de trabalho' },
  ];
  const missing = filterMissingStockScenes(scenes, [
    { analysis: { background: 'modern gym', style_keywords: ['fitness'] } },
    { analysis: { background: 'neutral_studio' } },
  ]);
  assert.deepEqual(missing, [{ slide: 3, scene: 'reunião de trabalho' }]);
});

test('texto de embedding inclui campanha, produto, copy e produção', () => {
  const text = briefEmbeddingText({
    objective: 'product_highlight', visual_direction: ['editorial'],
    campaign: { title: 'All day', concept: 'um dia', key_message: 'acompanha você' },
    product: { name: 'Polo', sku: 'EX-001' },
    slide_copy: [{ slide: 1, copy: 'Capa' }],
    production: { asset_requirements: 'mesmo homem' },
  });
  assert.match(text, /EX-001/);
  assert.match(text, /mesmo homem/);
});

test('parseia JSON da resposta de Chat Completions', () => {
  assert.deepEqual(parseChatJson({ statusCode: 200, body: { choices: [{ message: { content: '{"ok":true}' } }] } }), { ok: true });
});

test('normaliza aliases do modelo para o contrato do renderer', () => {
  const plan = normalizePlanForRenderer({
    job_id: 'c0a80100-0000-4000-8000-000000000005',
    brand: 'exemplo',
    title: 'All day',
    slides: [
      { layout: 'capa_manchete', image: 'Fotos/a.jpg', copy: 'Um dia inteiro com a mesma peça\nPeças que te acompanham' },
      { layout: 'foto_nota', image: 'Fotos/b.jpg', copy: '6:45\nTreino' },
      { layout: 'manifesto_assinatura', copy: 'A Marca Exemplo está com você.' },
    ],
  });

  assert.deepEqual(plan.slides, [
    { layout: 'capa_manchete', photo: 'Fotos/a.jpg', headline: 'Um dia inteiro com a mesma peça', box: 'Peças que te acompanham' },
    { layout: 'foto_nota', photo: 'Fotos/b.jpg', paragraphs: ['6:45', 'Treino'] },
    { layout: 'manifesto_assinatura', lines: ['A Marca Exemplo está com você.'] },
  ]);
});

test('remove wrapper original_plan devolvido no repair', () => {
  const original = { job_id: 'id', brand: 'exemplo', title: 'Plano', slides: [] };
  assert.deepEqual(normalizePlanForRenderer({ original_plan: original }), original);
});

test('copy aprovada substitui qualquer reescrita do modelo', () => {
  const plan = applyApprovedCopy({ slides: [
    { layout: 'capa_manchete', photo: 'Fotos/a.jpg', headline: 'Resumo alterado', kicker: 'Extra' },
    { layout: 'moodboard_cena', scene: { photo: 'Fotos/b.jpg' }, product: { photo: 'Fotos/a.jpg' },
      detail: { photo: 'Fotos/a.jpg' }, time: '20:00', lines: ['Reescrita'] },
    { layout: 'manifesto_assinatura', lines: ['Resumo alterado'], tagline: 'Extra' },
  ] }, {
    campaign: { copy_status: 'approved_locked' },
    slide_copy: [
      { slide: 1, copy: 'Um dia inteiro com a mesma peça\nPeças que te acompanham do pré-treino ao jantar' },
      { slide: 2, copy: '19:00\nAlmoço em família' },
      { slide: 3, copy: 'A Marca Exemplo está com você em todos os seus momentos do dia!' },
    ],
  });

  assert.deepEqual(plan.slides, [
    { layout: 'capa_manchete', photo: 'Fotos/a.jpg', headline: 'Um dia inteiro com a mesma peça', box: 'Peças que te acompanham do pré-treino ao jantar' },
    { layout: 'moodboard_cena', scene: { photo: 'Fotos/b.jpg' }, product: { photo: 'Fotos/a.jpg' },
      detail: { photo: 'Fotos/a.jpg' }, time: '19:00', lines: ['Almoço em família'] },
    { layout: 'manifesto_assinatura', lines: ['A Marca Exemplo está com você em todos os seus momentos do dia!'] },
  ]);
});

test('anexa crédito somente para fotos Pexels realmente escolhidas', () => {
  const plan = attachStockCredits({ slides: [
    { layout: 'foto_nota', photo: 'Fotos/local.jpg', paragraphs: ['Local'] },
    { layout: 'foto_nota', photo: 'Fotos/BANCO/PEXELS/10.jpg', paragraphs: ['Cena'] },
  ] }, [
    { path: 'Fotos/local.jpg', source: 'local' },
    { path: 'Fotos/BANCO/PEXELS/10.jpg', source: 'pexels', attribution: { provider: 'Pexels', provider_url: 'https://www.pexels.com', photo_url: 'https://www.pexels.com/photo/10/', photographer: 'Fotógrafo', photographer_url: 'https://www.pexels.com/@fotografo' } },
    { path: 'Fotos/BANCO/PEXELS/11.jpg', source: 'pexels', attribution: { provider: 'Pexels' } },
  ]);
  assert.equal(plan.credits.length, 1);
  assert.equal(plan.credits[0].file_path, 'Fotos/BANCO/PEXELS/10.jpg');
});

test('envelope do plano exige quantidade e fotos candidatas', () => {
  const job = { job_id: 'c0a80100-0000-4000-8000-000000000005', brand_id: 'exemplo', brief: { slides: 2 } };
  const plan = { job_id: job.job_id, brand: 'exemplo', slides: [
    { layout: 'capa_manchete', photo: 'Fotos/a.jpg' },
    { layout: 'foto_nota', photo: 'Fotos/inventada.jpg' },
  ] };
  const result = validatePlanEnvelope(plan, job, ['Fotos/a.jpg']);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /inventada/);
});
