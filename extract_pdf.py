"""
Extract CCF 2026 ranking data from PDF into structured JSON/CSV.
Handles both journals (期刊) and conferences (会议) across all categories and levels.
"""
import pdfplumber
import json
import csv
import re

pdf_path = "ccf-2026会议期刊列表.pdf"

# State tracking
current_category = ""
current_type = ""  # "journal" or "conference"
current_level = ""

all_entries = []

# Patterns for section detection
category_pattern_journal = re.compile(r"中国计算机学会推荐国际学术期刊\s*[（(](.+?)[）)]", re.DOTALL)
category_pattern_conf = re.compile(r"中国计算机学会推荐国际学术会议\s*[（(](.+?)[）)]", re.DOTALL)
level_pattern = re.compile(r"[一二三]、([ABC])\s*类")

def clean_text(text):
    """Clean extracted text by removing extra whitespace and newlines."""
    if not text:
        return ""
    return re.sub(r'\s+', ' ', text.replace('\n', ' ')).strip()

def fix_full_name(name):
    """Add spaces back to camelCase-joined words in full names."""
    if not name:
        return ""
    # Add space before uppercase letters that follow lowercase letters (camelCase splitting)
    name = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)
    # Add space before uppercase letters that follow closing parenthesis
    name = re.sub(r'(\))([A-Z])', r'\1 \2', name)
    # Add space before uppercase after digits
    name = re.sub(r'(\d)([A-Z])', r'\1 \2', name)
    # Fix "ACM/IEEE" org names that got joined to next word
    name = re.sub(r'\b(ACM|IEEE|USENIX|SIAM|AAAI|IJCAI)([A-Z][a-z])', lambda m: m.group(1) + ' ' + m.group(2), name)
    # Fix comma without space
    name = re.sub(r',([A-Za-z])', r', \1', name)
    # Fix colon without space  
    name = re.sub(r':([A-Za-z])', r': \1', name)
    # Fix ampersand without space
    name = re.sub(r'([A-Za-z])&([A-Za-z])', r'\1 & \2', name)
    # Clean up multiple spaces
    name = re.sub(r'\s+', ' ', name).strip()
    return name

with pdfplumber.open(pdf_path) as pdf:
    for page_num, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        
        # Detect category and type from page text
        m_journal = category_pattern_journal.search(text)
        m_conf = category_pattern_conf.search(text)
        
        if m_journal:
            current_category = clean_text(m_journal.group(1))
            current_type = "journal"
        elif m_conf:
            current_category = clean_text(m_conf.group(1))
            current_type = "conference"
        
        # Detect level
        m_level = level_pattern.search(text)
        if m_level:
            current_level = m_level.group(1)
        
        # Extract table data
        tables = page.extract_tables()
        for table in tables:
            if not table:
                continue
            
            for row in table:
                # Skip header rows
                if not row or row[0] == '序号' or row[0] is None:
                    continue
                
                # Skip rows that don't start with a number
                try:
                    int(row[0])
                except (ValueError, TypeError):
                    continue
                
                # Parse row: [序号, 简称, 全称, 出版社, 网址]
                if len(row) >= 5:
                    abbr = clean_text(row[1]) if row[1] else ""
                    full_name = clean_text(row[2]) if row[2] else ""
                    publisher = clean_text(row[3]) if row[3] else ""
                    url = clean_text(row[4]) if row[4] else ""
                    
                    entry = {
                        "abbreviation": abbr,
                        "full_name": fix_full_name(full_name),
                        "publisher": publisher,
                        "url": url,
                        "category": current_category,
                        "type": current_type,
                        "level": current_level,
                    }
                    all_entries.append(entry)

print(f"Total entries extracted: {len(all_entries)}")

# Print category/type/level distribution
from collections import Counter
dist = Counter((e['category'], e['type'], e['level']) for e in all_entries)
print("\nDistribution:")
for key, count in sorted(dist.items()):
    print(f"  {key}: {count}")

# Save as JSON
with open("ccf_rankings.json", "w", encoding="utf-8") as f:
    json.dump(all_entries, f, ensure_ascii=False, indent=2)
print(f"\nSaved to ccf_rankings.json")

# Save as JSONL (one entry per line, good for streaming)
with open("ccf_rankings.jsonl", "w", encoding="utf-8") as f:
    for entry in all_entries:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print(f"Saved to ccf_rankings.jsonl")

# Save as CSV
with open("ccf_rankings.csv", "w", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["abbreviation", "full_name", "publisher", "url", "category", "type", "level"])
    writer.writeheader()
    writer.writerows(all_entries)
print(f"Saved to ccf_rankings.csv")

# Print a few sample entries
print("\nSample entries:")
for e in all_entries[:5]:
    print(f"  [{e['level']}] {e['abbreviation']:10s} | {e['full_name'][:60]:60s} | {e['type']:10s} | {e['category']}")
print("  ...")
for e in all_entries[-3:]:
    print(f"  [{e['level']}] {e['abbreviation']:10s} | {e['full_name'][:60]:60s} | {e['type']:10s} | {e['category']}")
