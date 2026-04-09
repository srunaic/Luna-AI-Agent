import urllib.request, urllib.parse, re
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

data = urllib.parse.urlencode({'q': 'DariaContainer'}).encode('utf-8')
req = urllib.request.Request(
    'https://html.duckduckgo.com/html/', 
    data=data, 
    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8'}
)
try:
    html = urllib.request.urlopen(req, context=ctx).read().decode('utf-8')
    snippets = re.findall(r'<a class="result__snippet[^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
    print("SNIPPETS:", len(snippets))
    if len(snippets) == 0:
        print("HTML DUMP START")
        print(html[:1000])
except Exception as e:
    print("ERROR:", e)
