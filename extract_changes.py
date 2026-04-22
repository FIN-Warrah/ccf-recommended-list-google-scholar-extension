"""
Extract change annotations from the CCF 2026 PDF.
Look for markers like: 新增, 升级, 降级, 剔除, ★, ▲, ▼, etc.
Also examine table cell content for any annotations.
"""
import pdfplumber
import re
import json

pdf_path = "ccf-2026会议期刊列表.pdf"

# ===== Pass 1: Extract ALL raw text to find annotation patterns =====
print("="*80)
print("PASS 1: Raw text extraction - looking for change markers")
print("="*80)

change_keywords = ['新增', '升级', '降级', '剔除', '调整', '变动', '变更', '新申请', 
                   '直接申请', '备注', '说明', '注：', '注:', '★', '▲', '▼', '●', '◆',
                   '※', '☆', '*', '†', '‡', '增补', '替换', '移入', '移出',
                   '原', '更名', '合并']

with pdfplumber.open(pdf_path) as pdf:
    print(f"Total pages: {len(pdf.pages)}")
    
    for page_num, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        
        # Check for any change-related keywords
        found_keywords = []
        for kw in change_keywords:
            if kw in text:
                found_keywords.append(kw)
        
        if found_keywords:
            print(f"\n--- Page {page_num+1} ---")
            print(f"  Keywords found: {found_keywords}")
            # Print relevant lines
            for line in text.split('\n'):
                for kw in change_keywords:
                    if kw in line:
                        print(f"  LINE: {line.strip()}")
                        break

# ===== Pass 2: Detailed table examination =====
print("\n" + "="*80)
print("PASS 2: Detailed table cell examination")
print("="*80)

category_pattern_journal = re.compile(r"中国计算机学会推荐国际学术期刊\s*[（(](.+?)[）)]", re.DOTALL)
category_pattern_conf = re.compile(r"中国计算机学会推荐国际学术会议\s*[（(](.+?)[）)]", re.DOTALL)
level_pattern = re.compile(r"[一二三]、([ABC])\s*类")

current_category = ""
current_type = ""
current_level = ""

annotated_entries = []

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        
        m_journal = category_pattern_journal.search(text)
        m_conf = category_pattern_conf.search(text)
        
        if m_journal:
            current_category = re.sub(r'\s+', ' ', m_journal.group(1).replace('\n', ' ')).strip()
            current_type = "journal"
        elif m_conf:
            current_category = re.sub(r'\s+', ' ', m_conf.group(1).replace('\n', ' ')).strip()
            current_type = "conference"
        
        m_level = level_pattern.search(text)
        if m_level:
            current_level = m_level.group(1)
        
        tables = page.extract_tables()
        for table in tables:
            if not table:
                continue
            
            # Print ALL columns for each row to find annotations
            for row in table:
                if not row or row[0] == '序号' or row[0] is None:
                    continue
                try:
                    seq = int(row[0])
                except (ValueError, TypeError):
                    continue
                
                # Check ALL cells for annotation markers
                row_text = ' | '.join(str(c) for c in row if c)
                has_annotation = False
                annotations = []
                
                for kw in change_keywords:
                    if kw in row_text:
                        has_annotation = True
                        annotations.append(kw)
                
                # Also check for extra columns beyond the standard 5
                if len(row) > 5:
                    extra = [str(c).strip() for c in row[5:] if c and str(c).strip()]
                    if extra:
                        has_annotation = True
                        annotations.extend(extra)
                
                if has_annotation:
                    abbr = str(row[1]).strip() if row[1] else ""
                    full_name = str(row[2]).strip() if row[2] else ""
                    print(f"  [{current_level}] {abbr:15s} | {full_name[:50]:50s} | {current_type:10s} | {current_category}")
                    print(f"       Annotations: {annotations}")
                    print(f"       Full row ({len(row)} cols): {[str(c)[:30] if c else '' for c in row]}")
                    annotated_entries.append({
                        'abbreviation': abbr,
                        'full_name': full_name,
                        'category': current_category,
                        'type': current_type,
                        'level': current_level,
                        'annotations': annotations,
                        'page': page_num + 1,
                    })

print(f"\nTotal annotated entries: {len(annotated_entries)}")

# ===== Pass 3: Check for footnotes, header/footer annotations =====
print("\n" + "="*80)
print("PASS 3: Looking for footnote-style change descriptions")
print("="*80)

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        lines = text.split('\n')
        
        # Look for footnote-like lines (after tables, typically short explanatory text)
        in_footnote = False
        for i, line in enumerate(lines):
            line_stripped = line.strip()
            # Skip header/table rows
            if not line_stripped:
                continue
            # Look for annotation patterns
            if re.search(r'(注[：:]|说明[：:]|备注[：:]|标[★▲▼●]|[★▲▼●◆※].*表示)', line_stripped):
                in_footnote = True
            if in_footnote or re.search(r'[★▲▼●◆※☆†‡]', line_stripped):
                print(f"  Page {page_num+1}, Line {i+1}: {line_stripped}")

# ===== Pass 4: Look at raw characters for hidden annotations =====
print("\n" + "="*80)
print("PASS 4: Checking for special Unicode characters in abbreviation/name columns")
print("="*80)

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        m_journal = category_pattern_journal.search(text)
        m_conf = category_pattern_conf.search(text)
        if m_journal:
            current_category = re.sub(r'\s+', ' ', m_journal.group(1).replace('\n', ' ')).strip()
            current_type = "journal"
        elif m_conf:
            current_category = re.sub(r'\s+', ' ', m_conf.group(1).replace('\n', ' ')).strip()
            current_type = "conference"
        
        m_level = level_pattern.search(text)
        if m_level:
            current_level = m_level.group(1)
        
        tables = page.extract_tables()
        for table in tables:
            if not table:
                continue
            for row in table:
                if not row or row[0] == '序号':
                    continue
                try:
                    seq = int(row[0])
                except (ValueError, TypeError):
                    continue
                
                # Check for non-ASCII non-CJK characters that might be markers
                for ci, cell in enumerate(row):
                    if not cell:
                        continue
                    cell_str = str(cell)
                    special = [c for c in cell_str if ord(c) > 127 and not (0x4E00 <= ord(c) <= 0x9FFF) and not (0x3000 <= ord(c) <= 0x303F) and c not in '（）：，、。；""''【】《》']
                    if special and ci in [1, 2]:  # abbreviation or full_name columns
                        abbr = str(row[1]).strip() if row[1] else ""
                        print(f"  Page {page_num+1} [{current_level}] Col{ci} {abbr:15s}: special chars = {special} (ord: {[hex(ord(c)) for c in special]})")

# ===== Pass 5: Look at column headers =====
print("\n" + "="*80)
print("PASS 5: Table headers (first rows)")
print("="*80)

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages):
        tables = page.extract_tables()
        for ti, table in enumerate(tables):
            if not table:
                continue
            # Print first 2 rows which might be headers
            for ri in range(min(2, len(table))):
                row = table[ri]
                if row:
                    print(f"  Page {page_num+1}, Table {ti}, Row {ri}: {row}")

print("\n\nDone!")
