# Garmin 本机同步器

Windows 本机只读睡眠同步器。网页和 iPad 发起请求，运行中的电脑读取 Garmin
中国区睡眠并提交到已配置的个人站点。电脑关闭时请求排队，不声称已完成。

需要 Python 3.12+（包含 Tk）。执行 `start-hidden.ps1 -Action Install` 会安装到固定
的 `%LOCALAPPDATA%\QiushanWorkspace\garmin-cn`，不依赖当前 Git 工作区；配置、
会话和待提交请求保留，更新脚本前备份旧脚本。只从 PyPI 安装 requirements.txt。

将 `config.example.json` 的内容填入本机运行目录的 `config.json`：目标站点、space、
connectionId、可撤销 websiteToken。网站目标必须是 HTTPS，只有 localhost 可用 HTTP；
拒绝凭据重定向。不要把该配置提交仓库。首次登录及会话失效后使用本机窗口：

```powershell
.\start-hidden.ps1 -Action Install
.\start-hidden.ps1 -Action Login
.\start-hidden.ps1 -Action Resume
```

也可双击运行目录的 `Garmin 登录.lnk`。密码和验证码只在窗口输入，不写入配置。
会话复用与 DI 续期由 python-garminconnect 0.3.16 提供，并将续期会话保存回本机。
验证码仍需人工输入。密码输错可直接重试，不把认证失效误报为网络故障。

安装后默认在登录 Windows 后隐藏启动（不是登录前系统服务）。每30秒检查请求，
每30分钟增量复查；离线失败退避最多5分钟。网页显示心跳、排队、同步和需登录状态。
`Pause` / `Stop` 会保留暂停，只有 `Resume` 恢复；`Status` 查看本机状态。

没有状态文件时只抓最近30天；以后复查7天，离线长间隔按31天分窗追赶。
`--history-from` / `--history-to` 指定历史区间。命令行只预览不上传：

```powershell
python .\sync.py --config .\config.json --dry-run
# --base-url 只覆盖本次目标，不修改配置
python .\sync.py --config .\config.json --sync --base-url https://your-workspace.example
```

网络失败保存并复用同一 pending operation。版本冲突保留草稿，核对后才能使用
`--retry-conflict`。网站令牌撤销与 Garmin 重新认证分别报告，原始异常不会上报网站。

同步器不会把跑步、心率或位置扩展成时间点。Garmin 只有总时长时不会编造起止；有
明确清醒标签的阶段会排除，未知数字活动等级不会猜测。人工修正保护和幂等去重必须
由 `/api/time/garmin/commit` 后端继续执行；网站离线时不标记已同步。

验证：`python scripts/garmin/test_sync.py` 与 `python tests/garmin-sync_test.py`。
合成测试不替代真实账户登录、开机启动或 iPad 到本机同步验收。
# 本机网络代理

若浏览器使用本机代理而后台无法直连网站，可在私有 `config.json` 设置 `websiteProxy`（例如 `http://127.0.0.1:7890`）。只影响正式站请求，保留 HTTPS 验证；Garmin 登录仍使用原连接。仅接受本机代理地址，代理未启动时任务保留并退避重试，不修改系统代理。

