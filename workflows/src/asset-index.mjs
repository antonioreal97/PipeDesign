export const ASSET_INDEX_MAX = 50;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));

export function sha256Bytes(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);

  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(words[i - 15], 7) ^ rotr(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotr(words[i - 2], 17) ^ rotr(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + words[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    const values = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i += 1) hash[i] = (hash[i] + values[i]) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
}

export function imageDimensions(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + length + 2 > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        };
      }
      offset += length + 2;
    }
  }
  return { width: undefined, height: undefined };
}

export function normalizeAssetPath(directory, fileName, clientRoot) {
  if (!clientRoot) throw new Error('clientRoot é obrigatório');
  const full = String(directory || '').replace(/\/$/, '') + '/' + String(fileName || '');
  const normalized = full.replaceAll('\\', '/').replace(/\/+/g, '/');
  const prefix = clientRoot.replace(/\/$/, '') + '/';
  if (!normalized.startsWith(prefix)) throw new Error('foto fora do workspace da marca: ' + normalized);
  const relative = normalized.slice(prefix.length);
  if (!relative.startsWith('Fotos/') || relative.includes('../')) throw new Error('path de foto inválido: ' + relative);
  return relative;
}

export function validateAssetAnalysis(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['análise deve ser objeto'] };
  const requiredArrays = ['subjects', 'products', 'dominant_colors', 'style_keywords', 'suitable_for'];
  for (const key of requiredArrays) {
    if (!Array.isArray(value[key])) errors.push(key + ' deve ser array');
  }
  for (const key of ['asset_type', 'background', 'shot_type']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) errors.push(key + ' deve ser string');
  }
  const composition = value.composition;
  if (!composition || typeof composition !== 'object' || Array.isArray(composition)) {
    errors.push('composition deve ser objeto');
  } else {
    if (!['left', 'center', 'right', 'full_frame', 'none'].includes(composition.subject_position)) {
      errors.push('composition.subject_position inválido');
    }
    const space = composition.negative_space;
    if (!space || typeof space !== 'object') errors.push('composition.negative_space deve ser objeto');
    else for (const side of ['left', 'right', 'top', 'bottom']) {
      if (!['none', 'low', 'medium', 'high'].includes(space[side])) errors.push('negative_space.' + side + ' inválido');
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export function normalizeAssetAnalysis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const normalized = { ...value };
  for (const key of ['subjects', 'products', 'dominant_colors', 'style_keywords', 'suitable_for']) {
    if (!Array.isArray(normalized[key])) continue;
    normalized[key] = [...new Set(normalized[key]
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))];
  }
  return normalized;
}

export function analysisToText(analysis, filePath) {
  return [
    'path: ' + filePath,
    'tipo: ' + analysis.asset_type,
    'sujeitos: ' + analysis.subjects.join(', '),
    'produtos: ' + analysis.products.join(', '),
    'cores: ' + analysis.dominant_colors.join(', '),
    'fundo: ' + analysis.background,
    'enquadramento: ' + analysis.shot_type,
    'posição: ' + analysis.composition.subject_position,
    'espaço negativo: ' + Object.entries(analysis.composition.negative_space).map(([k, v]) => k + '=' + v).join(', '),
    'estilo: ' + analysis.style_keywords.join(', '),
    'adequado para: ' + analysis.suitable_for.join(', '),
  ].join('\n');
}
