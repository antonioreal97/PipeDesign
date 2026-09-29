"""Marcação simples de ênfase dentro de um texto.

  **palavra**   -> negrito (mesma família)
  *palavra*     -> família display (serif itálica)
  __palavra__   -> sublinhado
  quebra de linha (\\n) -> nova linha no mesmo parágrafo
"""
import re
from dataclasses import dataclass

TOKEN = re.compile(r"(\*\*.+?\*\*|__.+?__|\*.+?\*)")


@dataclass(frozen=True)
class Span:
    text: str
    bold: bool = False
    accent: bool = False
    underline: bool = False


def parse(text: str) -> list[Span]:
    spans: list[Span] = []
    for part in TOKEN.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            spans.append(Span(part[2:-2], bold=True))
        elif part.startswith("__") and part.endswith("__") and len(part) > 4:
            spans.append(Span(part[2:-2], underline=True))
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            spans.append(Span(part[1:-1], accent=True))
        else:
            spans.append(Span(part))
    return spans


def plain(text: str) -> str:
    return "".join(s.text for s in parse(text))
