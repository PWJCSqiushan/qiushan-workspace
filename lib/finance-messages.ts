/** Present domain validation without disguising it as a connection problem. */
export function financeMessage(value: unknown): string {
  const text =
    value instanceof Error
      ? value.message
      : typeof value === 'string' && value
        ? value
        : '账本校验失败';
  const rules: [RegExp, string][] = [
    [/summary group/, '统计合并组需要统一名称，并且只能设置在一级地点上。'],
    [
      /place directory supports two levels/,
      '地点只分一级地点和具体餐厅两层，请选择一级地点作为上级。',
    ],
    [
      /version conflict|expectedVersion/,
      '该记录已经变化，本机修改仍保留，请先核对最新版本。',
    ],
    [
      /sourceKey.*duplicate|duplicate.*sourceKey/i,
      '该平台交易号已经存在，可能是已删除或已导入记录，请核对原流水。',
    ],
    [
      /meal.*duplicate|duplicate.*meal|meal slot|same date.*meal/i,
      '这一天的同一餐次已经有记录，请编辑已有的一餐。',
    ],
    [
      /refund.*exceed/i,
      '退款超过原交易剩余可退的本人消费或代垫金额，请核对关联交易。',
    ],
    [
      /collect.*exceed|receivable.*exceed/i,
      '收款超过这项往来尚未收回的金额，请核对已收款和退款。',
    ],
    [
      /repay.*exceed|payable.*exceed/i,
      '还款超过这项往来尚未偿还的金额，请核对已有还款。',
    ],
    [
      /custody.*exceed|custody.*negative/i,
      '本次代管付款超过该事项的代管余额。',
    ],
    [
      /opening.*chang|opening.*modif/i,
      '账户已有资金变动，不能直接改期初余额或截至时刻，请用余额校正并注明原因。',
    ],
    [
      /before.*opening|opening.*before/i,
      '交易早于账户启用时刻，请选「仅供历史分析」或核对日期。',
    ],
    [
      /allocation.*sum|allocations.*equal|amount.*sum|balance.*personal/i,
      '用途分配合计必须等于本人承担金额。',
    ],
    [
      /category.*leaf|category.*level.*3/i,
      '消费用途必须选择三级明细；尚不清楚时可以留待分类。',
    ],
    [/other.*note|note.*other/i, '「其他已确认用途」需要填写具体用途说明。'],
    [
      /referenc|in use|used by/i,
      '这条记录仍被其他数据关联，先处理相关流水，或选择停用以保留历史。',
    ],
    [
      /account.*missing|account.*not found/i,
      '所选账户不存在或已删除，请重新选择账户。',
    ],
    [
      /category.*missing|category.*not found/i,
      '所选分类不存在，请重新选择用途。',
    ],
    [
      /original.*missing|related.*required/i,
      '请先选择对应的原消费或往来记录。',
    ],
    [
      /safe integer|integer cents|non-negative integer/i,
      '金额须为有效数值且最多两位小数，不能超过可支持范围。',
    ],
    [
      /configure.*empty/i,
      '分类目录已存在。请逐项编辑或预览恢复备份，不能再次初始化覆盖。',
    ],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || text;
}
