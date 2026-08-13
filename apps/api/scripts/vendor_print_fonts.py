#!/usr/bin/env python3
"""Vendor the print-PDF renderer's fonts (docs/adr/0162, print quality Phase 1).

The server-side card→PDF engine embeds the *exact* fonts the card editor offers
so printed text is true vector at the right weight/style. The editor's fonts are
Google Fonts (self-hosted in the web app via next/font); this script fetches
their upstream TTFs from the google/fonts repo and writes static Regular/Bold/
Italic/BoldItalic instances into ``src/print-pdf/fonts``.

Most families now ship only *variable* fonts upstream, so we instantiate real
static weights (wght=400/700) with fontTools' instancer — never faux-bold. The
few single-weight display faces (Pacifico, Lobster) and no-italic-axis scripts
(Dancing Script, Caveat) embed what exists; the engine synthesises the missing
bold/italic exactly as the browser does for those faces.

System-stack keys (Helvetica, Times New Roman, Courier New) are NOT vendored —
the engine maps them to PDF's built-in standard families (identical metrics).
"Georgia" maps to Gelasio, a metric-compatible substitute, embedded here.

Several *fallback* faces are also vendored (docs/adr/0162, Phase 3): Noto Sans
(broad Latin/Greek/Cyrillic + punctuation), Noto Sans Symbols (arrows, maths,
music), Noto Sans Symbols 2 (stars, card suits, dingbats, ticks) and Noto Emoji
(monochrome emoji). A glyph the chosen editor font lacks is drawn from the first
of these that covers it — instead of a missing-glyph box — matching what the
browser does with its own system fallback. Regular weight only: a fallback glyph
mid-word at the base weight is far better than a tofu box, and it keeps the
embedded subset small. Emoji are monochrome (a pdfkit PDF can't carry
colour-emoji tables).

Run manually (fonts are committed artifacts; this is provenance + reproducibility):
    python3 -m pip install fonttools brotli
    python3 apps/api/scripts/vendor_print_fonts.py

Licences (OFL-1.1 / Apache-2.0) are fetched alongside into fonts/licenses.
"""
from __future__ import annotations

import io
import os
import sys
import urllib.request
from fontTools import ttLib
from fontTools.varLib.instancer import instantiateVariableFont

RAW = "https://raw.githubusercontent.com/google/fonts/main"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "print-pdf", "fonts")
OUT = os.path.abspath(OUT)
LIC = os.path.join(OUT, "licenses")


def fetch(url: str, tries: int = 4) -> bytes:
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "kudos-font-vendor"})
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
            if len(data) < 512:
                raise RuntimeError(f"suspiciously small ({len(data)}b)")
            return data
        except Exception as e:  # noqa: BLE001 - retry any transient error
            last = e
            print(f"  retry {attempt + 1}/{tries} for {url}: {e}", file=sys.stderr)
    raise RuntimeError(f"failed to fetch {url}: {last}")


def save_static(raw_ttf: bytes, axes: dict, out_name: str) -> None:
    """Instantiate a variable font at the given axis pins and write a static TTF."""
    font = ttLib.TTFont(io.BytesIO(raw_ttf))
    if "fvar" in font:
        # Pin every axis: requested ones to their value, the rest to their default,
        # so the result is a fully static instance pdfkit/fontkit renders directly.
        pins = {a.axisTag: a.defaultValue for a in font["fvar"].axes}
        pins.update(axes)
        instantiateVariableFont(font, pins, inplace=True)
    out = os.path.join(OUT, out_name)
    font.save(out)
    print(f"  wrote {out_name} ({os.path.getsize(out)}b)")


def save_raw(raw_ttf: bytes, out_name: str) -> None:
    with open(os.path.join(OUT, out_name), "wb") as f:
        f.write(raw_ttf)
    print(f"  wrote {out_name} ({len(raw_ttf)}b)")


# family -> (upright variable/static source, italic source or None, is_variable, weights)
# Each entry lists the output files to produce.
VARIABLE_FAMILIES = {
    # dir, upright file, italic file (or None), family out-prefix
    "Montserrat": ("ofl/montserrat", "Montserrat[wght].ttf", "Montserrat-Italic[wght].ttf"),
    "Nunito": ("ofl/nunito", "Nunito[wght].ttf", "Nunito-Italic[wght].ttf"),
    "PlayfairDisplay": ("ofl/playfairdisplay", "PlayfairDisplay[wght].ttf", "PlayfairDisplay-Italic[wght].ttf"),
    "Lora": ("ofl/lora", "Lora[wght].ttf", "Lora-Italic[wght].ttf"),
    "Gelasio": ("ofl/gelasio", "Gelasio[wght].ttf", "Gelasio-Italic[wght].ttf"),
}

