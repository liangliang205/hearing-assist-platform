# -*- coding: utf-8 -*-
"""Extract structured text from the graduation-project DOCX files."""
import os
import sys
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn

SOURCES = [
    (r"D:\dsh_workspace\梁境峰 MVP个人开发计划.docx", "01_MVP个人开发计划"),
    (r"D:\dsh_workspace\梁境峰 软件工程 开题报告.docx", "02_开题报告"),
    (r"D:\dsh_workspace\梁境峰 软件开发流程.docx", "03_软件开发流程"),
    (r"D:\dsh_workspace\项目文档①软件需求规格说明书.docx", "04_软件需求规格说明书"),
    (r"D:\dsh_workspace\项目文档②系统设计说明书.docx", "05_系统设计说明书"),
    (r"D:\dsh_workspace\项目文档③数据库设计说明书.docx", "06_数据库设计说明书"),
    (r"D:\dsh_workspace\项目文档④接口规范.docx", "07_接口规范"),
    (r"D:\dsh_workspace\项目文档⑤测试用例与实验记录.docx", "08_测试用例与实验记录"),
    (r"E:\Users\liang\Documents\0 软件工程 论文模板(20250708).docx", "09_论文模板"),
    (r"E:\Users\liang\Documents\2 软件工程 中期检查报告(20250708).docx", "10_中期检查报告模板"),
]

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "doc_extract")
os.makedirs(OUT_DIR, exist_ok=True)


def iter_block_items(parent):
    """Yield Paragraph and Table objects in document order."""
    body = parent.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def dump_table(tbl, lines, depth=0):
    prefix = "  " * depth
    for row in tbl.rows:
        cells = []
        for cell in row.cells:
            txt = " / ".join(p.text.strip() for p in cell.paragraphs if p.text.strip())
            cells.append(txt.replace("\n", " "))
        lines.append(prefix + "| " + " | ".join(cells) + " |")
    lines.append("")


def dump(path, out_path):
    doc = Document(path)
    lines = []
    lines.append("FILE: " + path)
    try:
        cp = doc.core_properties
        lines.append("CORE: title=%r author=%r created=%s modified=%s" % (
            cp.title, cp.author, cp.created, cp.modified))
    except Exception as e:
        lines.append("CORE: (unavailable) %s" % e)
    lines.append("PARAGRAPHS=%d TABLES=%d SECTIONS=%d" % (
        len(doc.paragraphs), len(doc.tables), len(doc.sections)))
    lines.append("=" * 80)

    for block in iter_block_items(doc):
        if isinstance(block, Paragraph):
            text = block.text.strip()
            style = block.style.name if block.style is not None else ""
            if not text:
                continue
            lines.append("[%s] %s" % (style, text))
        else:
            lines.append("<<TABLE %d rows x %d cols>>" % (len(block.rows), len(block.columns)))
            dump_table(block, lines)
            lines.append("<<END TABLE>>")

    # Also list heading outline explicitly for quick scanning
    lines.append("")
    lines.append("=" * 80)
    lines.append("OUTLINE (paragraphs with Heading/Title styles or bold):")
    for p in doc.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        s = p.style.name if p.style is not None else ""
        if s.startswith("Heading") or s in ("Title", "Subtitle") or "标题" in s:
            lines.append("  %-14s %s" % (s, t[:160]))

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return len(lines), sum(len(l.encode("utf-8")) for l in lines)


def main():
    index = []
    for src, name in SOURCES:
        if not os.path.isfile(src):
            print("MISSING:", src)
            continue
        out = os.path.join(OUT_DIR, name + ".txt")
        nlines, nbytes = dump(src, out)
        index.append((name, src, nlines, nbytes))
        print("OK  %-28s %5d lines %8d bytes -> %s" % (name, nlines, nbytes, out))
    with open(os.path.join(OUT_DIR, "_index.txt"), "w", encoding="utf-8") as f:
        for name, src, nlines, nbytes in index:
            f.write("%s\t%s\t%d lines\t%d bytes\n" % (name, src, nlines, nbytes))


if __name__ == "__main__":
    main()
