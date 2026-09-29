import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobBriefFromForm, validateJobBrief, uuidV4, UUID_RE } from './job-brief.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(
  readFileSync(join(here, '../../schemas/examples/job-brief.valid.json'), 'utf8'),
);

const FIXED = {
  jobId: 'c0a80100-0000-4000-8000-000000000001',
  createdAt: '2026-09-17T15:00:00.000Z',
};

function formPt(overrides = {}) {
  return {
    Marca: 'exemplo',
    'Tipo de peça': 'Carrossel',
    'Telas do carrossel': 5,
    Canal: 'Instagram Feed',
    'Motivo do post': 'Lançamento de coleção',
    'Abordagem visual': ['Editorial', 'Foto dominante'],
    'Evitar sujeito no centro': ['Evitar sujeito no centro'],
    ...overrides,
  };
}

test('uuidV4 casa com o contrato de job_id', () => {
  assert.match(uuidV4(), UUID_RE);
});

test('exemplo da spec passa na validação', () => {
  const check = validateJobBrief(example);
  assert.equal(check.ok, true, check.errors.join('; '));
});

test('form em português vira o JobBrief da spec', () => {
  const result = buildJobBriefFromForm(formPt(), FIXED);
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.deepEqual(result.brief, example);
});

test('aceita field names em inglês', () => {
  const result = buildJobBriefFromForm({
    brand_id: 'exemplo',
    content_type: 'carousel',
    slides: 5,
    channel: 'instagram_feed',
    objective: 'collection_launch',
    visual_direction: ['editorial', 'photo_dominant'],
    avoid_center: true,
  }, FIXED);
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.deepEqual(result.brief, example);
});

test('rejeita telas abaixo do mínimo', () => {
  const result = buildJobBriefFromForm(formPt({ 'Telas do carrossel': 1 }), FIXED);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /entre 2 e 10/);
});

test('rejeita telas acima do máximo', () => {
  const result = buildJobBriefFromForm(formPt({ 'Telas do carrossel': 11 }), FIXED);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /entre 2 e 10/);
});

test('rejeita abordagem vazia', () => {
  const result = buildJobBriefFromForm(formPt({ 'Abordagem visual': [] }), FIXED);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /abordagem visual/);
});

test('rejeita marca fora do formato de slug', () => {
  const result = buildJobBriefFromForm(formPt({ Marca: 'Marca Exemplo' }), FIXED);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /marca inválida/);
});

test('rejeita motivo desconhecido', () => {
  const result = buildJobBriefFromForm(formPt({ 'Motivo do post': 'viralizar' }), FIXED);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /motivo do post/);
});

test('omite asset_constraints quando não há restrições', () => {
  const result = buildJobBriefFromForm(formPt({
    'Evitar sujeito no centro': [],
    'Outras restrições': '  ',
  }), FIXED);
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.brief.asset_constraints, undefined);
});

test('textarea de restrições vira asset_constraints.notes', () => {
  const result = buildJobBriefFromForm(formPt({
    'Evitar sujeito no centro': [],
    'Outras restrições': 'preferir modelo lateral',
  }), FIXED);
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.deepEqual(result.brief.asset_constraints, { notes: 'preferir modelo lateral' });
});

test('checkboxes no formato objeto { label: true }', () => {
  const result = buildJobBriefFromForm(formPt({
    'Abordagem visual': { Editorial: true, 'Pouco texto': false, 'Foto dominante': true },
  }), FIXED);
  assert.equal(result.ok, true, result.error && result.error.message);
  assert.deepEqual(result.brief.visual_direction, ['editorial', 'photo_dominant']);
});

test('demanda completa preserva referências, produto, produção e copy por tela', () => {
  const result = buildJobBriefFromForm(formPt({
    'Telas do carrossel': 9,
    'Motivo do post': 'Destaque de produto',
    'Abordagem visual': ['Editorial', 'Foto dominante', 'Pouco texto'],
    'Título da demanda': 'Um dia inteiro com a mesma peça',
    'Conceito criativo': 'Acompanhar o mesmo homem com a mesma polo do pré-treino ao jantar.',
    'Mensagem principal': 'Peças que acompanham todos os momentos do dia.',
    'Status da copy': 'Aprovada — não alterar',
    'CTA / fechamento': 'A Marca Exemplo está com você em todos os seus momentos do dia!',
    'Referências visuais (uma URL por linha)': [
      'https://www.instagram.com/p/EXEMPLO001/?img_index=1&igsi=abc123',
      'https://www.instagram.com/p/EXEMPLO002/?img_index=1',
    ].join('\n'),
    'Nome do produto': 'Polo Básica',
    'SKU / código do produto': 'EX-001-CINZA',
    'Cor / variação': 'Cinza',
    'Link do produto': 'https://www.example.com/produto/ex-001-cinza',
    'Roteiro por tela': [
      'Tela 1: Um dia inteiro com a mesma peça\nPeças que te acompanham do pré-treino ao jantar',
      'Tela 2: 6:00\nAcordar\nChecar agenda\nPré-treino',
      'Tela 3: 6:45\nTreino',
      'Tela 4: 8:00\nDaily com a equipe\nResponder e-mails',
      'Tela 5: 9:00\nFoco no trabalho',
      'Tela 6: 13:00\nPausa para o almoço',
      'Tela 7: 16:00\nAula de tênis',
      'Tela 8: 19:00\nJantar em família',
      'Tela 9: A Marca Exemplo está com você em todos os seus momentos do dia!',
    ].join('\n\n'),
    'Continuidade de modelo/personagem': 'Mesma pessoa em todas as telas',
    'Cenas e assets obrigatórios': 'Mesmo homem usando a Polo Básica em todas as situações.',
    'Se faltarem fotos': 'Interromper e pedir os assets',
    'Evitar sujeito no centro': [],
  }), FIXED);

  assert.equal(result.ok, true, result.error && result.error.message);
  assert.equal(result.brief.campaign.copy_status, 'approved_locked');
  assert.equal(result.brief.references.length, 2);
  assert.deepEqual(result.brief.product, {
    name: 'Polo Básica',
    sku: 'EX-001-CINZA',
    color: 'Cinza',
    url: 'https://www.example.com/produto/ex-001-cinza',
  });
  assert.equal(result.brief.slide_copy.length, 9);
  assert.equal(result.brief.slide_copy[1].copy, '6:00\nAcordar\nChecar agenda\nPré-treino');
  assert.deepEqual(result.brief.production, {
    subject_continuity: 'same_person_all_slides',
    asset_requirements: 'Mesmo homem usando a Polo Básica em todas as situações.',
    fallback_if_missing_assets: 'stop_and_request_assets',
  });
});

test('rejeita roteiro com quantidade diferente do número de telas', () => {
  const result = buildJobBriefFromForm(formPt({
    'Roteiro por tela': 'Tela 1: Capa\nTela 2: Conteúdo',
  }), FIXED);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /exatamente 5 telas/);
});

test('destaque de produto exige dados do produto', () => {
  const result = buildJobBriefFromForm(formPt({
    'Motivo do post': 'Destaque de produto',
  }), FIXED);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /product é obrigatório/);
});

test('rejeita referência visual que não seja URL', () => {
  const result = buildJobBriefFromForm(formPt({
    'Referências visuais (uma URL por linha)': 'post bonito da coleção anterior',
  }), FIXED);
  assert.equal(result.ok, false);
  assert.match(result.error.message, /URL http\(s\) válida/);
});
