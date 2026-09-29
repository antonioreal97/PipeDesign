"""Gera 3 versões do mesmo post 1080x1350 para testar a importação no Canva.

A: PDF via Chromium (HTML/CSS)      -> abordagem natural do futuro draft-renderer
B: PDF via ReportLab (1 pt = 1 px)   -> PDF "limpo", uma linha de texto por chamada
C: PPTX via python-pptx              -> caixas de texto nativas
"""
import asyncio, math, random, shutil
from pathlib import Path
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).parent
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)
FS = {
    "playfair": ROOT / "fontsource-playfair-display-5.3.0/package/files",
    "montserrat": ROOT / "fontsource-montserrat-5.3.0/package/files",
}
W, H = 1080, 1350

COPY = {
    "brand": "MARCA A",
    "headline": ["Nova coleção", "Inverno 26"],
    "sub": "Peças atemporais para os dias frios",
    "cta": "Conheça agora",
}
C_ACCENT = (200, 164, 110)  # dourado

# ---------------------------------------------------------------- foto placeholder
def make_photo(path: Path):
    """Imagem procedural (não é IA): substitui a foto real só para o teste."""
    random.seed(7)
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / H
        for x in range(W):
            s = x / W
            r = int(70 + 60 * (1 - t) + 20 * s)
            g = int(60 + 40 * (1 - t) + 10 * math.sin(s * 3))
            b = int(80 + 50 * t)
            px[x, y] = (r, g, b)
    d = ImageDraw.Draw(img)
    # "silhueta" abstrata à direita (espaço negativo à esquerda)
    d.ellipse((600, 180, 820, 420), fill=(40, 30, 35))
    d.polygon([(560, 420), (880, 420), (960, 1350), (480, 1350)], fill=(35, 25, 30))
    for _ in range(400):
        x, y = random.randrange(W), random.randrange(H)
        d.point((x, y), fill=(255, 255, 255))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    d = ImageDraw.Draw(img)
    d.text((24, H - 40), "PLACEHOLDER DE TESTE - substituir por foto real", fill=(230, 230, 230))
    img.save(path, "JPEG", quality=88)

# ---------------------------------------------------------------- fontes
# Nomes corretos: o subset do fontsource vem com "Montserrat Thin" na tabela name,
# o que poderia levar o Canva a trocar pela variante Thin.
NAMES = {
    "PlayfairDisplay-SemiBold": ("Playfair Display", "SemiBold"),
    "Montserrat-Regular": ("Montserrat", "Regular"),
    "Montserrat-SemiBold": ("Montserrat", "SemiBold"),
}

def woff2_to_ttf(src: Path, dst: Path, ps_name: str):
    family, style = NAMES[ps_name]
    f = TTFont(str(src))
    f.flavor = None
    name = f["name"]
    legacy_family = family if style in ("Regular", "Bold") else f"{family} {style}"
    legacy_style = style if style in ("Regular", "Bold") else "Regular"
    for rec in list(name.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17):
            name.removeNames(nameID=rec.nameID)
    for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0)):
        name.setName(legacy_family, 1, pid, eid, lid)
        name.setName(legacy_style, 2, pid, eid, lid)
        name.setName(f"{ps_name};pipedesign-test", 3, pid, eid, lid)
        name.setName(f"{family} {style}".replace(" Regular", ""), 4, pid, eid, lid)
        name.setName(ps_name, 6, pid, eid, lid)
        name.setName(family, 16, pid, eid, lid)
        name.setName(style, 17, pid, eid, lid)
    f.save(str(dst))

FONTS = {
    "PlayfairDisplay-SemiBold": FS["playfair"] / "playfair-display-latin-600-normal.woff2",
    "Montserrat-Regular": FS["montserrat"] / "montserrat-latin-400-normal.woff2",
    "Montserrat-SemiBold": FS["montserrat"] / "montserrat-latin-600-normal.woff2",
}

