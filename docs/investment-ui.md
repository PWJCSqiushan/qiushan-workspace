# 理财投资 UI 交接

`/investment` 复用了用户自有 `R_投资/frontend/src` 的 React 页面结构、中文文案和图表交互，并按个人工作台的 React 19 / Next client 组件、私人/演示空间和云端快照接口适配。源项目保持只读；本目录没有复制源 runtime、数据库或私人账户资料。

接口契约以源项目 `docs/CONTRACT.md` 为准。所有请求通过 `/api/investment/`，附带 `space=personal|demo`；写请求同时附带 `base_version` 和 `operation_id`，冲突时停止并提示核对。私人空间默认空账本，演示空间只显示服务端提供的合成数据。

本 UI 保留源前端依赖中的 MIT 许可说明和第三方来源边界：没有复制 GPL 或未确认许可代码，也没有把源项目声明为整个 MIT 项目。行情、基金净值和报告原始来源仍以服务端返回的证据链接为准。
