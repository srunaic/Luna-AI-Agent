from pathlib import Path
p = Path('src/App.tsx')
text = p.read_text(encoding='utf-8', errors='replace')
# Replace literal backslash-n sequences that were accidentally inserted into code
# This is safe in this file because those sequences are not intended string escapes.
text2 = text.replace('\\n', '\n')
if text2 != text:
    p.write_text(text2, encoding='utf-8')
print('done')
