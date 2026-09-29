"""Carrega brands/<id>/brand.json e resolve estilos em TextStyle."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .primitives import TextStyle


@dataclass
class Brand:
    id: str
    data: dict
    root: Path          # pasta do cliente (fotos e logos são relativos a ela)

    @property
    def width(self) -> int:
        return self.data["canvas"]["feed"]["width"]

    @property
    def height(self) -> int:
        return self.data["canvas"]["feed"]["height"]

    def color(self, name_or_hex: str) -> str:
        if name_or_hex.startswith("#"):
            return name_or_hex
        return self.data["colors"][name_or_hex]

    def family(self, role: str) -> str:
        return self.data["fonts"][role]["family"]

    def geometry(self, layout: str) -> dict:
        return self.data["geometry"][layout]

    @property
    def limits(self) -> dict:
        return self.data["limits"]

    @property
    def margin(self) -> int:
        return self.data["rules"]["margins_px"]

    def style(self, name: str, color: str = "branco") -> TextStyle:
        s = self.data["styles"][name]
        font = self.data["fonts"][s["font"]]
        display = self.data["fonts"]["display"]
        return TextStyle(
            family=font["family"],
            size=s["size"],
            line=s["line"],
            color=self.color(color),
            bold=bool(s.get("bold", font.get("bold", False))),
            italic=bool(s.get("italic", font.get("italic", False))),
            caps=bool(s.get("caps", False)),
            tracking=float(s.get("tracking", 0.0)),
            accent_family=display["family"],
            accent_italic=bool(display.get("italic", True)),
        )

    def asset(self, rel: str) -> Path:
        p = Path(rel)
        return p if p.is_absolute() else self.root / p

    def logo_path(self, key: str) -> Path:
        return self.asset(self.data["logo"][key])


def load_brand(brands_dir: Path, brand_id: str, client_root: Path) -> Brand:
    data = json.loads((brands_dir / brand_id / "brand.json").read_text(encoding="utf-8"))
    return Brand(id=brand_id, data=data, root=client_root)
