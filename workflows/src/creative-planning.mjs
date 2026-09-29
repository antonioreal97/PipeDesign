export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function briefEmbeddingText(brief) {
  const parts = [
    'objetivo: ' + (brief.objective || ''),
    'direção visual: ' + (brief.visual_direction || []).join(', '),
  ];
  if (brief.campaign) {
    parts.push('título: ' + (brief.campaign.title || ''));
    parts.push('conceito: ' + (brief.campaign.concept || ''));
    parts.push('mensagem: ' + (brief.campaign.key_message || ''));
  }
  if (brief.product) parts.push('produto: ' + [brief.product.name, brief.product.sku, brief.product.color].filter(Boolean).join(' '));
  if (Array.isArray(brief.slide_copy)) parts.push('copy: ' + brief.slide_copy.map((item) => item.copy).join(' | '));
  if (brief.production?.asset_requirements) parts.push('assets: ' + brief.production.asset_requirements);
  if (brief.asset_constraints?.notes) parts.push('restrições: ' + brief.asset_constraints.notes);
  return parts.join('\n');
}

export function filterAssetCandidates(rows, brief, limit = 12) {
  const avoid = new Set(brief.asset_constraints?.avoid_subject_position || []);
  const active = rows.filter((row) => row && row.file_path && row.analysis_json);
  let filtered = active.filter((row) => !avoid.has(row.analysis_json?.composition?.subject_position));
  let usedFallback = false;
  if (!filtered.length && active.length && brief.production?.fallback_if_missing_assets === 'approved_alternatives_only') {
    filtered = active;
    usedFallback = true;
  }
  const sku = String(brief.product?.sku || '').split('_')[0].toLowerCase();
  filtered.sort((a, b) => {
    const aSku = sku && String(a.file_path).toLowerCase().includes(sku) ? 1 : 0;
    const bSku = sku && String(b.file_path).toLowerCase().includes(sku) ? 1 : 0;
    if (aSku !== bSku) return bSku - aSku;
    return Number(b.similarity || 0) - Number(a.similarity || 0);
  });
  return { candidates: filtered.slice(0, limit), usedFallback, rejected: active.length - filtered.length };
}

const STOCK_SCENES = [
  { pattern: /acord|agenda|pré[- ]?treino/i, scene: 'rotina matinal em casa', query: 'man morning routine at home', relevance_terms: ['home', 'morning', 'bedroom', 'kitchen', 'coffee'] },
  { pattern: /treino|academia|exercício/i, scene: 'treino', query: 'man workout at gym', relevance_terms: ['gym', 'workout', 'fitness', 'exercise', 'training'] },
  { pattern: /daily|e-?mail|equipe|reunião/i, scene: 'reunião de trabalho', query: 'business team meeting office', relevance_terms: ['meeting', 'team', 'office', 'coworker', 'workplace'] },
  { pattern: /trabalho|foco|laptop|escritório/i, scene: 'trabalho focado', query: 'man working on laptop office', relevance_terms: ['laptop', 'computer', 'office', 'desk', 'working'] },
  { pattern: /(almoço|jantar).*(família)|família.*(almoço|jantar)/i, scene: 'refeição em família', query: 'family eating dinner together', relevance_terms: ['family', 'dinner', 'lunch', 'meal', 'dining'] },
  { pattern: /almoço|jantar|refeição|restaurante/i, scene: 'refeição', query: 'man eating lunch restaurant', relevance_terms: ['lunch', 'dinner', 'meal', 'eating', 'restaurant', 'dining'] },
  { pattern: /tênis|tennis/i, scene: 'tênis', query: 'man playing tennis court', relevance_terms: ['tennis', 'court', 'racket', 'racquet', 'serve'] },
];

export function buildStockSceneRequests(brief, maxScenes = 7) {
  if (!Array.isArray(brief?.slide_copy)) return [];
  const limit = Math.max(0, Math.min(10, Number(maxScenes) || 0));
  return brief.slide_copy
    .filter((item) => Number(item.slide) > 1 && Number(item.slide) < Number(brief.slides))
    .slice(0, limit)
    .map((item) => {
      const copy = String(item.copy || '');
      const match = STOCK_SCENES.find((entry) => entry.pattern.test(copy));
      return {
        slide: Number(item.slide),
        scene: match?.scene || 'rotina masculina urbana',
        query: match?.query || 'man daily routine lifestyle',
        relevance_terms: match?.relevance_terms || ['man', 'lifestyle', 'routine'],
        color: '',
      };
    });
}

export function mergeAssetCandidates(localCandidates, stockCandidates) {
  const merged = [];
  const seen = new Set();
  for (const candidate of [...(localCandidates || []), ...(stockCandidates || [])]) {
    const path = candidate?.path;
    if (typeof path !== 'string' || !path.startsWith('Fotos/') || seen.has(path)) continue;
    seen.add(path);
    merged.push(candidate);
  }
  return merged;
}

const SCENE_EVIDENCE = {
  'rotina matinal em casa': ['home', 'bedroom', 'kitchen', 'morning'],
  'treino': ['gym', 'workout', 'training', 'fitness'],
  'reunião de trabalho': ['office', 'meeting', 'workplace', 'team'],
  'trabalho focado': ['office', 'workspace', 'laptop', 'desk', 'work'],
  'refeição': ['restaurant', 'dining', 'meal', 'lunch', 'dinner', 'kitchen'],
  'refeição em família': ['family', 'restaurant', 'dining', 'meal', 'lunch', 'dinner', 'kitchen'],
  'tênis': ['tennis', 'court', 'racket'],
};

