"""Estimativa de quebra de linha para posicionar blocos.

Usa o arquivo da fonte quando está instalado (fc-match); sem ele, usa uma
largura média por caractere. O Canva refaz a quebra ao importar, então isto
só serve para centralizar blocos e acusar texto que não cabe.
"""
from __future__ import annotations

import functools
import shutil
import subprocess

from PIL import ImageFont

from .markup import plain
from .primitives import TextStyle

AVG_EM = {"sans": 0.50, "display": 0.46}


@functools.lru_cache(maxsize=64)
def _font_file(family: str, bold: bool, italic: bool) -> str | None:
    if not shutil.which("fc-match"):
        return None
    pattern = family + (":bold" if bold else "") + (":italic" if italic else "")
    try:
        out = subprocess.run(["fc-match", "-f", "%{family}|%{file}", pattern],
                             capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    found, _, path = out.partition("|")
    base = family.split()[0].lower()
    return path if base in found.lower() else None


@functools.lru_cache(maxsize=64)
def _font(path: str, size: int):
    return ImageFont.truetype(path, size)


def text_width(text: str, style: TextStyle) -> float:
    content = text.upper() if style.caps else text
    path = _font_file(style.family, style.bold, style.italic)
    extra = style.tracking * style.size * max(len(content) - 1, 0)
    if path:
        return _font(path, int(round(style.size))).getlength(content) + extra
    kind = "display" if style.italic else "sans"
    return len(content) * style.size * AVG_EM[kind] + extra


def wrap_count(text: str, style: TextStyle, width: float) -> int:
    """Número de linhas de um bloco (com '\\n') numa caixa de largura dada."""
    total = 0
    for line in text.split("\n"):
        words = plain(line).split()
        if not words:
            total += 1
            continue
        lines, current = 1, ""
        for w in words:
            candidate = f"{current} {w}".strip()
            if current and text_width(candidate, style) > width:
                lines += 1
                current = w
            else:
                current = candidate
        total += lines
    return total


def block_height(paragraphs: list[str], style: TextStyle, width: float, gap: float = 0.0) -> float:
    if not paragraphs:
        return 0.0
    lines = sum(wrap_count(p, style, width) for p in paragraphs)
    return lines * style.line + gap * (len(paragraphs) - 1)


def fits_width(text: str, style: TextStyle, width: float) -> bool:
    return all(text_width(plain(l), style) <= width for l in text.split("\n"))
