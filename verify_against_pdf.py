"""
Verify ccf_rankings.json against the original CCF 2026 PDF.
Extracts entries from both and reports differences:
- Missing from JSON (in PDF but not in JSON)
- Extra in JSON (in JSON but not in PDF)
- Level mismatches
- Category mismatches
"""
import pdfplumber
import json
import re
from collections import defaultdict

pdf_path = "ccf-2026会议期刊列表.pdf"
json_path = "ccf_rankings.json"

# ===== Extract from PDF =====
category_pattern_journal = re.compile(r"中国计算机学会推荐国际学术期刊\s*[（(](.+?)[）)]", re.DOTALL)
category_pattern_conf = re.compile(r"中国计算机学会推荐国际学术会议\s*[（(](.+?)[）)]", re.DOTALL)
level_pattern = re.compile(r"[一二三]、([ABC])\s*类")

def clean_text(text):
    if not text:
        return ""
    return re.sub(r'\s+', ' ', text.replace('\n', ' ')).strip()

current_category = ""
current_type = ""
current_level = ""
pdf_entries = []

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        
        m_journal = category_pattern_journal.search(text)
        m_conf = category_pattern_conf.search(text)
        
        if m_journal:
            current_category = clean_text(m_journal.group(1))
            current_type = "journal"
        elif m_conf:
            current_category = clean_text(m_conf.group(1))
            current_type = "conference"
        
        m_level = level_pattern.search(text)
        if m_level:
            current_level = m_level.group(1)
        
        tables = page.extract_tables()
        for table in tables:
            if not table:
                continue
            for row in table:
                if not row or row[0] == '序号' or row[0] is None:
                    continue
                try:
                    int(row[0])
                except (ValueError, TypeError):
                    continue
                
                if len(row) >= 5:
                    abbr = clean_text(row[1]) if row[1] else ""
                    full_name = clean_text(row[2]) if row[2] else ""
                    publisher = clean_text(row[3]) if row[3] else ""
                    
                    pdf_entries.append({
                        "seq": int(row[0]),
                        "abbreviation": abbr,
                        "full_name": full_name,
                        "publisher": publisher,
                        "category": current_category,
                        "type": current_type,
                        "level": current_level,
                        "page": page_num + 1,
                    })

# ===== Load JSON =====
with open(json_path, 'r', encoding='utf-8') as f:
    json_entries = json.load(f)

print(f"PDF entries: {len(pdf_entries)}")
print(f"JSON entries: {len(json_entries)}")

# ===== Build lookup keys =====
# Use (abbreviation_normalized, category, type) as primary key
# For entries without abbreviation, use (full_name_normalized, category, type)

def norm_abbr(abbr):
    """Normalize abbreviation for comparison."""
    return re.sub(r'[\s\-/]+', '', abbr).upper().strip()

def norm_name(name):
    """Normalize full name for comparison."""
    return re.sub(r'[\s\-,:/()\'&.;]+', '', name).lower().strip()

def make_key(entry):
    abbr = norm_abbr(entry.get('abbreviation', ''))
    if abbr:
        return (abbr, entry['category'], entry['type'])
    else:
        return ('NAME:' + norm_name(entry['full_name']), entry['category'], entry['type'])

# Build lookup dicts
pdf_by_key = {}
pdf_by_abbr = {}  # secondary index by just abbreviation
for e in pdf_entries:
    key = make_key(e)
    pdf_by_key[key] = e
    abbr = norm_abbr(e.get('abbreviation', ''))
    if abbr:
        if abbr not in pdf_by_abbr:
            pdf_by_abbr[abbr] = []
        pdf_by_abbr[abbr].append(e)

json_by_key = {}
json_by_abbr = {}
for e in json_entries:
    key = make_key(e)
    json_by_key[key] = e
    abbr = norm_abbr(e.get('abbreviation', ''))
    if abbr:
        if abbr not in json_by_abbr:
            json_by_abbr[abbr] = []
        json_by_abbr[abbr].append(e)

# ===== Compare =====
# 1. Count per category/type/level
print("\n" + "="*80)
print("DISTRIBUTION COMPARISON")
print("="*80)

pdf_dist = defaultdict(int)
json_dist = defaultdict(int)
for e in pdf_entries:
    pdf_dist[(e['type'], e['category'], e['level'])] += 1
for e in json_entries:
    json_dist[(e['type'], e['category'], e['level'])] += 1

all_keys = sorted(set(pdf_dist.keys()) | set(json_dist.keys()))
has_diff = False
for k in all_keys:
    p = pdf_dist.get(k, 0)
    j = json_dist.get(k, 0)
    marker = " ⚠️ MISMATCH" if p != j else ""
    if p != j:
        has_diff = True
    print(f"  {k[0]:12s} | {k[1]:30s} | {k[2]} | PDF:{p:3d}  JSON:{j:3d}{marker}")

if not has_diff:
    print("\n  ✅ All category/type/level counts match!")

