#!/usr/bin/env python3
"""Rasterize game SVG source sprites to same-name PNG assets.

Install the renderer dependency with:
    python3 -m pip install -r tools/requirements-sprites.txt
"""

from pathlib import Path

import cairosvg


ASSET_DIR = Path(__file__).resolve().parent.parent / "public" / "assets" / "game"


def main():
    sources = sorted(ASSET_DIR.glob("*.svg"))
    if not sources:
        raise RuntimeError(f"No SVG sprite sources found in {ASSET_DIR}")

    for source in sources:
        output = source.with_suffix(".png")
        cairosvg.svg2png(url=str(source), write_to=str(output))
        print(f"Rendered {source.name} -> {output.name}")

    print(f"Rendered {len(sources)} PNG sprites.")


if __name__ == "__main__":
    main()
