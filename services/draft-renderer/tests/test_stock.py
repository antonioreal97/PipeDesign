from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

from PIL import Image

from renderer.stock import PexelsProvider


class FakeResponse:
    def __init__(self, data: bytes, content_type: str):
        self.data = data
        self.headers = {"Content-Type": content_type, "Content-Length": str(len(data))}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, size=-1):
        return self.data if size < 0 else self.data[:size]


def _jpeg() -> bytes:
    output = BytesIO()
    Image.new("RGB", (600, 900), (105, 110, 115)).save(output, format="JPEG")
    return output.getvalue()


def test_pexels_prepara_foto_local_com_credito(tmp_path: Path):
    calls = []
    photo = {
        "id": 101,
        "width": 2400,
        "height": 3600,
        "url": "https://www.pexels.com/photo/editorial-101/",
        "photographer": "Pessoa Fotógrafa",
        "photographer_url": "https://www.pexels.com/@pessoa",
        "photographer_id": 9,
        "avg_color": "#686D72",
        "src": {"portrait": "https://images.pexels.com/photos/101/editorial.jpg"},
    }

    def opener(request, timeout):
        calls.append(request.full_url)
        if request.full_url.startswith("https://api.pexels.com/"):
            return FakeResponse(json.dumps({"photos": [photo]}).encode(), "application/json")
        return FakeResponse(_jpeg(), "image/jpeg")

    provider = PexelsProvider("test-key", opener=opener)
    candidates = provider.prepare(
        tmp_path / "clients/exemplo",
        [{"slide": 3, "scene": "treino", "query": "man workout gray polo", "color": "gray"}],
        ["#050505", "#E8E3DD", "#3F6C75"],
    )

    assert len(candidates) == 1
    assert candidates[0]["path"] == "Fotos/BANCO/PEXELS/101.jpg"
    assert candidates[0]["product_verified"] is False
    assert candidates[0]["attribution"]["photographer"] == "Pessoa Fotógrafa"
    assert (tmp_path / "clients/exemplo/Fotos/BANCO/PEXELS/101.jpg").is_file()
    assert any("orientation=portrait" in call and "color=gray" in call for call in calls)


def test_busca_pexels_usa_cache_de_24_horas(tmp_path: Path):
    requests = 0

    def opener(request, timeout):
        nonlocal requests
        requests += 1
        return FakeResponse(b'{"photos": []}', "application/json")

    provider = PexelsProvider("test-key", opener=opener)
    cache = tmp_path / "cache"
    assert provider.search("office", "gray", cache) == []
    assert provider.search("office", "gray", cache) == []
    assert requests == 1


def test_preparo_prioriza_evidencia_da_cena_antes_da_paleta(tmp_path: Path):
    generic = {
        "id": 201, "width": 1200, "height": 1800,
        "url": "https://www.pexels.com/photo/man-in-gray-polo-201/",
        "alt": "Portrait of a man wearing a gray polo shirt.",
        "photographer": "Studio", "photographer_url": "https://www.pexels.com/@studio",
        "photographer_id": 1, "avg_color": "#050505",
        "src": {"portrait": "https://images.pexels.com/photos/201/generic.jpg"},
    }
    scene = {
        "id": 202, "width": 1200, "height": 1800,
        "url": "https://www.pexels.com/photo/man-workout-at-gym-202/",
        "alt": "Man doing a workout in a modern gym.",
        "photographer": "Lifestyle", "photographer_url": "https://www.pexels.com/@lifestyle",
        "photographer_id": 2, "avg_color": "#D6B58C",
        "src": {"portrait": "https://images.pexels.com/photos/202/gym.jpg"},
    }

    def opener(request, timeout):
        if request.full_url.startswith("https://api.pexels.com/"):
            return FakeResponse(json.dumps({"photos": [generic, scene]}).encode(), "application/json")
        return FakeResponse(_jpeg(), "image/jpeg")

    provider = PexelsProvider("test-key", opener=opener)
    candidates = provider.prepare(
        tmp_path / "clients/exemplo",
        [{"slide": 3, "scene": "treino", "query": "man workout at gym", "color": "", "relevance_terms": ["gym", "workout"]}],
        ["#050505"],
    )

    assert candidates[0]["path"] == "Fotos/BANCO/PEXELS/202.jpg"
    assert candidates[0]["analysis"]["scene_evidence"] == ["gym", "workout"]
