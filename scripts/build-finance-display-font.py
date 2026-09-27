"""Subset official Smiley Sans for finance UI; preserve existing brand font.

Usage: python scripts/build-finance-display-font.py path/to/SmileySans.ttf
Requires fonttools[woff] and brotli. Outputs public, non-personal glyph shards.
"""
import hashlib
import io
import json
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
data = Path(sys.argv[1]).read_bytes()
cmap = set(TTFont(io.BytesIO(data)).getBestCmap())
source = ''.join(p.read_text(encoding='utf-8-sig') for folder in ['app', 'components', 'lib']
                 for p in (root / folder).rglob('*') if p.suffix in ['.ts', '.tsx'])
common = {ord(c) for c in source if ord(c) > 255} & cmap
remaining = sorted(cmap - common - set(range(256)))
groups = [sorted(common)] + [remaining[i:i+256] for i in range(0, len(remaining), 256)]
css, manifest = [], []
for i, chars in enumerate(groups):
    font = TTFont(io.BytesIO(data))
    options = subset.Options()
    options.recalc_timestamp = False
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=chars)
    sub.subset(font)
    for record in font['name'].names:
        if record.nameID in (1, 3, 4, 6, 16, 17):
            value = 'Regular' if record.nameID == 17 else 'QiushanFinanceDisplay'
            record.string = value.encode(record.getEncoding(), errors='replace')
    font.flavor = 'woff2'
    name = f'finance-display-{i:02d}.woff2'
    target = root / 'public/fonts' / name
    font.save(target)
    ranges = ','.join(f'U+{x:X}' for x in chars)
    css.append(f"@font-face{{font-family:'Qiushan Finance Display';src:url('/fonts/{name}') format('woff2');font-weight:400;font-style:normal;font-display:swap;unicode-range:{ranges}}}")
    manifest.append({'file': name, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(root / 'public/fonts/finance-display.css').write_text('\n'.join(css), encoding='utf-8')
(root / 'public/fonts/finance-display-manifest.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(data).hexdigest(), 'files': manifest}, indent=2), encoding='utf-8')
print(json.dumps({'shards': len(groups), 'bytes': sum(x['bytes'] for x in manifest)}))
