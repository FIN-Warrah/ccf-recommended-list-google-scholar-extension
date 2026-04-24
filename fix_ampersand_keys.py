"""Add 'and'-normalized alias keys to CCF_NAME_LOOKUP for entries with '&' in full_name."""
import re

def new_norm(text):
    return re.sub(r'[^a-z0-9]', '', text.lower().replace('&', 'and'))

with open('ccf-recommended-list-google-scholar-extension/ccf_data.js', 'r') as f:
    content = f.read()

# Find CCF_NAME_LOOKUP section
nl_start = content.index('const CCF_NAME_LOOKUP = {')
nl_close = content.find('\n};', nl_start)
section = content[nl_start:nl_close]

# Parse entries using regex: "key": { ... },\n
# Each entry ends with "  }," on its own line
entry_re = re.compile(r'  "([^"]+)": \{(.*?)\n  \}', re.DOTALL)

aliases = []
for m in entry_re.finditer(section):
    key = m.group(1)
    body = m.group(2)
    fn_match = re.search(r'"full_name": "([^"]*&[^"]*)"', body)
    if fn_match:
        full_name = fn_match.group(1)
        new_key = new_norm(full_name)
        if new_key != key:
            alias_entry = f'  "{new_key}": {{{body}\n  }},'
            aliases.append(alias_entry)
            print(f'  + {key} -> {new_key} ({full_name})')

print(f'\nTotal aliases: {len(aliases)}')

if aliases:
    insert_text = '\n'.join(aliases) + '\n'
    new_content = content[:nl_close] + '\n' + insert_text + content[nl_close:]
    with open('ccf-recommended-list-google-scholar-extension/ccf_data.js', 'w') as f:
        f.write(new_content)
    print('✅ Done')
