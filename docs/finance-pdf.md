# 生活账本 PDF 报告

在生活账本消费概览中打开“导出 → PDF报告”，选择月度、年度或自定义日期范围，生成预览后下载。报告为两页 A4 横向 PDF，包含消费总览、用途分布与重点用途展开。

报告使用账本当前快照。存在待同步编辑时，可以等待同步，或明确选择带草稿标记的报告；冲突和失败队列需要先处理。退款归入原消费日期，AA 使用个人承担额，拆分用途按分配金额计算。

生成和预览在浏览器中完成。字体随应用提供，PDF 包含可复制的中文文本与矢量图表。首次打开 PDF 配置才加载相关组件，生成时才加载字体；预览与下载使用同一文件。

验证命令：

```sh
npm test
npm run typecheck
npm run build
node --experimental-transform-types scripts/finance-pdf-sample.mjs
```

样稿和测试使用合成账本，不包含真实财务数据。`scripts/verify-finance-pdf.py` 可检查样稿的页数、尺寸、中文字体嵌入与文字边界，需要 pypdf、pypdfium2 和 pdfplumber。
