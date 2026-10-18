import json, re
import os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ui', 'src', 'design') + os.sep
tokens = json.load(open(root + 'tokens.json', encoding='utf-8'))
kebab = lambda s: re.sub(r'([A-Z])', lambda m: '-' + m.group(1).lower(), s)
lines = [
    '/* GENERATED from tokens.json by tools/gen-design-tokens.py; edit tokens.json, then regenerate. tests/unit/design-tokens.test.ts checks that this file and tokens.json agree',
    '   and that every text pair reaches its contrast ratio. Colours of the owner\'s design D0001 to D0004 (see the origin of each in tokens.json). */',
    ':root {',
]
for name, t in tokens['colors'].items():
    lines.append(f"  --aeg-{kebab(name)}: {t['hex']};")
lines += [
    '',
    '  /* shape, space and type (chosen from the mockups: rounded cards, soft shadow, system type) */',
    '  --aeg-radius-card: 14px;',
    '  --aeg-radius-chip: 999px;',
    '  --aeg-radius-control: 10px;',
    '  --aeg-shadow-card: 0 1px 2px rgba(9, 53, 110, 0.06), 0 4px 14px rgba(9, 53, 110, 0.06);',
    '  --aeg-gap: 16px;',
    '  --aeg-target: 48px;',
    "  --aeg-font: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;",
    '  --aeg-focus: 3px solid #0E65D3;',
    '}',
    '',
]
open(root + 'tokens.css', 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('written', len(tokens['colors']), 'colours')
