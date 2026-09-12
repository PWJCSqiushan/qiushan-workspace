# 个人工作台

九条工作流的紧凑卡片看板，基于 React、vinext 和 Cloudflare Workers，使用 D1 保存数据、KV 保存备份。

## 界面与同步

- 统一的 250 × 86 px 卡片，桌面工作流行高 102 px，支持逐行横向滚动。
- 本流和协调优先级等大对齐，A+ 黄色、S 红色；旗标高亮浅紫卡片，左下角可标记完成。
- 草稿本机保存、待同步队列、幂等提交、版本冲突提示、个人与演示空间隔离。
- 支持口令认证及 Cloudflare Access；默认不开放正式环境迁移入口。

此仓库是 compact-3 版本的脱敏源码。显示名称和演示文案已通用化，不含真实卡片、云端数据库快照、登录凭据、部署日志或私人交接记录。兼容性字段和内部存储键保持原协议。

## 本地运行

需要 Node.js 24.16 或以上版本，以及 npm。

```sh
npm ci
npm run setup
npm run db:local
npm run dev -- --host 127.0.0.1
```

setup 只在本地配置不存在时复制示例。示例资源 ID 为占位值；本地 D1/KV 模拟器不连接他人的资源。开发模式仅在 loopback 主机名上允许本地身份。正式空间初始为空，演示内容由应用生成。

## 检查与构建

```sh
npm test
npm run typecheck
npm run build
```

测试使用内存 SQLite、fake-indexeddb 和合成数据。构建还会生成不包含用户数据的 HTML shell。Windows 构建清理会将旧输出送入回收站；其他系统将旧输出保留在被忽略的 work/recycled 目录中。

## 部署到自己的 Cloudflare 账户

1. 执行 npm run setup，在被 Git 忽略的 wrangler.jsonc 中设置自己的 Worker 名、D1 数据库 ID、KV 命名空间 ID。按自己的套餐额度配置资源。
2. 保持 AUTH_MODE 为 passcode、MIGRATION_ENABLED 为 false，且 assets.run_worker_first 为 true、html_handling 为 none。不要把 local 认证模式用于线上。
3. 在自己的数据库上执行 npx wrangler d1 migrations apply DB --remote。数据库升级前应另存备份。
4. 使用密码管理器生成并保存至少 256 位随机口令，计算其 SHA-256 十六进制摘要，通过 npx wrangler secret put LOGIN_SECRET_SHA256 安全输入摘要。不要使用低强度自选密码，也不要把口令或摘要写进仓库。
5. 执行 npm run build，再执行 npx wrangler deploy --config dist/server/wrangler.json。保持原数据库绑定即可保留已有卡片；部署代码本身不会导入或替换卡片。

定时备份默认每天 UTC 18:00 执行。应用支持 Cloudflare Access 模式，但需另行配置自己的团队域名、Audience 与允许邮箱。

## 文件说明

app 和 components 包含界面与 API；lib 包含业务规则、认证和同步；drizzle 包含数据库结构迁移；tests 包含合成测试；scripts 包含可移植的初始化和构建工具。

不要提交本地配置、.dev.vars、数据库、导出卡片、会话 Cookie、私人截图或生产日志。此仓库没有连接生产账户的自动部署工作流。


## 协调队列与统计总览

卡片在紧急、本次先做、普通三个层级内，依次按协调数字、协调字母、本流优先级排序。每个用户的每个工作台独立维护跨流连续的正整数队列；0允许重复。完成、删除和清空编号释放位置，撤销与恢复会插回原位置；每日打卡释放正整数且次日不自动编号。

升级前备份数据库与未同步草稿，应用 `0004_coordination_analytics.sql` 后，在工作台预览并启用编号规则。编号调整和完成事件使用同一事务，过期队列版本会保留为待确认冲突；旧客户端需要更新后重新确认操作。编号预览不会给未编号卡片自动分配数字。

顶部“统计总览”提供今天、近7/30/90天、自定义日期与日/周/月汇总，统一北京时间、周一为周起点。四项指标与各流柱状图、趋势折线图、完成占比环形图、明细表采用同一事件口径。撤销扣回原日期；删除不抹去历史；工作流移动不改写事件归属。

新备份包含事件与编号恢复位置。缺失的历史日期或流归属会明确提示，不通过最后修改时间推测完成日期。只读 `/api/analytics` 与 `/api/export` 均要求登录；真实配置、卡片和账户信息不属于源码发布内容。
