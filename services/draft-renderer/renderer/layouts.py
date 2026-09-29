"""Layouts do padrão editorial publicado no Instagram.

Cada layout recebe o slide vazio, a marca, a especificação do slide (vinda do
plano) e o contexto de render. Medidas e estilos vêm do brand.json, nunca de
números soltos aqui, para que outra marca possa reaproveitar os layouts.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .brand import Brand
from .measure import block_height, fits_width, wrap_count
from .primitives import (extend_canvas, hline, logo, picture, prepare_photo, rect, region_luminance, text_box,
                         textured_black)


@dataclass
class Context:
    work_dir: Path
    photo_max_side: int = 2160
    slide_no: int = 0
    warnings: list[str] = field(default_factory=list)

    def warn(self, message: str) -> None:
        self.warnings.append(f"slide {self.slide_no}: {message}")

    def photo(self, brand: Brand, spec: dict) -> Path:
        """Foto reduzida (cache); com `extend` {top, left, right}, estende o fundo de estúdio."""
        src = brand.asset(spec["photo"])
        if not src.exists():
            raise FileNotFoundError(f"Foto não encontrada: {src}")
        stem = src.stem.replace(" ", "_")
        dst = self.work_dir / "photos" / f"{stem}.jpg"
        if not dst.exists():
            is_external_stock = str(spec["photo"]).startswith("Fotos/BANCO/PEXELS/")
            prepare_photo(src, dst, self.photo_max_side, neutralize=is_external_stock)
        ext = {k: float(v) for k, v in (spec.get("extend") or {}).items() if float(v) > 0}
        if ext:
            tag = "-".join(f"{k[0]}{int(v * 100)}" for k, v in sorted(ext.items()))
            ext_dst = self.work_dir / "photos" / f"{stem}-ext-{tag}.jpg"
            if not ext_dst.exists():
                extend_canvas(dst, ext_dst, **ext)
            return ext_dst
        return dst

    def texture(self, brand: Brand) -> Path:
        base = brand.color("fundo_texturizado")
        return textured_black(self.work_dir / f"textura-{base.lstrip('#')}-{brand.width}x{brand.height}.jpg",
                              brand.width, brand.height, base)


def _tone(brand: Brand, spec: dict, photo: Path, slot, region, focus, ctx: Context, what: str) -> str:
    """Devolve o nome da cor do texto ('branco' ou 'texto_escuro').

    Avisa quando o fundo sob o texto mistura áreas claras e escuras: nenhuma das
    duas cores fica legível inteira, e o plano deve mudar focus/zoom/posição."""
    choice = spec.get("tone", "auto")
    t = brand.data["tone"]
    p20, mean, p80 = region_luminance(photo, slot, region, focus, _zoom(spec))
    if choice == "light":
        return t["light_text"]
    if choice == "dark":
        return t["dark_text"]
    if p20 < t["mixed_low"] and p80 > t["mixed_high"]:
        ctx.warn(f"{what}: fundo misto sob o texto (claro e escuro); ajuste focus, zoom ou posição")
    return t["dark_text"] if mean > t["threshold"] else t["light_text"]


def _check_fit(ctx: Context, what: str, text: str, style, width: float) -> None:
    if not fits_width(text, style, width):
        ctx.warn(f"{what}: linha mais larga que a caixa ({int(width)} px); o Canva vai quebrar a linha")


def _focus(spec: dict) -> tuple[float, float]:
    f = spec.get("focus", [0.5, 0.5])
    return float(f[0]), float(f[1])


def _zoom(spec: dict) -> float:
    return float(spec.get("zoom", 1.0) or 1.0)


def _place(slide, name, brand: Brand, spec: dict, ctx: Context, slot):
    photo, focus = ctx.photo(brand, spec), _focus(spec)
    picture(slide, name, photo, slot, focus, _zoom(spec))
    return photo, focus


def _note_position(brand: Brand, spec: dict, photo: Path, focus, width: float, total: float):
    """Escolhe a área mais uniforme quando o plano não fixa a posição da nota."""
    g = brand.geometry("foto_nota")
    positions = g["positions"]
    requested = spec.get("position")
    names = [requested] if requested in positions else list(positions)
    ranked = []
    for order, name in enumerate(names):
        pos = positions[name]
        left = pos["left"] if "left" in pos else brand.width - pos["right"] - width
        if "top" in pos:
            top = pos["top"]
        elif "bottom" in pos:
            top = brand.height - pos["bottom"] - total
        else:
            top = pos["middle"] - total / 2
        p20, mean, p80 = region_luminance(
            photo, _full(brand), (left, top, width, total), focus, _zoom(spec)
        )
        spread = p80 - p20
        middle_penalty = min(mean, 1 - mean)
        ranked.append((spread * 1.5 + middle_penalty, order, name, left, top))
    _, _, name, left, top = min(ranked)
    return name, left, top


def _full(brand: Brand):
    return (0, 0, brand.width, brand.height)


# --------------------------------------------------------------------------- capa
def capa_manchete(slide, brand: Brand, spec: dict, ctx: Context):
    """Foto sangrada + kicker espaçado + manchete serif itálica caixa alta, centralizados no topo.
    Opcional: frase curta num retângulo arredondado só com contorno, embaixo."""
    g = brand.geometry("capa_manchete")
    W, H, m = brand.width, brand.height, brand.margin
    photo, focus = _place(slide, "foto", brand, spec, ctx, _full(brand))

    kick = brand.style("kicker")
    head = brand.style("headline")
    head_lines = spec["headline"].count("\n") + 1
    top = g["kicker_top"]
    head_top = top + (kick.line + g["headline_gap"] if spec.get("kicker") else 0)
    region = (m, top, W - 2 * m, head_top + head_lines * head.line - top)
    color = _tone(brand, spec, photo, _full(brand), region, focus, ctx, "manchete")
    _check_fit(ctx, "manchete", spec["headline"], head, W - 2 * m)

    if spec.get("kicker"):
        text_box(slide, "kicker", (m, top, W - 2 * m, kick.line), [spec["kicker"]],
                 brand.style("kicker", color), align="center")
    text_box(slide, "manchete", (m, head_top, W - 2 * m, head_lines * head.line + 10), [spec["headline"]],
             brand.style("headline", color), align="center")

    if spec.get("box"):
        b = g["box"]
        st = brand.style("box_text")
        box_width = float(spec.get("box_width", b["width"]))
        inner = box_width - 2 * b["pad_x"]
        lines = wrap_count(spec["box"], st, inner)
        height = max(b["height"], lines * st.line + 34)
        left = float(spec.get("box_left", (W - box_width) / 2))
        box_top = spec.get("box_top", b["top"])
        box_color = _tone(brand, spec, photo, _full(brand), (left, box_top, box_width, height), focus, ctx,
                          "caixa")
        rect(slide, "caixa", (left, box_top, box_width, height), outline=brand.color(box_color),
             outline_px=b["stroke"], radius=b["radius"])
        text_box(slide, "caixa_texto", (left + b["pad_x"], box_top, inner, height), [spec["box"]],
                 brand.style("box_text", box_color), align="center", anchor="middle")


# ----------------------------------------------------------------------- foto_nota
def foto_nota(slide, brand: Brand, spec: dict, ctx: Context):
    """Foto sangrada + nota curta em sans (com negrito/ênfase), numa das posições medidas.
    Opcional: frase de fechamento em serif itálica caixa alta abaixo da nota."""
    g = brand.geometry("foto_nota")
    W, H = brand.width, brand.height
    photo, focus = _place(slide, "foto", brand, spec, ctx, _full(brand))

    large = spec.get("size", "regular") == "large"
    style_name = "note_large" if large else "note"
    width = g["large_width"] if large else g["width"]
    note = brand.style(style_name)
    paragraphs = spec.get("paragraphs", [])
    note_h = block_height(paragraphs, note, width, g["paragraph_gap"])
    phrase = spec.get("phrase")
    ph = brand.style("phrase_caps")
    phrase_h = (phrase.count("\n") + 1) * ph.line if phrase else 0
    total = note_h + (g["phrase_gap"] + phrase_h if phrase and paragraphs else phrase_h)

    pos_name, left, top = _note_position(brand, spec, photo, focus, width, total)
    align = "right" if pos_name.endswith("right") else "left"
    color = _tone(brand, spec, photo, _full(brand), (left, top, width, total), focus, ctx, "nota")

    y = top
    if paragraphs:
        text_box(slide, "nota", (left, y, width, note_h + 8), paragraphs,
                 brand.style(style_name, color), align=align, paragraph_gap=g["paragraph_gap"])
        y += note_h + g["phrase_gap"]
    if phrase:
        text_box(slide, "frase", (left, y, width, phrase_h + 8), [phrase],
                 brand.style("phrase_caps", color), align=align)


# ------------------------------------------------------------------ telas pretas
def _black(slide, brand: Brand, ctx: Context):
    picture(slide, "fundo_textura", ctx.texture(brand), _full(brand))


def manifesto_preto(slide, brand: Brand, spec: dict, ctx: Context):
    """Preto texturizado; título serif caixa alta + texto sans à esquerda, centrado na vertical.
    Sublinhado (__trecho__) e negrito (**trecho**) marcam os trechos técnicos."""
    g = brand.geometry("manifesto_preto")
    _black(slide, brand, ctx)
    title = brand.style("manifesto_title")
    body = brand.style("manifesto_text")
    t_lines = spec["title"].count("\n") + 1
    t_h = t_lines * title.line
    paragraphs = spec.get("paragraphs", [])
    b_h = block_height(paragraphs, body, g["width"], g["paragraph_gap"])
    total = t_h + (g["title_gap"] + b_h if paragraphs else 0)
    top = (brand.height - total) / 2
    _check_fit(ctx, "título", spec["title"], title, g["width"])
    text_box(slide, "titulo", (g["left"], top, g["width"], t_h + 6), [spec["title"]], title)
    if paragraphs:
        text_box(slide, "texto", (g["left"], top + t_h + g["title_gap"], g["width"], b_h + 8), paragraphs,
                 body, paragraph_gap=g["paragraph_gap"])


def manifesto_frase(slide, brand: Brand, spec: dict, ctx: Context):
    """Preto texturizado com uma frase serif itálica centralizada."""
    g = brand.geometry("manifesto_frase")
    _black(slide, brand, ctx)
    st = brand.style("frase")
    width = brand.width - 2 * g["margin"]
    h = block_height([spec["text"]], st, width)
    text_box(slide, "frase", (g["margin"], (brand.height - h) / 2, width, h + 8), [spec["text"]], st,
             align="center")


def manifesto_assinatura(slide, brand: Brand, spec: dict, ctx: Context):
    """Tela final: frases sans (negrito/regular) + tagline serif itálica, linha fina e ícone da marca."""
    g = brand.geometry("manifesto_assinatura")
    _black(slide, brand, ctx)
    ln = g["line"]
    width = ln["x2"] - ln["x1"]
    body = brand.style("signature_text")
    tag = brand.style("signature_tagline")
    lines = spec.get("lines", [])
    b_h = block_height(lines, body, width)
    t_h = block_height([spec["tagline"]], tag, width) if spec.get("tagline") else 0
    total = b_h + (g["tagline_gap"] + t_h if t_h else 0)
    top = ln["y"] - 80 - total
    if lines:
        text_box(slide, "assinatura", (g["left"], top, width, b_h + 6), lines, body)
    if t_h:
        text_box(slide, "tagline", (g["left"], top + b_h + g["tagline_gap"], width, t_h + 6),
                 [spec["tagline"]], tag)
    hline(slide, "linha", ln["x1"], ln["y"], ln["x2"], brand.color("linha"), ln["stroke"])
    ic = g["icon"]
    icon_path = brand.logo_path("icone_branco")
    if icon_path.exists():
        logo(slide, "icone", icon_path, brand.width - ic["right"] - ic["width"],
             brand.height - ic["bottom"] - ic["width"], ic["width"])


# ------------------------------------------------------------------ benefícios
def beneficio_duplo(slide, brand: Brand, spec: dict, ctx: Context):
    """Duas fotos empilhadas (metade cada). Rótulo serif caixa alta + descrição sans:
    bloco de cima alinhado à direita, rente à divisão; bloco de baixo à esquerda, logo abaixo dela."""
    g = brand.geometry("beneficio_duplo")
    W, H, split = brand.width, brand.height, g["split"]
    title = brand.style("benefit_title")
    body = brand.style("benefit_text")
    tw = g["text_width"]
    for key, slot in (("top", (0, 0, W, split)), ("bottom", (0, split, W, H - split))):
        part = spec[key]
        photo, focus = _place(slide, f"foto_{key}", brand, part, ctx, slot)
        t_h = (part["title"].count("\n") + 1) * title.line
        b_h = block_height([part["text"]], body, tw) if part.get("text") else 0
        total = t_h + g["title_gap"] + b_h
        if key == "top":
            left, top, align = W - g["margin"] - tw, g["top_block_bottom"] - total, "right"
        else:
            left, top, align = g["margin"], g["bottom_block_top"], "left"
        color = _tone(brand, part, photo, slot, (left, top, tw, total), focus, ctx, f"bloco {key}")
        _check_fit(ctx, f"rótulo {key}", part["title"], title, tw)
        text_box(slide, f"rotulo_{key}", (left, top, tw, t_h + 6), [part["title"]],
                 brand.style("benefit_title", color), align=align)
        if b_h:
            text_box(slide, f"descricao_{key}", (left, top + t_h + g["title_gap"], tw, b_h + 6), [part["text"]],
                     brand.style("benefit_text", color), align=align)


# --------------------------------------------------------------------- moodboard
def moodboard_cena(slide, brand: Brand, spec: dict, ctx: Context):
    """Colagem editorial: cena contextual + modelo/produto real + detalhe técnico.

    O banco de imagens estabelece o momento do dia, sem se passar por uma foto
    do produto. As duas imagens locais mantêm o produto da marca reconhecível e dão
    continuidade visual ao carrossel.
    """
    g = brand.geometry("moodboard_cena")
    side = spec.get("side", "left")
    rect(slide, "fundo", _full(brand), fill=brand.color("fundo_claro"))

    boxes = g["right"] if side == "right" else g["left"]
    for key in ("scene", "product", "detail"):
        _place(slide, f"foto_{key}", brand, spec[key], ctx, tuple(boxes[key]))

    line = g["divider"]
    hline(slide, "divisor", line["x1"], line["y"], line["x2"],
          brand.color("texto_escuro"), line["stroke"])

    text = g["text"]
    time_style = brand.style("moodboard_time", "texto_escuro")
    body_style = brand.style("moodboard_text", "texto_escuro")
    text_box(slide, "horario", (text["left"], text["top"], text["width"], time_style.line + 8),
             [spec["time"]], time_style)
    lines = spec.get("lines", [])
    if lines:
        body_top = text["top"] + time_style.line + text["gap"]
        body_h = block_height(lines, body_style, text["width"], text["paragraph_gap"])
        text_box(slide, "momento", (text["left"], body_top, text["width"], body_h + 8), lines,
                 body_style, paragraph_gap=text["paragraph_gap"])


LAYOUTS = {
    "capa_manchete": capa_manchete,
    "foto_nota": foto_nota,
    "manifesto_preto": manifesto_preto,
    "manifesto_frase": manifesto_frase,
    "manifesto_assinatura": manifesto_assinatura,
    "beneficio_duplo": beneficio_duplo,
    "moodboard_cena": moodboard_cena,
}