# Variable, upright only (no italic axis) -> Regular + Bold; italic synthesised by engine.
VARIABLE_UPRIGHT_ONLY = {
    "DancingScript": ("ofl/dancingscript", "DancingScript[wght].ttf"),
    "Caveat": ("ofl/caveat", "Caveat[wght].ttf"),
}

# Real static files upstream (family dir, {out_suffix: upstream_file}).
STATIC_FAMILIES = {
    "Poppins": ("ofl/poppins", {
        "Regular": "Poppins-Regular.ttf",
        "Bold": "Poppins-Bold.ttf",
        "Italic": "Poppins-Italic.ttf",
        "BoldItalic": "Poppins-BoldItalic.ttf",
    }),
    "Pacifico": ("ofl/pacifico", {"Regular": "Pacifico-Regular.ttf"}),
    "Lobster": ("ofl/lobster", {"Regular": "Lobster-Regular.ttf"}),
}

# Fallback faces (Phase 3), in the order the engine tries them. Each pins its
# variable axes to Regular (Noto Sans has a width axis too); Symbols 2 ships a
# real static Regular upstream (axes = None → written as-is).
FALLBACK_FONTS = {
    "NotoSans": ("ofl/notosans", "NotoSans[wdth,wght].ttf", {"wght": 400, "wdth": 100}),
    "NotoSansSymbols": ("ofl/notosanssymbols", "NotoSansSymbols[wght].ttf", {"wght": 400}),
    "NotoSansSymbols2": ("ofl/notosanssymbols2", "NotoSansSymbols2-Regular.ttf", None),
    "NotoEmoji": ("ofl/notoemoji", "NotoEmoji[wght].ttf", {"wght": 400}),
}

# family dir -> licence filename upstream (OFL.txt for all these).
LICENSE_DIRS = {
    "Montserrat": "ofl/montserrat",
    "Nunito": "ofl/nunito",
    "PlayfairDisplay": "ofl/playfairdisplay",
    "Lora": "ofl/lora",
    "Gelasio": "ofl/gelasio",
    "DancingScript": "ofl/dancingscript",
    "Caveat": "ofl/caveat",
    "Poppins": "ofl/poppins",
    "Pacifico": "ofl/pacifico",
    "Lobster": "ofl/lobster",
    "NotoSans": "ofl/notosans",
    "NotoSansSymbols": "ofl/notosanssymbols",
    "NotoSansSymbols2": "ofl/notosanssymbols2",
    "NotoEmoji": "ofl/notoemoji",
}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(LIC, exist_ok=True)

    for family, (d, upright, italic) in VARIABLE_FAMILIES.items():
        print(f"{family} (variable upright+italic)")
        up = fetch(f"{RAW}/{d}/{upright}")
        save_static(up, {"wght": 400}, f"{family}-Regular.ttf")
        save_static(up, {"wght": 700}, f"{family}-Bold.ttf")
        it = fetch(f"{RAW}/{d}/{italic}")
        save_static(it, {"wght": 400}, f"{family}-Italic.ttf")
        save_static(it, {"wght": 700}, f"{family}-BoldItalic.ttf")

    for family, (d, upright) in VARIABLE_UPRIGHT_ONLY.items():
        print(f"{family} (variable upright only)")
        up = fetch(f"{RAW}/{d}/{upright}")
        save_static(up, {"wght": 400}, f"{family}-Regular.ttf")
        save_static(up, {"wght": 700}, f"{family}-Bold.ttf")

    for family, (d, files) in STATIC_FAMILIES.items():
        print(f"{family} (static)")
        for suffix, fname in files.items():
            save_raw(fetch(f"{RAW}/{d}/{fname}"), f"{family}-{suffix}.ttf")

    for family, (d, upright, axes) in FALLBACK_FONTS.items():
        print(f"{family} (fallback → Regular)")
        raw = fetch(f"{RAW}/{d}/{upright}")
        if axes is None:
            save_raw(raw, f"{family}-Regular.ttf")
        else:
            save_static(raw, axes, f"{family}-Regular.ttf")

    print("licences")
    for family, d in LICENSE_DIRS.items():
        try:
            lic = fetch(f"{RAW}/{d}/OFL.txt")
        except Exception:  # noqa: BLE001
            lic = fetch(f"{RAW}/{d}/LICENSE.txt")
        with open(os.path.join(LIC, f"{family}-OFL.txt"), "wb") as f:
            f.write(lic)
        print(f"  wrote licenses/{family}-OFL.txt")

    print("done")


if __name__ == "__main__":
    main()
