import sys, urllib.request, urllib.parse, json, re, ssl
sys.stdout.reconfigure(encoding='utf-8')

query = "DariaContainer 유튜브 채널"

# DuckDuckGo HTML with Korean-specific params
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# Force Korean locale with kl=kr-kr
data = urllib.parse.urlencode({'q': query, 'kl': 'kr-kr'}).encode('utf-8')
req = urllib.request.Request(
    'https://html.duckduckgo.com/html/', data=data,
    headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9'
    }
)

html = urllib.request.urlopen(req, timeout=10, context=ctx).read().decode('utf-8')
snippets = re.findall(r'<a class="result__snippet[^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
titles = re.findall(r'<h2 class="result__title">.*?<a[^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
urls = re.findall(r'<a class="result__url"[^>]*href="([^"]*)"', html, re.DOTALL | re.IGNORECASE)

clean = lambda t: re.sub(r'<[^>]+>', '', t).strip()

print(f"HTML DDG Results: {len(snippets)} snippets, {len(titles)} titles")
for i in range(min(5, len(titles))):
    print(f"  {i+1}. {clean(titles[i])}")
    if i < len(snippets):
        print(f"     {clean(snippets[i])[:150]}")
    if i < len(urls):
        print(f"     URL: {urls[i]}")
    print()
