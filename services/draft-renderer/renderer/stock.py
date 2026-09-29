"""Fallback controlado de fotos editoriais via Pexels.

As imagens são baixadas para a pasta da marca antes do Creative Plan ser
validado. Assim o renderer continua trabalhando apenas com arquivos locais.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Callable

from PIL import Image

PEXELS_API = "https://api.pexels.com/v1/search"
PEXELS_API_HOST = "api.pexels.com"
PEXELS_IMAGE_HOST = "images.pexels.com"
MAX_IMAGE_BYTES = 18 * 1024 * 1024


class StockError(Exception):
    pass


def _safe_https(url: str, host: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != host:
        raise StockError(f"URL externa não permitida: {url}")
    return url


def _hex_rgb(value: str) -> tuple[int, int, int] | None:
    raw = str(value or "").strip().lstrip("#")
    if len(raw) != 6:
        return None
    try:
        return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)
    except ValueError:
        return None


def _palette_distance(color: str, palette: list[str]) -> int:
    rgb = _hex_rgb(color)
    options = [item for item in (_hex_rgb(value) for value in palette) if item]
    if not rgb or not options:
        return 10**9
    return min(sum((a - b) ** 2 for a, b in zip(rgb, target)) for target in options)


def _text_relevance(photo: dict, terms: list[str]) -> int:
    haystack = " ".join((str(photo.get("url") or ""), str(photo.get("alt") or ""))).lower()
    return sum(1 for term in terms if str(term).strip().lower() in haystack)


class PexelsProvider:
    def __init__(
        self,
        api_key: str,
        opener: Callable = urllib.request.urlopen,
        timeout: int = 20,
        cache_ttl_seconds: int = 86400,
    ):
        self.api_key = api_key.strip()
        self.opener = opener
        self.timeout = timeout
        self.cache_ttl_seconds = cache_ttl_seconds

    def _read(self, response, limit: int) -> bytes:
        length = response.headers.get("Content-Length")
        if length and int(length) > limit:
            raise StockError("arquivo do banco de imagens excede o limite")
        data = response.read(limit + 1)
        if len(data) > limit:
            raise StockError("arquivo do banco de imagens excede o limite")
        return data

    def _cache_file(self, cache_dir: Path, query: str, color: str) -> Path:
        digest = hashlib.sha256(f"{query}\n{color}".encode()).hexdigest()
        return cache_dir / f"{digest}.json"

    def search(self, query: str, color: str, cache_dir: Path) -> list[dict]:
        query = " ".join(str(query).split())[:180]
        if not query:
            return []
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = self._cache_file(cache_dir, query, color)
        if cache_file.is_file() and time.time() - cache_file.stat().st_mtime < self.cache_ttl_seconds:
            try:
                cached = json.loads(cache_file.read_text(encoding="utf-8"))
                if isinstance(cached.get("photos"), list):
                    return cached["photos"]
            except (OSError, json.JSONDecodeError):
                pass

        params = {
            "query": query,
            "orientation": "portrait",
            "size": "large",
            "locale": "en-US",
            "per_page": "20",
        }
        if color:
            params["color"] = color
        url = PEXELS_API + "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(
            _safe_https(url, PEXELS_API_HOST),
            headers={"Authorization": self.api_key, "User-Agent": "PipeDesign/1.0"},
        )
        try:
            with self.opener(request, timeout=self.timeout) as response:
                payload = json.loads(self._read(response, 2 * 1024 * 1024))
        except Exception as exc:
            raise StockError(f"falha na busca Pexels: {exc}") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("photos"), list):
            raise StockError("resposta Pexels inválida")

        temp = cache_file.with_suffix(".tmp")
        temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(temp, cache_file)
        return payload["photos"]

    def _download(self, photo: dict, destination_dir: Path) -> str:
        source = photo.get("src") or {}
        url = source.get("portrait") or source.get("large2x") or source.get("original")
        if not isinstance(url, str):
            raise StockError("foto Pexels sem URL utilizável")
        request = urllib.request.Request(
            _safe_https(url, PEXELS_IMAGE_HOST),
            headers={"User-Agent": "PipeDesign/1.0"},
        )
        try:
            with self.opener(request, timeout=self.timeout) as response:
                mime = str(response.headers.get("Content-Type", "")).split(";", 1)[0].lower()
                if mime not in {"image/jpeg", "image/png"}:
                    raise StockError(f"tipo de imagem Pexels não permitido: {mime}")
                data = self._read(response, MAX_IMAGE_BYTES)
            with Image.open(BytesIO(data)) as image:
                image.verify()
        except StockError:
            raise
        except Exception as exc:
            raise StockError(f"falha no download Pexels: {exc}") from exc

        extension = ".png" if mime == "image/png" else ".jpg"
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination = destination_dir / f"{int(photo['id'])}{extension}"
        if not destination.is_file():
            with tempfile.NamedTemporaryFile(dir=destination_dir, delete=False) as temp:
                temp.write(data)
                temp_path = Path(temp.name)
            os.replace(temp_path, destination)
        return destination.name

    def prepare(self, client_root: Path, scenes: list[dict], palette: list[str]) -> list[dict]:
        target_dir = client_root / "Fotos" / "BANCO" / "PEXELS"
        cache_dir = target_dir / ".search-cache"
        selected: list[dict] = []
        used_ids: set[int] = set()
        preferred_photographer: int | None = None

        for scene in scenes:
            slide = int(scene.get("slide", 0))
            query = str(scene.get("query", "")).strip()
            relevance_terms = [str(term) for term in scene.get("relevance_terms", []) if str(term).strip()]
            if slide < 1 or not query:
                continue
            photos = self.search(query, str(scene.get("color") or "gray"), cache_dir)
            ranked = sorted(
                (photo for photo in photos if isinstance(photo, dict) and isinstance(photo.get("id"), int)),
                key=lambda photo: (
                    -_text_relevance(photo, relevance_terms),
                    0 if preferred_photographer and photo.get("photographer_id") == preferred_photographer else 1,
                    _palette_distance(str(photo.get("avg_color", "")), palette),
                    photo["id"],
                ),
            )
            photo = next((item for item in ranked if item["id"] not in used_ids), None)
            if not photo:
                continue
            used_ids.add(photo["id"])
            preferred_photographer = preferred_photographer or photo.get("photographer_id")
            file_name = self._download(photo, target_dir)
            relative_path = f"Fotos/BANCO/PEXELS/{file_name}"
            selected.append({
                "path": relative_path,
                "source": "pexels",
                "priority": 2,
                "product_verified": False,
                "recommended_slide": slide,
                "scene": str(scene.get("scene") or "contexto editorial"),
                "avg_color": photo.get("avg_color"),
                "width": photo.get("width"),
                "height": photo.get("height"),
                "analysis": {
                    "asset_type": "stock_scene",
                    "subjects": ["male_model"],
                    "products": ["unverified_clothing"],
                    "dominant_colors": [photo.get("avg_color")],
                    "background": str(scene.get("scene") or "editorial_scene"),
                    "shot_type": "lifestyle_editorial",
                    "composition": {
                        "subject_position": "center",
                        "negative_space": {"left": "medium", "right": "medium", "top": "medium", "bottom": "low"},
                    },
                    "style_keywords": ["editorial", "neutral", "minimalist", "lifestyle"],
                    "scene_evidence": relevance_terms,
                    "suitable_for": ["carousel_photo", "background"],
                },
                "attribution": {
                    "provider": "Pexels",
                    "provider_url": "https://www.pexels.com",
                    "photo_url": photo.get("url"),
                    "photographer": photo.get("photographer"),
                    "photographer_url": photo.get("photographer_url"),
                },
            })
        return selected
