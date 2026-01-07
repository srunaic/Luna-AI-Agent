from pathlib import Path
import re

p = Path('src/App.tsx')
text = p.read_text(encoding='utf-8')
pattern = re.compile(r"(id: `stream_\$\{message\.data\.taskId\}`,[\s\S]*?ts: Date\.now\(\)),\s*\n\s*meta: \{[^\}]*\}\s*\n", re.M)
text2, n = pattern.subn(r"\1\n", text, count=1)
if n:
    p.write_text(text2, encoding='utf-8')
print(n)