# ---------------------------------------------------------------- A: Chromium
HTML = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<style>
@font-face {{ font-family: 'Playfair Display'; font-weight: 600; src: url('{pf600}') format('truetype'); }}
@font-face {{ font-family: 'Montserrat'; font-weight: 400; src: url('{ms400}') format('truetype'); }}
@font-face {{ font-family: 'Montserrat'; font-weight: 600; src: url('{ms600}') format('truetype'); }}
@page {{ size: 1080px 1350px; margin: 0; }}
html, body {{ margin: 0; padding: 0; }}
.page {{ position: relative; width: 1080px; height: 1350px; overflow: hidden; background: #222; }}
.photo {{ position: absolute; inset: 0; width: 1080px; height: 1350px; object-fit: cover; }}
.shade {{ position: absolute; left: 0; right: 0; bottom: 0; height: 620px; background: rgba(12,10,12,0.62); }}
.logo-mark {{ position: absolute; left: 80px; top: 80px; width: 44px; height: 44px; border-radius: 50%; background: rgb{accent}; }}
.logo {{ position: absolute; left: 140px; top: 84px; font: 600 30px/36px 'Montserrat'; letter-spacing: 6px; color: #fff; }}
.headline {{ position: absolute; left: 80px; top: 830px; width: 900px; font: 600 112px/118px 'Playfair Display'; color: #fff; }}
.sub {{ position: absolute; left: 80px; top: 1080px; width: 900px; font: 400 38px/48px 'Montserrat'; color: #eee; }}
.cta {{ position: absolute; left: 80px; top: 1170px; width: 340px; height: 84px; border-radius: 42px; background: rgb{accent}; }}
.cta-text {{ position: absolute; left: 80px; top: 1170px; width: 340px; height: 84px; font: 600 30px/84px 'Montserrat'; color: #1a1a1a; text-align: center; }}
</style></head><body><div class="page">
<img class="photo" src="{photo}">
<div class="shade"></div>
<div class="logo-mark"></div>
<div class="logo">{brand}</div>
<div class="headline">{h1}<br>{h2}</div>
<div class="sub">{sub}</div>
<div class="cta"></div>
<div class="cta-text">{cta}</div>
</div></body></html>"""

async def make_chromium_pdf(photo: Path, dst: Path, ttf_dir: Path):
    from playwright.async_api import async_playwright
    html = HTML.format(
        pf600=(ttf_dir / "PlayfairDisplay-SemiBold.ttf").as_uri(),
        ms400=(ttf_dir / "Montserrat-Regular.ttf").as_uri(),
        ms600=(ttf_dir / "Montserrat-SemiBold.ttf").as_uri(),
        photo=photo.as_uri(), accent=C_ACCENT, brand=COPY["brand"],
        h1=COPY["headline"][0], h2=COPY["headline"][1], sub=COPY["sub"], cta=COPY["cta"],
    )
    page_file = ROOT / "work" / "post.html"
    page_file.write_text(html, encoding="utf-8")
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": W, "height": H})
        await page.goto(page_file.as_uri())
        await page.evaluate("document.fonts.ready")
        await page.screenshot(path=str(ROOT / "work" / "preview-A.png"))
        await page.pdf(path=str(dst), width="1080px", height="1350px", print_background=True,
                       margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
        await browser.close()

# ---------------------------------------------------------------- B: ReportLab
def make_reportlab_pdf(photo: Path, dst: Path, ttf_dir: Path):
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont as RLTTFont
    from reportlab.lib.colors import Color
    for name in FONTS:
        pdfmetrics.registerFont(RLTTFont(name, str(ttf_dir / f"{name}.ttf")))
    c = canvas.Canvas(str(dst), pagesize=(W, H), initialFontName="Montserrat-Regular", initialFontSize=38)
    c.setTitle("Teste B - ReportLab")
    Y = lambda top: H - top  # coordenadas a partir do topo
    c.drawImage(str(photo), 0, 0, W, H)
    c.setFillColor(Color(12/255, 10/255, 12/255, alpha=0.62))
    c.rect(0, 0, W, 620, stroke=0, fill=1)
    c.setFillAlpha(1)
    ar, ag, ab = (v / 255 for v in C_ACCENT)
    c.setFillColorRGB(ar, ag, ab)
    c.circle(80 + 22, Y(80 + 22), 22, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    t = c.beginText(140, Y(84 + 28)); t.setFont("Montserrat-SemiBold", 30); t.setCharSpace(6); t.textLine(COPY["brand"]); c.drawText(t)
    # headline como um único objeto de texto com 2 linhas
    t = c.beginText(80, Y(830 + 95)); t.setCharSpace(0); t.setFont("PlayfairDisplay-SemiBold", 112, leading=118)
    for line in COPY["headline"]:
        t.textLine(line)
    c.drawText(t)
    c.setFillColorRGB(0.93, 0.93, 0.93)
    t = c.beginText(80, Y(1080 + 37)); t.setCharSpace(0); t.setFont("Montserrat-Regular", 38); t.textLine(COPY["sub"]); c.drawText(t)
    c.setFillColorRGB(ar, ag, ab)
    c.roundRect(80, Y(1170 + 84), 340, 84, 42, stroke=0, fill=1)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    t = c.beginText(0, 0); t.setCharSpace(0); c.drawText(t)
    c.setFont("Montserrat-SemiBold", 30)
    c.drawCentredString(80 + 170, Y(1170 + 53), COPY["cta"])
    c.showPage()
    c.save()

# ---------------------------------------------------------------- C: PPTX
def make_pptx(photo: Path, dst: Path):
    from pptx import Presentation
    from pptx.util import Emu, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.oxml.ns import qn
    PX = 9525  # EMU por pixel (96 dpi)
    px = lambda v: Emu(int(v * PX))
    pt = lambda v: Pt(v * 0.75)  # px -> pt
    prs = Presentation()
    prs.slide_width, prs.slide_height = px(W), px(H)
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s.shapes.add_picture(str(photo), 0, 0, px(W), px(H)).name = "FOTO"

    shade = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, px(H - 620), px(W), px(620))
    shade.name = "SOMBRA"
    shade.fill.solid(); shade.fill.fore_color.rgb = RGBColor(12, 10, 12)
    # transparência 38% -> alpha 62%
    sf = shade.fill._xPr.find(qn("a:solidFill"))
    clr = sf.find(qn("a:srgbClr"))
    alpha = clr.makeelement(qn("a:alpha"), {"val": "62000"}); clr.append(alpha)
    shade.line.fill.background()

    mark = s.shapes.add_shape(MSO_SHAPE.OVAL, px(80), px(80), px(44), px(44))
    mark.name = "LOGO_MARCA"
    mark.fill.solid(); mark.fill.fore_color.rgb = RGBColor(*C_ACCENT); mark.line.fill.background()

    def text(name, left, top, width, height, lines, font, size, bold, color, align=PP_ALIGN.LEFT, spacing=None, anchor=MSO_ANCHOR.TOP):
        tb = s.shapes.add_textbox(px(left), px(top), px(width), px(height))
        tb.name = name
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        tf.vertical_anchor = anchor
        for i, line in enumerate(lines):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            r = p.add_run(); r.text = line
            f = r.font; f.name = font; f.size = pt(size); f.bold = bold; f.color.rgb = RGBColor(*color)
            if spacing is not None:
                r._r.get_or_add_rPr().set("spc", str(int(spacing * 0.75 * 100)))
        return tb

    text("LOGO", 140, 84, 400, 40, [COPY["brand"]], "Montserrat SemiBold", 30, False, (255, 255, 255), spacing=6)
    text("HEADLINE", 80, 830, 900, 240, COPY["headline"], "Playfair Display SemiBold", 112, False, (255, 255, 255))
    text("SUBHEADLINE", 80, 1080, 900, 60, [COPY["sub"]], "Montserrat", 38, False, (238, 238, 238))
    pill = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, px(80), px(1170), px(340), px(84))
    pill.name = "CTA_FUNDO"
    pill.adjustments[0] = 0.5
    pill.fill.solid(); pill.fill.fore_color.rgb = RGBColor(*C_ACCENT); pill.line.fill.background()
    text("CTA", 80, 1170, 340, 84, [COPY["cta"]], "Montserrat SemiBold", 30, False, (26, 26, 26), align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    prs.save(str(dst))

def main():
    work = ROOT / "work"; work.mkdir(exist_ok=True)
    ttf = work / "ttf"; ttf.mkdir(exist_ok=True)
    for name, src in FONTS.items():
        woff2_to_ttf(src, ttf / f"{name}.ttf", name)
    photo = work / "foto-teste.jpg"
    make_photo(photo)
    asyncio.run(make_chromium_pdf(photo, OUT / "teste-A-chromium.pdf", ttf))
    make_reportlab_pdf(photo, OUT / "teste-B-reportlab.pdf", ttf)
    make_pptx(photo, OUT / "teste-C-powerpoint.pptx")
    shutil.copy(photo, OUT / "foto-teste.jpg")
    for f in sorted(OUT.iterdir()):
        print(f.name, f.stat().st_size)

main()
