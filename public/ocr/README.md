# 本地收据 OCR 资源

这些静态资源用于生活账本的浏览器本地收据识别。图片由浏览器直接交给 Web Worker，服务器不会接收用户选择的图片；识别出的候选金额在界面确认前也不会进入账本。

资源来源与版本：

- `worker.min.js`: `tesseract.js@7.0.0`，Apache-2.0。
- `tesseract-core-*-lstm.*`: `tesseract.js-core@7.0.0`，仅保留 LSTM 核心及 SIMD/Relaxed SIMD 变体，Apache-2.0。
- `eng.traineddata`、`chi_sim.traineddata`: `tesseract-ocr/tessdata_fast` 的 `main` 分支模型，Apache-2.0。模型仅按需由 Tesseract Worker 从当前站点读取。

对应许可证保存在本目录的 `LICENSE.tesseract-js.txt`、`LICENSE.tesseract-core.txt` 和 `LICENSE.tessdata-fast.txt`。

官方来源：

- https://github.com/naptha/tesseract.js
- https://github.com/naptha/tesseract.js-core
- https://github.com/tesseract-ocr/tessdata_fast
