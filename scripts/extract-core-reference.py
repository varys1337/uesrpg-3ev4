"""Extract reviewable rule sections from the user-supplied Core PDF.

This is an offline authoring aid. It does not infer mechanics or change Items.
The checked-in reference retains page/column provenance for reconciliation.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

import pypdfium2 as pdfium
from pypdf import PdfReader


def key(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def chapter(page):
    for start, number in [(241, 9), (188, 8), (167, 7), (125, 6), (96, 5),
                          (71, 4), (62, 3), (24, 2), (10, 1)]:
        if page >= start:
            return number
    return None


def extract(pdf_path):
    reader = PdfReader(pdf_path)
    pdf = pdfium.PdfDocument(str(pdf_path))
    sections = []
    current = None
    for index, source_page in enumerate(reader.pages):
        page_number = index + 1
        if page_number < 24:
            continue
        headings = [dict(), dict()]

        def visit(text, _cm, tm, font, _size):
            name = str((font or {}).get("/BaseFont", ""))
            heading_font = "Jubilee" in name
            skill_heading = page_number in (123, 206, 219) and text.strip().startswith(("Skill:", "Bestial Instinct ("))
            disease_heading = page_number in (120, 121) and text.strip() in ("Ash Chancre", "Ash Woe Blight", "Black-Heart Blight", "Chanthrax Blight")
            soulsnare_heading = page_number == 152 and text.strip() == "Soulsnare"
            bold_reference_heading = ((60 <= page_number <= 70 or 92 <= page_number <= 95
                                       or page_number in (123, 206, 219, 224, 225))
                                      and "AGaramondPro-Bold" in name and len(text.strip()) < 65
                                      and (abs(tm[4] - 36) < 3 or abs(tm[4] - 315) < 3))
            if not (heading_font or bold_reference_heading or skill_heading or disease_heading) or not text.strip() or tm[5] <= 30:
                return
            column = 0 if tm[4] < 306 else 1
            heading = text.strip()
            headings[column][key(heading)] = {
                "name": heading, "entryHeading": "Light" in name or "Bold" in name
                or bold_reference_heading or skill_heading or disease_heading or soulsnare_heading or heading.startswith("Rite of "),
            }

        source_page.extract_text(visitor_text=visit)
        page = pdf[index]
        width, height = page.get_size()
        textpage = page.get_textpage()
        for column, (left, right) in enumerate([(0, width / 2 - 5), (width / 2 + 5, width)]):
            lines = [line.strip() for line in textpage.get_text_bounded(left, 30, right, height - 20).splitlines()]
            offset = 0
            while offset < len(lines):
                line = lines[offset]
                heading = headings[column].get(key(line)) if line else None
                if not heading and offset + 1 < len(lines):
                    heading = headings[column].get(key(line + " " + lines[offset + 1]))
                    if heading:
                        offset += 1
                if heading:
                    current = None
                    if heading["entryHeading"]:
                        current = {"name": heading["name"], "page": page_number,
                                   "column": column + 1, "chapter": chapter(page_number), "lines": []}
                        sections.append(current)
                elif current is not None and line and line != str(page_number):
                    current["lines"].append(line)
                offset += 1
        textpage.close()
        page.close()
    pdf.close()
    for section in sections:
        section["text"] = "\n".join(section.pop("lines"))
    return {"book": "UESRPG 3e v4 - Rules Compendium", "pages": len(reader.pages),
            "sha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
            "extraction": "Typography and column boundaries; mechanical values require source review.",
            "sections": sections}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent
                        / "docs/compendium-cleanup/core-reference.json")
    args = parser.parse_args()
    result = extract(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Extracted {len(result['sections'])} sections from {result['pages']} pages to {args.output}")


if __name__ == "__main__":
    main()