# 2. Find entries in PDF but not in JSON
print("\n" + "="*80)
print("IN PDF BUT NOT IN JSON (missing from JSON)")
print("="*80)
missing_from_json = []
for key, pe in pdf_by_key.items():
    if key not in json_by_key:
        missing_from_json.append(pe)
        print(f"  [{pe['level']}] {pe['abbreviation']:15s} | {pe['full_name'][:60]:60s} | {pe['type']:10s} | {pe['category']} (page {pe['page']})")

if not missing_from_json:
    print("  ✅ No entries missing from JSON!")
else:
    print(f"\n  Total missing: {len(missing_from_json)}")

# 3. Find entries in JSON but not in PDF
print("\n" + "="*80)
print("IN JSON BUT NOT IN PDF (extra in JSON)")
print("="*80)
extra_in_json = []
for key, je in json_by_key.items():
    if key not in pdf_by_key:
        extra_in_json.append(je)
        print(f"  [{je['level']}] {je.get('abbreviation',''):15s} | {je['full_name'][:60]:60s} | {je['type']:10s} | {je['category']}")

if not extra_in_json:
    print("  ✅ No extra entries in JSON!")
else:
    print(f"\n  Total extra: {len(extra_in_json)}")

# 4. Level mismatches (same abbr+category+type but different level)
print("\n" + "="*80)
print("LEVEL MISMATCHES (same entry, different level)")
print("="*80)
level_mismatches = []
for key, pe in pdf_by_key.items():
    if key in json_by_key:
        je = json_by_key[key]
        if pe['level'] != je['level']:
            level_mismatches.append((pe, je))
            print(f"  {pe['abbreviation']:15s} | PDF:{pe['level']} → JSON:{je['level']} | {pe['category']}")

if not level_mismatches:
    print("  ✅ No level mismatches!")

# 5. Detailed comparison - list all entries side by side for each category
print("\n" + "="*80)
print("DETAILED CATEGORY-BY-CATEGORY ENTRY COUNT")
print("="*80)

categories = sorted(set(e['category'] for e in pdf_entries))
types = ['journal', 'conference']
levels = ['A', 'B', 'C']

for cat in categories:
    print(f"\n--- {cat} ---")
    for typ in types:
        for lvl in levels:
            pdf_count = sum(1 for e in pdf_entries if e['category']==cat and e['type']==typ and e['level']==lvl)
            json_count = sum(1 for e in json_entries if e['category']==cat and e['type']==typ and e['level']==lvl)
            marker = " ⚠️" if pdf_count != json_count else " ✅"
            print(f"  {typ:12s} {lvl}: PDF={pdf_count:3d}  JSON={json_count:3d}{marker}")

# 6. Full entry-by-entry comparison for each section
print("\n" + "="*80)
print("ENTRY-BY-ENTRY COMPARISON (by category/type/level)")
print("="*80)

for cat in categories:
    for typ in types:
        for lvl in levels:
            pdf_subset = [e for e in pdf_entries if e['category']==cat and e['type']==typ and e['level']==lvl]
            json_subset = [e for e in json_entries if e['category']==cat and e['type']==typ and e['level']==lvl]
            
            if not pdf_subset and not json_subset:
                continue
            
            # Sort by sequence number (PDF) or abbreviation
            pdf_subset.sort(key=lambda x: x.get('seq', 0))
            json_subset.sort(key=lambda x: x.get('abbreviation', ''))
            
            pdf_abbrs = set(norm_abbr(e['abbreviation']) for e in pdf_subset if e['abbreviation'])
            json_abbrs = set(norm_abbr(e['abbreviation']) for e in json_subset if e['abbreviation'])
            
            pdf_names = set(norm_name(e['full_name']) for e in pdf_subset if not e['abbreviation'])
            json_names = set(norm_name(e['full_name']) for e in json_subset if not e['abbreviation'])
            
            only_pdf_abbrs = pdf_abbrs - json_abbrs
            only_json_abbrs = json_abbrs - pdf_abbrs
            only_pdf_names = pdf_names - json_names
            only_json_names = json_names - json_abbrs
            
            if only_pdf_abbrs or only_json_abbrs or len(pdf_subset) != len(json_subset):
                print(f"\n  [{lvl}] {typ} - {cat}: PDF={len(pdf_subset)} JSON={len(json_subset)}")
                if only_pdf_abbrs:
                    for a in only_pdf_abbrs:
                        pe = next(e for e in pdf_subset if norm_abbr(e['abbreviation']) == a)
                        print(f"    + IN PDF ONLY: {pe['abbreviation']:15s} {pe['full_name'][:60]}")
                if only_json_abbrs:
                    for a in only_json_abbrs:
                        je = next(e for e in json_subset if norm_abbr(e['abbreviation']) == a)
                        print(f"    - IN JSON ONLY: {je['abbreviation']:15s} {je['full_name'][:60]}")

print("\n\nDone!")
