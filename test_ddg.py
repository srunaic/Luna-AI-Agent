import urllib.request, urllib.parse, re
import ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

data = urllib.parse.urlencode({'q': 'ai agent'}).encode('utf-8')
req = urllib.request.Request(
    'https://html.duckduckgo.com/html/', 
    data=data, 
    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
)
html = urllib.request.urlopen(req, context=ctx).read().decode('utf-8')

snippets = re.findall(r'<a class="result__snippet[^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
titles = re.findall(r'<h2 class="result__title">.*?<a[^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)

print(f"Snippets: {len(snippets)}")
print(f"Titles: {len(titles)}")
for i in range(min(3, len(snippets))):
    print(f"{i+1}. {titles[i].strip()} - {snippets[i].strip()[:50]}")
