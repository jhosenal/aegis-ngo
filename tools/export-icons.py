"""Export existing AEGIS UI symbols without changing application source."""
from pathlib import Path
import hashlib
import html
import json
import re
import shutil
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'export' / 'iconsvg'
OUT.mkdir(parents=True, exist_ok=True)
catalogue = []

def emit(name, body, source, viewbox='0 0 24 24', width=24, stroke='1.7', color='#0A1F50'):
    title = html.escape(name.replace('-', ' '))
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{width}" viewBox="{viewbox}" fill="none" stroke="{color}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" role="img"><title>{title}</title>{body}</svg>\n'
    path = OUT / (name + '.svg')
    path.write_text(svg, encoding='utf-8')
    catalogue.append({'file': path.name, 'source': source})

def read(path):
    return (ROOT / path).read_text(encoding='utf-8-sig')

source = 'ui/src/dashboard/Icon.tsx'
text = read(source)
air = re.search(r"AIR_WEATHER_ICON_PATH = '([^']+)'", text).group(1)
for name, path in re.findall(r"^  (\w+): '([^']+)'", text, re.M):
    emit('ui-' + name, f'<path d="{path}"/>', source)
emit('ui-weather', f'<path d="{air}"/>', source)

source = 'ui/src/components/HazardIcon.tsx'
colors = dict(re.findall(r'\.hazard-theme-(\w+) \{ --hazard-accent: (#[0-9a-f]+)', read('ui/src/design/hazard-cards.css')))
for name, path in re.findall(r"^  (\w+): '([^']+)'", read(source), re.M):
    for suffix, color in [('', colors[name]), ('-mono', '#0A1F50')]:
        emit('hazard-' + name + suffix, f'<path d="{path}"/>', source, '-1 -1 26 26', stroke='1.5', color=color)

source = 'ui/src/components/CardActionIcon.tsx'
paths = re.search(r"kind === 'pin' \? '([^']+)' : '([^']+)'", read(source)).groups()
for name, path in zip(['card-pin', 'card-attach'], paths):
    emit(name, f'<path d="{path}"/>', source)

source = 'ui/src/components/PanelPuller.tsx'
paths = re.search(r"pointsLeft \? '([^']+)' : '([^']+)'", read(source)).groups()
for name, path in zip(['chevron-left', 'chevron-right'], paths):
    emit(name, f'<path d="{path}"/>', source, stroke='2')

# Static standalone SVGs embedded in JSX, excluding data maps and raster artwork.
for source, name in [('ui/src/components/SignInScreen.tsx', 'google-sign-in'),
                     ('ui/src/components/PlaceCards.tsx', 'place-accessibility'),
                     ('ui/src/dashboard/MapLayerToolbar.tsx', 'map-disclosure'),
                     ('ui/src/dashboard/NewsMenu.tsx', 'news-disclosure')]:
    svg = re.search(r'<svg\b.*?</svg>', read(source), re.S).group(0)
    svg = re.sub(r'\s(?:className|aria-hidden)="[^"]*"', '', svg)
    for jsx, xml in [('strokeWidth','stroke-width'),('strokeLinecap','stroke-linecap'),('strokeLinejoin','stroke-linejoin')]:
        svg = svg.replace(jsx, xml)
    svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" color="#0A1F50" role="img" ', 1)
    svg = svg.replace('><', '><title>' + name + '</title><', 1)
    if 'width=' not in svg.split('>')[0]:
        svg = svg.replace('<svg ', '<svg width="24" height="24" ', 1)
    path = OUT / (name + '.svg')
    path.write_text(svg + '\n', encoding='utf-8')
    catalogue.append({'file':path.name, 'source':source})

for path in sorted((ROOT / 'ui/public').rglob('*.svg')):
    name = 'asset-' + '-'.join(path.relative_to(ROOT / 'ui/public').parts)
    shutil.copyfile(path, OUT / name)
    catalogue.append({'file':name, 'source':path.relative_to(ROOT).as_posix()})

for entry in catalogue:
    data = (OUT / entry['file']).read_bytes()
    ET.fromstring(data)
    entry['sha256'] = hashlib.sha256(data).hexdigest()
catalogue.sort(key=lambda item:item['file'])
(OUT / 'index.json').write_text(json.dumps(catalogue,indent=2)+'\n',encoding='utf-8')
(OUT / 'README.md').write_text('''# AEGIS SVG icons

Standalone exports of the current UI icons. Hazard icons include their existing colour and a `-mono` navy version. All files have transparent backgrounds. Source paths and SHA-256 checksums are in `index.json`.

`ui-*` are interface controls; `hazard-*` are disaster/air symbols; `card-*` are card actions. Chevron, accessibility, Google sign-in and existing public icon assets are included. Google artwork retains its original colours and remains Google's mark; its inclusion does not grant new trademark rights.

These are vector symbols, not location photos, raster hazard illustrations, data charts or map imagery. Those assets are not converted into fake vector artwork.

Regenerate from the project root: `python tools/export-icons.py`.
''',encoding='utf-8')
tiles = ''.join(f'<figure><img src="{e["file"]}" alt="{e["file"]}"><figcaption>{e["file"]}</figcaption></figure>' for e in catalogue)
(OUT / 'preview.html').write_text('<!doctype html><meta charset="utf-8"><title>AEGIS SVG icons</title><style>body{font:13px system-ui;background:#f6fbff;color:#0a1f50}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}figure{margin:0;padding:20px;background:white;border:1px solid #b8e5f9;border-radius:10px;text-align:center}img{width:48px;height:48px}figcaption{margin-top:12px;overflow-wrap:anywhere}</style><h1>AEGIS SVG icons</h1><main>'+tiles+'</main>',encoding='utf-8')
print(f'Exported and XML-validated {len(catalogue)} SVG files to {OUT.relative_to(ROOT)}')
