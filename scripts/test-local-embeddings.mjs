#!/usr/bin/env node

const endpoint = process.env.LOCAL_EMBEDDING_TEST_URL || 'http://127.0.0.1:11434/api/embed';
const model = process.env.LOCAL_EMBEDDING_MODEL || 'embeddinggemma';
const inputs = [
  'Asset da marca: homem usando camisa polo básica cinza, corpo inteiro, fundo neutro, estilo esportivo sofisticado.',
  'Preciso de uma foto de homem com polo cinza básica para um carrossel da marca.',
  'Ilustração infantil colorida de animais em uma floresta tropical.',
];

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ model, input: inputs, truncate: true }),
  signal: AbortSignal.timeout(120_000),
});
const body = await response.json();
if (!response.ok) throw new Error(body.error || `Ollama HTTP ${response.status}`);

const embeddings = body.embeddings;
if (!Array.isArray(embeddings) || embeddings.length !== inputs.length) throw new Error('Quantidade de embeddings inesperada.');
if (embeddings.some((vector) => !Array.isArray(vector) || vector.length !== 768)) throw new Error('EmbeddingGemma deve retornar vetores de 768 dimensões.');

const cosine = (left, right) => {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

const relevant = cosine(embeddings[0], embeddings[1]);
const unrelated = cosine(embeddings[0], embeddings[2]);
if (!(relevant > unrelated)) throw new Error(`Ranking semântico inesperado: relevante=${relevant}, não relacionado=${unrelated}`);

console.log(JSON.stringify({
  ok: true,
  endpoint,
  model,
  dimensions: embeddings[0].length,
  relevant_similarity: Number(relevant.toFixed(4)),
  unrelated_similarity: Number(unrelated.toFixed(4)),
}, null, 2));
