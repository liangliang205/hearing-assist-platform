# -*- coding: utf-8 -*-
"""Extract text from a few extra school notice DOCX files by path."""
import os
import sys
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "doc_extract")
os.makedirs(OUT_DIR, exist_ok=True)


def iter_block_items(parent):
    for child in parent.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def dump(src, out):
    doc = Document(src)
    lines = ["FILE: " + src, "=" * 80]
    for block in iter_block_items(doc):
        if isinstance(block, Paragraph):
            t = block.text.strip()
            if t:
                lines.append("[%s] %s" % (block.style.name if block.style else "", t))
        else:
            lines.append("<<TABLE %dx%d>>" % (len(block.rows), len(block.columns)))
            for row in block.rows:
                cells = []
                seen = set()
                for c in row.cells:
                    if id(c._tc) in seen:
                        continue
                    seen.add(id(c._tc))
                    txt = " / ".join(p.text.strip() for p in c.paragraphs if p.text.strip())
                    cells.append(txt.replace("\n", " "))
                lines.append("| " + " | ".join(cells) + " |")
            lines.append("<<END TABLE>>")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("OK", os.path.basename(out), len(lines), "lines")


if __name__ == "__main__":
    pairs = [
        (r"E:\Users\liang\Documents\xwechat_files\wxid_oya2zzzy5n1j22_7615\msg\file\2026-09\毕设时间节点_更新版.docx", "11_毕设时间节点.txt"),
        (r"E:\Users\liang\Documents\xwechat_files\wxid_oya2zzzy5n1j22_7615\msg\file\2026-09\上交材料要求.docx", "12_上交材料要求.txt"),
    ]
    for src, name in pairs:
        if os.path.isfile(src):
            dump(src, os.path.join(OUT_DIR, name))
        else:
            print("MISSING", src)
