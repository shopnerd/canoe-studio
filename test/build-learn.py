# Builds learn/*.html from learn/src/*.html — wraps each page body in the shared head + top bar.
# Usage: python test/build-learn.py
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'learn'
NAV = [
    ('start.html', 'Using the app'),
    ('rules-2027.html', '2027 rules'),
    ('finals-2025.html', '2025 Finals'),
    ('mix.html', 'Mix notes'),
    ('strength-test.html', 'Strength test'),
    ('tow-test.html', 'Tow test'),
    ('post-tensioning.html', 'Post-tensioning'),
    ('season-report.html', 'Season report'),
]
FAVICON = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22%3E%3Cpath d=%22M2 16 C 12 30, 28 30, 38 16 L 38 14 C 26 19, 14 19, 2 14 Z%22 fill=%22%231f2328%22/%3E%3C/svg%3E"

def page(name, src):
    m = re.match(r'<!--\s*title:\s*(.+?)\s*\|\s*description:\s*(.+?)\s*-->\s*', src, re.S)
    title, desc = m.group(1), m.group(2)
    body = src[m.end():]
    nav = ''.join(f'<a href="{href}"{" aria-current=\"page\"" if href == name else ""}>{label}</a>' for href, label in NAV)
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="icon" href="{FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="learn.css">
</head>
<body>
<header class="bar">
  <a class="brand" href="./"><svg viewBox="0 0 40 16" aria-hidden="true"><path d="M1 4 C 10 15, 30 15, 39 4 L 39 3 C 28 7, 12 7, 1 3 Z"/></svg>Canoe Studio <small>Learn</small></a>
  <nav aria-label="Guides">{nav}</nav>
  <a class="app" href="../">Open the app →</a>
</header>
{body}
</body>
</html>
'''

def fix_img_sizes(html):
    from PIL import Image
    def sub(m):
        path = ROOT / m.group(1)
        w, h = Image.open(path).size
        return f'src="{m.group(1)}"' + m.group(2) + f'width="{w}" height="{h}"'
    return re.sub(r'src="(img/[^"]+)"(.*?)width="\d+" height="\d+"', sub, html)

for src in sorted((ROOT / 'src').glob('*.html')):
    out = ROOT / src.name
    out.write_text(fix_img_sizes(page(src.name, src.read_text(encoding='utf8'))), encoding='utf8')
    print('built', out.name)
