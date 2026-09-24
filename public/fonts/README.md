# Self-hosted typography

- Qiushan Display: four-character subset of **得意黑 / Smiley Sans**, https://github.com/atelier-anchor/smiley-sans . Only the brand heading uses it.
- Qiushan Han: Unicode shards of **思源黑体 / Source Han Sans CN Regular**, https://github.com/adobe-fonts/source-han-sans . Common UI characters load together; remaining characters are disjoint 256-codepoint shards.
- Geist: Latin-1 variable subset of **Geist**, https://github.com/vercel/geist-font . Source downloaded from the official repository through jsDelivr (2026-09-24); original source retained in source/.

The Han and display sources were reused from existing local licensed copies. The hashes of those exact inputs are recorded in manifest.json. Subsets carry distinct internal names because the original licenses reserve Source, Smiley and 得意黑. All three upstream license texts remain alongside the files. CSS aliases identify the renamed subsets; they do not change the original typeface designs.

Run scripts/build-qiushan-fonts.py --help for reproducible subset construction with fonttools and brotli. Supply the original font binaries and licenses. The build never deletes source or output files. fonts.css is self-hosted and uses font-display:swap and unicode-range, so the browser loads only needed shards. Do not preload all shards. Han is static regular; browser synthesis supplies stronger UI emphasis. Geist retains the variable weight axis.
