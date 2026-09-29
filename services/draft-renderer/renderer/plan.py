"""Validação do Creative Plan contra o padrão da marca, antes de desenhar.

Erros impedem o render; avisos aparecem no resultado (e viram erro com --strict).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .brand import Brand
from .markup import plain

EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF️]")
POSITIONS = {"top_left", "top_right", "bottom_left", "bottom_right", "middle_left", "middle_right"}
TONES = {"auto", "light", "dark"}

REQUIRED = {
    "capa_manchete": ["photo", "headline"],
    "foto_nota": ["photo"],
    "manifesto_preto": ["title"],
    "manifesto_frase": ["text"],
    "manifesto_assinatura": [],
    "beneficio_duplo": ["top", "bottom"],
    "moodboard_cena": ["scene", "product", "detail", "time"],
}


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _texts(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, list):
        for x in obj:
            yield from _texts(x)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k not in {"layout", "photo", "position", "tone", "size", "focus", "zoom", "extend", "box_top", "box_left", "box_width"}:
                yield from _texts(v)


def _lines(rep: Report, where: str, text: str, max_lines: int, max_chars: int):
    lines = text.split("\n")
    if len(lines) > max_lines:
        rep.errors.append(f"{where}: {len(lines)} linhas (máximo {max_lines}; quebre com \\n)")
    for ln in lines:
        if len(plain(ln)) > max_chars:
            rep.warnings.append(f"{where}: linha '{plain(ln)}' tem {len(plain(ln))} caracteres "
                                f"(padrão até {max_chars})")


def _chars(rep: Report, where: str, texts, limit: int):
    n = sum(len(plain(t)) for t in texts)
    if n > limit:
        rep.warnings.append(f"{where}: {n} caracteres (padrão até {limit}); o post publicado usa textos curtos")


def validate(plan: dict, brand: Brand) -> Report:
    rep = Report()
    lim = brand.limits
    slides = plan.get("slides")
    if not isinstance(slides, list) or not slides:
        rep.errors.append("plano sem 'slides'")
        return rep
    if plan.get("brand") and plan["brand"] != brand.id:
        rep.errors.append(f"plano é da marca '{plan['brand']}', não '{brand.id}'")
    if not (lim["slides_min"] <= len(slides) <= lim["slides_max"]) and len(slides) != 1:
        rep.warnings.append(f"{len(slides)} slides (carrossel da marca usa {lim['slides_min']}–{lim['slides_max']})")

    for i, s in enumerate(slides, 1):
        where = f"slide {i} ({s.get('layout', '?')})"
        layout = s.get("layout")
        if layout not in REQUIRED:
            rep.errors.append(f"{where}: layout desconhecido; use um de {sorted(REQUIRED)}")
            continue
        for key in REQUIRED[layout]:
            if not s.get(key):
                rep.errors.append(f"{where}: falta '{key}'")
        for t in _texts(s):
            if EMOJI.search(t):
                rep.errors.append(f"{where}: emoji na arte não faz parte do padrão ('{t}')")
        if s.get("tone", "auto") not in TONES:
            rep.errors.append(f"{where}: tone deve ser auto, light ou dark")
        nested_photo_keys = ("top", "bottom", "scene", "product", "detail")
        for part in [s] + [s.get(k) for k in nested_photo_keys if isinstance(s.get(k), dict)]:
            ext = part.get("extend") or {}
            if not isinstance(ext, dict) or set(ext) - {"top", "left", "right"} or \
                    any(not (0 <= float(v) <= 1) for v in ext.values()):
                rep.errors.append(f"{where}: extend aceita top/left/right entre 0 e 1")
            if not (1 <= float(part.get("zoom", 1)) <= 3):
                rep.errors.append(f"{where}: zoom deve ficar entre 1 e 3")
        photos = [s.get("photo")] + [s.get(k, {}).get("photo") for k in nested_photo_keys if isinstance(s.get(k), dict)]
        for p in filter(None, photos):
            if not brand.asset(p).exists():
                rep.errors.append(f"{where}: foto não encontrada: {p}")

        if layout == "capa_manchete" and s.get("headline"):
            _lines(rep, where + " manchete", s["headline"], lim["headline_lines"], lim["headline_chars_per_line"])
            if len(s.get("kicker", "")) > lim["kicker_chars"]:
                rep.warnings.append(f"{where}: kicker longo (padrão até {lim['kicker_chars']})")
            if s.get("box"):
                _chars(rep, where + " caixa", [s["box"]], lim["box_chars"])
        elif layout == "foto_nota":
            if not s.get("paragraphs") and not s.get("phrase"):
                rep.errors.append(f"{where}: precisa de 'paragraphs' ou 'phrase'")
            if s.get("position", "top_left") not in POSITIONS:
                rep.errors.append(f"{where}: position deve ser uma de {sorted(POSITIONS)}")
            _chars(rep, where, s.get("paragraphs", []), lim["note_chars"])
            if s.get("phrase"):
                _lines(rep, where + " frase", s["phrase"], 2, 22)
        elif layout == "manifesto_preto" and s.get("title"):
            _lines(rep, where + " título", s["title"], lim["manifesto_title_lines"],
                   lim["manifesto_title_chars_per_line"])
            _chars(rep, where, s.get("paragraphs", []), lim["manifesto_text_chars"])
        elif layout == "manifesto_frase" and s.get("text"):
            _chars(rep, where, [s["text"]], lim["frase_chars"])
        elif layout == "manifesto_assinatura":
            if not s.get("lines") and not s.get("tagline"):
                rep.errors.append(f"{where}: precisa de 'lines' ou 'tagline'")
        elif layout == "beneficio_duplo":
            for k in ("top", "bottom"):
                part = s.get(k) or {}
                for key in ("photo", "title"):
                    if not part.get(key):
                        rep.errors.append(f"{where} {k}: falta '{key}'")
                if part.get("title"):
                    _lines(rep, f"{where} {k} rótulo", part["title"], lim["benefit_title_lines"],
                           lim["benefit_title_chars_per_line"])
                if part.get("text"):
                    _chars(rep, f"{where} {k}", [part["text"]], lim["benefit_text_chars"])
        elif layout == "moodboard_cena":
            if s.get("side", "left") not in {"left", "right"}:
                rep.errors.append(f"{where}: side deve ser left ou right")
            for k in ("scene", "product", "detail"):
                if not isinstance(s.get(k), dict) or not s.get(k, {}).get("photo"):
                    rep.errors.append(f"{where} {k}: falta 'photo'")
            _chars(rep, where, [s.get("time", ""), *s.get("lines", [])], lim["note_chars"])

    if slides and slides[0].get("layout") not in {"capa_manchete", "foto_nota"}:
        rep.warnings.append("o primeiro slide dos carrosséis publicados é uma capa com foto")
    return rep
