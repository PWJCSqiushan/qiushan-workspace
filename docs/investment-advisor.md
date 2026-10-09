# 个人工作台自动建议规则

`lib/investment-advisor.ts` 提供纯函数 `buildInvestmentAdvice(state, asOf?, generatedAt?)`。它只读取传入的投资状态，不请求网络、不写 D1/KV、不调用模型，也不生成委托、成交或建议数量。调用方可以把返回值作为只读的首页建议或保存预案的输入；保存预案仍由 API 层负责版本和幂等校验。

## 来源与移植边界

本实现按只读审阅的 Python 规则移植，未运行源项目 runtime，也未读取任何私人账本金额。源文件审阅时的 SHA-256 如下：

- `backend/advisor.py`: `7F9A49AE835A746F17E44363A80EB5C545AB4FB687738FE9AC899A8574340E57`
- `tests/test_advisor.py`: `BA335084150C0AB28D003855FB20C636A7FAD6065F7A8B13D2BECE0C52DB3D61`
- `docs/自动建议规则.md`: `41FE2E5DC5B5AB26FBE3DF552616D0D95ED553420B649B832C5AFF5D5B4088F0`
- `docs/自动建议接口.md`: `BE22C9C87DFCE386329CB16E856EF4920B8F30FB90091213CF68A5F6970EE58`

## 规则摘要

- 股票和 ETF 必须通过 `kind:exchange:code` 身份、来源、当日 fresh 报价、历史日期顺序、60 条历史、7 个自然日新鲜度和已核验交易规则检查。指数只参与市场覆盖；场外基金只观察 `confirmed_nav`，不产生场内买卖动作。
- 强势要求 `现价 > MA20 > MA60` 且 20 个交易间隔动量为正；弱势要求现价同时低于 MA20 和 MA60。只低于其中一条时保持中性观察。持仓弱势返回 `reduce`，但计划动作是 `observe`，不推导可卖数量。
- 非持仓证券只有 `personalized=true` 且 `watched !== false` 时才进入个性化候选池；持仓始终按账本真实正数量显示，即使品种被取消关注。买入候选还要满足用途、期限、持仓确认、费用、证券现金、亏损暂停线、集中度提示和 ETF 同日 IOPV 条件。
- ETF 折溢价按现价/同日 IOPV 计算。IOPV 必须有适用日期、可用来源和链接；缺失、异日或不可追溯时保持待核验，不把未知当作零溢价。
- 只读取 `portfolio.cash` 作为证券现金。外部现金、券商显示成本、负摊薄成本和截图字段不会改变成本、证券现金、净投入或盈亏判断。未知平均成本保留为风险提示，仍可复核持仓趋势。
- 市场覆盖只接受有效来源和适用日期的指数、宽度、情绪、宏观及资金数据。综合分和 `score_label` 始终为 `null`，不补造中性 50 分。

规则返回的每个品种都带证据日期、来源、阻断、风险、触发条件和 `plan.budget = null`。`generated_at` 仅用于展示。

## 决策身份

`decision_id` 使用 SHA-256 截取 24 个十六进制字符，绑定 `auto-advice-v1`、品种快照、当前 `contextId(state)`、分析日、最终动作及理由/阻断/计划、市场覆盖摘要和账本持仓/资金字段，不绑定 `generated_at`。行情、市场、账本、账户上下文或分析日发生变化后，调用方应重新生成并拒绝把旧决策当作当前建议。

## 验证

测试只构造合成状态，不读源 runtime 或私人数据：

```text
npx tsc --noEmit --incremental false
node --experimental-transform-types --test tests/investment-advisor.test.ts
```

测试覆盖账户门槛、持仓弱势和防守总览、未知平均成本/费用、外部现金隔离、历史过期与日期错配、ETF IOPV、基金/指数限制、类型与持仓身份、市场覆盖、决策日期/context 失效和幂等稳定性。
