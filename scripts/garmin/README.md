# Garmin 本机同步器

`sync.py` 是 Windows 本机只读同步器的最小实现。它使用当前维护的
`python-garminconnect` 中国区登录参数（`Garmin(is_cn=True,
verify_login=True)`），首次登录时在本机提示账号、密码和 MFA；账号密码不会写入
仓库，也不会发送到聊天。连接成功后只读取 `get_sleep_data('YYYY-MM-DD')`，并把
必要的睡眠起止范围转换成时间看板导入预览。

实施当天在 Python 3.12 或更高版本的独立虚拟环境中安装当前维护版本，依赖来源以
`python-garminconnect` 仓库当日说明为准。不要照旧版 `garth` 教程复制 token；当前
库使用 mobileSSO/DI token，真实登录和中国区账号验证仍是用户本机人工验收项。

复制 `config.example.json` 为未跟踪的 `config.json`，按需要填入本地网站地址和可撤销
的时间导入 token。首次执行推荐：

```powershell
python .\sync.py --config .\config.json --dry-run
python .\sync.py --config .\config.json --sync --base-url http://127.0.0.1:4346
```

没有状态文件时只抓最近 30 天；之后每次向前复查 7 天，`--history-from`/`--history-to`
可手动指定更早范围。`start-hidden.ps1` 用隐藏窗口启动 30 分钟轮询，可由用户结束
对应 Python 进程；电脑关机期间不声称已同步，下次启动会按状态补齐。

同步器不会把跑步、心率或位置扩展成时间点。Garmin 只有总时长时不会编造起止；有
明确清醒标签的阶段会排除，未知数字活动等级不会猜测。人工修正保护和幂等去重必须
由 `/api/time/import` 后端继续执行；接口未完成或网站离线时，本批不会标记为已同步。
