import json
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import pdfplumber

root = Path(__file__).resolve().parents[1] / 'output/pdf'
results = []
for path in root.glob('*.pdf'):
    reader = PdfReader(path)
    assert len(reader.pages) == 2, path
    text = '\n'.join(p.extract_text() for p in reader.pages)
    assert '消费总览' in text and '重点用途展开' in text and '2026-09-30' in text, path
    assert '\ufffd' not in text, path
    fonts = []
    for page in reader.pages:
        assert abs(float(page.mediabox.width) - 841.89) < 1 and abs(float(page.mediabox.height) - 595.28) < 1
        for ref in page['/Resources']['/Font'].values():
            font = ref.get_object()
            if '/DescendantFonts' in font:
                descriptor = font['/DescendantFonts'][0].get_object()['/FontDescriptor'].get_object()
                assert '/FontFile2' in descriptor or '/FontFile3' in descriptor
                assert '/ToUnicode' in font
                fonts.append(str(font['/BaseFont']))
    assert fonts, path
    # Detect printable characters outside the page (visual review is also required).
    with pdfplumber.open(path) as doc:
        for page in doc.pages:
            assert all(c['x0'] >= 0 and c['x1'] <= page.width+1 and c['top'] >= 0 and c['bottom'] <= page.height+1 for c in page.chars), path
    pdf = pdfium.PdfDocument(path)
    for i in range(len(pdf)):
        pdf[i].render(scale=1.6).to_pil().save(root / (path.stem + f'-page-{i+1}.png'))
    results.append({'file': path.name, 'pages': 2, 'embedded_fonts': sorted(set(fonts)), 'text_characters': len(text), 'text_bounds': 'pass'})
(root / 'pdf-verification.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print('Verified', len(results), 'two-page PDFs; font embedding and selectable Chinese pass')
