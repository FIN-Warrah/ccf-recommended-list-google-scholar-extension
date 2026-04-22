"""
Extract color annotations from CCF 2026 PDF using PyMuPDF (fitz).
Legend from page 1:
  - 标黄 (yellow highlight): 新增 (newly added to list)
  - 红字 (red text): 晋级 (upgraded from 2022 v6)
  - 标蓝 (blue text): 降级 (downgraded from 2022 v6)
  - 删除线 (strikethrough): 删除 (removed from 2022 v6)
  - 绿字 (green text): 名称更新 (name updated)
"""
import fitz  # PyMuPDF
import json
import re
from collections import defaultdict

pdf_path = "ccf-2026会议期刊列表.pdf"

def classify_color(r, g, b):
    """Classify an RGB color (0-1 scale) into a category."""
    # Red
    if r > 0.7 and g < 0.3 and b < 0.3:
        return "RED"      # 晋级 (upgraded)
    # Blue
    if b > 0.5 and r < 0.3 and g < 0.3:
        return "BLUE"     # 降级 (downgraded)
    # Green
    if g > 0.4 and r < 0.3 and b < 0.3:
        return "GREEN"    # 名称更新 (name updated)
    # Yellow/highlight colors
    if r > 0.8 and g > 0.8 and b < 0.3:
        return "YELLOW"   # 新增 (newly added)
    # Black/very dark
    if r < 0.15 and g < 0.15 and b < 0.15:
        return "BLACK"
    # White
    if r > 0.9 and g > 0.9 and b > 0.9:
        return "WHITE"
    
    return f"RGB({r:.2f},{g:.2f},{b:.2f})"

doc = fitz.open(pdf_path)
print(f"Total pages: {len(doc)}")

# ===== Pass 1: Check for highlight annotations =====
print("\n=== CHECKING ANNOTATIONS ===")
for page_num in range(len(doc)):
    page = doc[page_num]
    annots = list(page.annots()) if page.annots() else []
    if annots:
        print(f"  Page {page_num+1}: {len(annots)} annotations")
        for a in annots[:10]:
            print(f"    Type: {a.type}, Rect: {a.rect}, Color: {a.colors}")

# ===== Pass 2: Extract text with color info using dict extraction =====
print("\n=== EXTRACTING TEXT COLORS ===")

# Section tracking
category_pattern_journal = re.compile(r"中国计算机学会推荐国际学术期刊\s*[（(](.+?)[）)]", re.DOTALL)
category_pattern_conf = re.compile(r"中国计算机学会推荐国际学术会议\s*[（(](.+?)[）)]", re.DOTALL)
level_pattern = re.compile(r"[一二三]、([ABC])\s*类")

current_category = ""
current_type = ""
current_level = ""

all_colored_entries = []
unique_colors = set()

for page_num in range(len(doc)):
    page = doc[page_num]
    page_text = page.get_text()
    
    # Track section context
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
    
    # Extract text with formatting using "dict" output
    blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
    
    for block in blocks:
        if block["type"] != 0:  # text block
            continue
        
        for line in block["lines"]:
            line_colors = set()
            line_text_parts = []
            colored_parts = []
            has_highlight = False
            
            for span in line["spans"]:
                text = span["text"].strip()
                if not text:
                    continue
                
                # Get text color
                color_int = span["color"]
                r = ((color_int >> 16) & 0xFF) / 255.0
                g = ((color_int >> 8) & 0xFF) / 255.0
                b = (color_int & 0xFF) / 255.0
                
                cn = classify_color(r, g, b)
                unique_colors.add((cn, r, g, b))
                
                line_text_parts.append(text)
                
                if cn not in ("BLACK", "WHITE"):
                    line_colors.add(cn)
                    colored_parts.append((text, cn, f"({r:.2f},{g:.2f},{b:.2f})"))
            
            # Also check for highlight (background) via drawings
            # (handled separately below)
            
            if line_colors and page_num > 0:  # Skip legend page
                full_line = ' '.join(line_text_parts)
                # Skip very short lines or non-entry lines
                if len(full_line) < 3:
                    continue
                
                all_colored_entries.append({
                    'page': page_num + 1,
                    'level': current_level,
                    'type': current_type,
                    'category': current_category,
                    'colors': list(line_colors),
                    'colored_parts': [(t, c) for t, c, _ in colored_parts],
                    'full_line': full_line[:100],
                })

# ===== Pass 3: Check for highlight rectangles (yellow background) =====
print("\n=== CHECKING HIGHLIGHT DRAWINGS ===")
highlight_entries = []

for page_num in range(len(doc)):
    if page_num == 0:
        continue
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
    
    # Get drawings (paths) that might be highlights
    drawings = page.get_drawings()
    for d in drawings:
        if d.get("fill"):
            fill = d["fill"]
            if len(fill) >= 3:
                r, g, b = fill[0], fill[1], fill[2]
                cn = classify_color(r, g, b)
                if cn == "YELLOW" or (r > 0.8 and g > 0.5 and b < 0.5):
                    rect = d.get("rect")
                    if rect:
                        # Find text within this rectangle
                        text_in_rect = page.get_text("text", clip=rect).strip()
                        if text_in_rect and len(text_in_rect) > 2:
                            print(f"  Page {page_num+1}: Yellow rect -> '{text_in_rect[:60]}' (color: {r:.2f},{g:.2f},{b:.2f})")
                            highlight_entries.append({
                                'page': page_num + 1,
                                'level': current_level,
                                'type': current_type,
                                'category': current_category,
                                'color': 'YELLOW',
                                'change_type': '新增',
                                'text': text_in_rect,
                            })

# ===== Summary =====
print("\n" + "="*80)
print("ALL UNIQUE COLORS FOUND")
print("="*80)
for cn, r, g, b in sorted(unique_colors):
    print(f"  {cn:20s} = ({r:.3f}, {g:.3f}, {b:.3f})")

print("\n" + "="*80)
print(f"COLORED TEXT ENTRIES (non-black): {len(all_colored_entries)}")
print("="*80)
for e in all_colored_entries:
    change_types = []
    for c in e['colors']:
        if c == 'RED' or 'RED' in c:
            change_types.append('晋级')
        elif c == 'BLUE' or 'BLUE' in c:
            change_types.append('降级')
        elif c == 'GREEN' or 'GREEN' in c:
            change_types.append('名称更新')
        else:
            change_types.append(f'颜色:{c}')
    
    print(f"  [{e['level']}] {e['type']:10s} | {', '.join(change_types):10s} | {e['full_line'][:70]}")
    if e['colored_parts']:
        print(f"    Colored: {e['colored_parts']}")

print(f"\nYELLOW HIGHLIGHT (新增) ENTRIES: {len(highlight_entries)}")
for e in highlight_entries:
    print(f"  [{e['level']}] {e['type']:10s} | 新增 | {e['text'][:70]}")

# ===== Save all changes =====
all_changes = []
for e in all_colored_entries:
    for c in e['colors']:
        change_type = '晋级' if 'RED' in c else ('降级' if 'BLUE' in c else ('名称更新' if 'GREEN' in c else c))
        all_changes.append({
            'page': e['page'],
            'level': e['level'],
            'type': e['type'],
            'category': e['category'],
            'change_type': change_type,
            'text': e['full_line'],
            'colored_parts': e['colored_parts'],
        })
for e in highlight_entries:
    all_changes.append(e)

with open("ccf_changes.json", "w", encoding="utf-8") as f:
    json.dump(all_changes, f, ensure_ascii=False, indent=2)
print(f"\nTotal changes found: {len(all_changes)}")
print(f"Saved to ccf_changes.json")

doc.close()
