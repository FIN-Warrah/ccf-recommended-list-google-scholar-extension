"""
Look for strikethrough/deleted entries in the CCF 2026 PDF.
These would be entries marked with strikethrough text (删除线).
PyMuPDF can detect strikethrough via text flags.
"""
import fitz
import re
from collections import defaultdict

pdf_path = "ccf-2026会议期刊列表.pdf"
doc = fitz.open(pdf_path)

category_pattern_journal = re.compile(r"中国计算机学会推荐国际学术期刊\s*[（(](.+?)[）)]", re.DOTALL)
category_pattern_conf = re.compile(r"中国计算机学会推荐国际学术会议\s*[（(](.+?)[）)]", re.DOTALL)
level_pattern = re.compile(r"[一二三]、([ABC])\s*类")

current_category = ""
current_type = ""
current_level = ""

# ===== Method 1: Check text flags for strikethrough =====
print("=== METHOD 1: Check span flags for strikethrough ===")
# fitz text flags: bit 0=superscript, bit 1=italic, bit 2=serif, bit 3=monospace, bit 4=bold
# Strikethrough is typically in annotations, not text flags
# But let's check all flags

all_flags = set()
strikethrough_entries = []

for page_num in range(len(doc)):
    page = doc[page_num]
    page_text = page.get_text()
    
    m_journal = category_pattern_journal.search(page_text)
    m_conf = category_pattern_conf.search(page_text)
    if m_journal:
        current_category = re.sub(r'\s+', ' ', m_journal.group(1)).strip()
        current_type = "journal"
    elif m_conf:
        current_category = re.sub(r'\s+', ' ', m_conf.group(1)).strip()
        current_type = "conference"
    m_level = level_pattern.search(page_text)
    if m_level:
        current_level = m_level.group(1)
    
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    for block in blocks:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                flags = span.get("flags", 0)
                all_flags.add(flags)
                text = span["text"].strip()
                if not text:
                    continue
                # Check for unusual flags that might indicate strikethrough
                # Standard flags: 0=normal, 4=serif, 16=bold, 20=bold+serif, etc.
                if flags not in (0, 4, 16, 20, 2, 6, 18, 22):
                    print(f"  Page {page_num+1} flags={flags} | '{text[:50]}'")

print(f"\nAll unique flags: {sorted(all_flags)}")

# ===== Method 2: Check for strikethrough annotations =====
print("\n=== METHOD 2: Check annotations for strikethrough ===")
for page_num in range(len(doc)):
    page = doc[page_num]
    annots = list(page.annots()) if page.annots() else []
    for annot in annots:
        atype = annot.type
        print(f"  Page {page_num+1}: type={atype}, info={annot.info}, rect={annot.rect}")

# ===== Method 3: Check for line drawings that cross text (strikethrough lines) =====
print("\n=== METHOD 3: Check for strikethrough line drawings ===")
for page_num in range(len(doc)):
    if page_num == 0:
        continue
    page = doc[page_num]
    drawings = page.get_drawings()
    
    for d in drawings:
        # Look for thin horizontal lines that could be strikethrough
        items = d.get("items", [])
        fill = d.get("fill")
        stroke = d.get("color")
        width = d.get("width", 0)
        rect = d.get("rect")
        
        if not rect:
            continue
        
        height = rect.y1 - rect.y0
        w = rect.x1 - rect.x0
        
        # Strikethrough: thin horizontal line (height < 3px, width > 20px)
        if height < 3 and w > 20:
            # Check if this line overlaps with text
            text_under = page.get_text("text", clip=fitz.Rect(rect.x0, rect.y0 - 10, rect.x1, rect.y1 + 10)).strip()
            if text_under and len(text_under) > 2:
                # Skip if it's just a table border
                if 'http' not in text_under and len(text_under) < 100:
                    print(f"  Page {page_num+1}: line h={height:.1f} w={w:.0f} | text nearby: '{text_under[:60]}'")
                    print(f"    stroke={stroke}, fill={fill}, width={width}")

# ===== Method 4: Look for "删除" text in the PDF =====
print("\n=== METHOD 4: Search for 删除 keyword ===")
for page_num in range(len(doc)):
    page = doc[page_num]
    text = page.get_text()
    if "删除" in text:
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if "删除" in line:
                context = lines[max(0,i-1):i+2]
                print(f"  Page {page_num+1}: {' | '.join(c.strip() for c in context)}")

# ===== Method 5: Check all table rows more carefully =====
# Look for text that seems to be in a different style within tables
print("\n=== METHOD 5: Check for grey/faded text (possible deleted entries) ===")
for page_num in range(1, len(doc)):
    page = doc[page_num]
    page_text = page.get_text()
    
    m_journal = category_pattern_journal.search(page_text)
    m_conf = category_pattern_conf.search(page_text)
    if m_journal:
        current_category = re.sub(r'\s+', ' ', m_journal.group(1)).strip()
        current_type = "journal"
    elif m_conf:
        current_category = re.sub(r'\s+', ' ', m_conf.group(1)).strip()
        current_type = "conference"
    m_level = level_pattern.search(page_text)
    if m_level:
        current_level = m_level.group(1)
    
    blocks = page.get_text("dict")["blocks"]
    for block in blocks:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"].strip()
                if not text or len(text) < 2:
                    continue
                color_int = span["color"]
                r = ((color_int >> 16) & 0xFF) / 255.0
                g = ((color_int >> 8) & 0xFF) / 255.0
                b = (color_int & 0xFF) / 255.0
                # Grey text (not black, not colored)
                if 0.3 < r < 0.7 and 0.3 < g < 0.7 and 0.3 < b < 0.7:
                    print(f"  Page {page_num+1} [{current_level}] GREY ({r:.2f},{g:.2f},{b:.2f}) | '{text[:50]}'")

doc.close()
