"""Build self-hosted WOFF2 unicode shards. Requires fonttools[woff] and brotli.
Usage: python scripts/build-qiushan-fonts.py --han /path/SourceHanSans.otf --smiley /path/SmileySans.woff2 --geist /path/Geist.woff2 --han-license /path/LICENSE --smiley-license /path/LICENSE --geist-license /path/OFL
Only emits assets; never deletes source files or existing output.
"""
import argparse,io,json,hashlib
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
parser=argparse.ArgumentParser()
for name in ['han','smiley','geist','han-license','smiley-license','geist-license']:parser.add_argument('--'+name,required=True,type=Path)
a=parser.parse_args();out=Path(__file__).resolve().parents[1]/'public/fonts';out.mkdir(parents=True,exist_ok=True)
css=[];manifest=[]
def emit(source,family,prefix,groups,weight):
 data=source.read_bytes()
 for i,chars in enumerate(groups):
  font=TTFont(io.BytesIO(data));options=subset.Options();options.flavor='woff2';options.recalc_timestamp=False
  sub=subset.Subsetter(options=options);sub.populate(unicodes=chars);sub.subset(font)
  # Avoid OFL Reserved Font Names for modified subsets.
  for record in font['name'].names:
   if record.nameID in (1,3,4,6,16,17):
    value=(family.replace(' ','')+'-Regular') if record.nameID==6 else ('Regular' if record.nameID==17 else family)
    record.string=value.encode(record.getEncoding(),errors='replace')
  font.flavor='woff2';name=f'{prefix}-{i:02d}.woff2';font.save(out/name)
  ranges=','.join(f'U+{x:X}' for x in sorted(chars));css.append(f"@font-face{{font-family:'{family}';src:url('/fonts/{name}') format('woff2');font-style:normal;font-weight:{weight};font-display:swap;unicode-range:{ranges}}}")
  manifest.append({'file':name,'bytes':(out/name).stat().st_size,'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest(),'glyphCodepoints':len(chars),'sourceSha256':hashlib.sha256(data).hexdigest()})
allhan=set(TTFont(a.han).getBestCmap());source=''.join(p.read_text(encoding='utf-8-sig') for folder in ['app','components','lib'] for p in (out.parents[1]/folder).rglob('*.tsx'))
common={ord(c) for c in source if ord(c)>255}&allhan
remaining=sorted(allhan-common-set(range(256)))
groups=[sorted(common)]+[remaining[i:i+256] for i in range(0,len(remaining),256)]
emit(a.han,'Qiushan Han','source-han',groups,'400')
emit(a.smiley,'Qiushan Display','smiley',[{ord(c) for c in '丘山流调'}],'400')
emit(a.geist,'Geist','geist',[{x for x in TTFont(a.geist).getBestCmap() if x<=255}],'100 900')
for key,label in [('han_license','SourceHanSans'),('smiley_license','SmileySans'),('geist_license','Geist')]: (out/f'{label}-LICENSE.txt').write_bytes(getattr(a,key).read_bytes())
(out/'fonts.css').write_text('\n'.join(css),encoding='utf8');(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'files':len(manifest),'bytes':sum(x['bytes'] for x in manifest),'commonCharacters':len(common)}))