export function filterMissingStockScenes(scenes, localCandidates) {
  const analyses = (localCandidates || []).map((candidate) => JSON.stringify(candidate.analysis || {}).toLowerCase());
  return (scenes || []).filter((scene) => {
    const tokens = SCENE_EVIDENCE[scene.scene] || [];
    return !tokens.some((token) => analyses.some((analysis) => analysis.includes(token)));
  });
}

export function parseChatJson(response) {
  if (!response || typeof response !== 'object') throw new Error('resposta OpenAI ausente');
  if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
    const message = response.body?.error?.message || 'HTTP ' + response.statusCode;
    throw new Error(message);
  }
  const body = response.body || response;
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('OpenAI não devolveu conteúdo JSON');
  return JSON.parse(content);
}

export function normalizePlanForRenderer(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return plan;

  const source = !Array.isArray(plan.slides) && plan.original_plan && typeof plan.original_plan === 'object'
    ? plan.original_plan
    : plan;
  if (!Array.isArray(source.slides)) return source;

  return {
    ...source,
    slides: source.slides.map((slide) => {
      if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return slide;

      const normalized = { ...slide };
      if (!normalized.photo && typeof normalized.image === 'string') normalized.photo = normalized.image;

      const copy = typeof normalized.copy === 'string' ? normalized.copy.trim() : '';
      const lines = copy.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (copy) {
        if (normalized.layout === 'capa_manchete' && !normalized.headline) {
          normalized.headline = lines[0] || copy;
          if (!normalized.box && lines.length > 1) normalized.box = lines.slice(1).join('\n');
        } else if (normalized.layout === 'foto_nota' && !normalized.paragraphs && !normalized.phrase) {
          normalized.paragraphs = lines.length ? lines : [copy];
        } else if (normalized.layout === 'manifesto_preto' && !normalized.title) {
          normalized.title = lines[0] || copy;
          if (!normalized.paragraphs && lines.length > 1) normalized.paragraphs = lines.slice(1);
        } else if (normalized.layout === 'manifesto_frase' && !normalized.text) {
          normalized.text = copy;
        } else if (normalized.layout === 'manifesto_assinatura' && !normalized.lines && !normalized.tagline) {
          normalized.lines = lines.length ? lines : [copy];
        } else if (normalized.layout === 'moodboard_cena' && !normalized.time) {
          normalized.time = lines[0] || copy;
          normalized.lines = lines.slice(1);
        }
      }

      delete normalized.image;
      delete normalized.copy;
      return normalized;
    }),
  };
}

export function applyApprovedCopy(plan, brief) {
  if (
    !plan || !Array.isArray(plan.slides) ||
    brief?.campaign?.copy_status !== 'approved_locked' ||
    !Array.isArray(brief.slide_copy)
  ) return plan;

  const copyBySlide = new Map(brief.slide_copy.map((item) => [Number(item.slide), String(item.copy || '')]));
  return {
    ...plan,
    slides: plan.slides.map((slide, index) => {
      if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return slide;
      const copy = copyBySlide.get(index + 1);
      if (!copy) return slide;
      const lines = copy.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const locked = { ...slide };

      if (locked.layout === 'capa_manchete') {
        delete locked.kicker;
        delete locked.headline;
        delete locked.box;
        locked.headline = lines[0] || copy;
        if (lines.length > 1) locked.box = lines.slice(1).join('\n');
      } else if (locked.layout === 'foto_nota') {
        delete locked.paragraphs;
        delete locked.phrase;
        locked.paragraphs = [copy];
      } else if (locked.layout === 'manifesto_preto') {
        delete locked.title;
        delete locked.paragraphs;
        locked.title = lines[0] || copy;
        if (lines.length > 1) locked.paragraphs = [lines.slice(1).join('\n')];
      } else if (locked.layout === 'manifesto_frase') {
        locked.text = copy;
      } else if (locked.layout === 'manifesto_assinatura') {
        delete locked.tagline;
        locked.lines = lines.length ? lines : [copy];
      } else if (locked.layout === 'moodboard_cena') {
        locked.time = lines[0] || copy;
        locked.lines = lines.slice(1);
      }
      return locked;
    }),
  };
}

export function attachStockCredits(plan, candidates) {
  if (!plan || !Array.isArray(plan.slides)) return plan;
  const selected = new Set(collectPhotos(plan));
  const credits = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    if (candidate?.source !== 'pexels' || !selected.has(candidate.path) || seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    credits.push({ file_path: candidate.path, ...(candidate.attribution || {}) });
  }
  const output = { ...plan };
  if (credits.length) output.credits = credits;
  else delete output.credits;
  return output;
}

function collectPhotos(value, output = []) {
  if (Array.isArray(value)) for (const item of value) collectPhotos(item, output);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'photo' && typeof item === 'string') output.push(item);
      else collectPhotos(item, output);
    }
  }
  return output;
}

export function validatePlanEnvelope(plan, job, candidatePaths) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { ok: false, errors: ['plano deve ser objeto'] };
  if (plan.job_id !== job.job_id) errors.push('plan.job_id difere do job');
  if (plan.brand !== job.brand_id) errors.push('plan.brand difere da marca do job');
  if (!Array.isArray(plan.slides) || plan.slides.length !== job.brief.slides) {
    errors.push('plano deve conter exatamente ' + job.brief.slides + ' telas');
  }
  const allowed = new Set(candidatePaths);
  for (const photo of collectPhotos(plan)) {
    if (!allowed.has(photo)) errors.push('foto fora dos candidatos: ' + photo);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}
