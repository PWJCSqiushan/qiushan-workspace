"""Pin Noto SC variable source to an OFL static TTF, retaining its full cmap."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
source = root / 'work/font-source/NotoSansSC-VF.ttf'
font = instantiateVariableFont(TTFont(source), {'wght': 400}, inplace=False)
# A distinct family name for this redistributed static derivative.
for key, value in [(1, 'Qiushan Report Sans'), (2, 'Regular'), (4, 'Qiushan Report Sans Regular'), (6, 'QiushanReportSans-Regular')]:
    font['name'].setName(value, key, 3, 1, 0x409)
font.save(root / 'public/fonts/QiushanReportSans-Regular.ttf')
print('Static font:', len(font.getBestCmap()), 'glyph mappings; variable:', 'fvar' in font)
