import type { FinanceState, FinanceTransaction } from '../../lib/finance-types.ts';

const account = {
  id: 'wallet',
  version: 1,
  name: '合成钱包',
  kind: 'asset' as const,
  openingCents: 200_000,
  openingAt: '2026-01-01T00:00:00+08:00',
};

const categories = [
  { id: 'life', version: 1, name: '日常生活', parentId: null, level: 1 as const },
  { id: 'life-food', version: 1, name: '餐饮', parentId: 'life', level: 2 as const },
  { id: 'life-meal', version: 1, name: '正餐', parentId: 'life-food', level: 3 as const },
  { id: 'life-snack', version: 1, name: '零食饮品', parentId: 'life-food', level: 3 as const },
  { id: 'transport', version: 1, name: '出行交通', parentId: null, level: 1 as const },
  { id: 'transport-public', version: 1, name: '公共交通', parentId: 'transport', level: 2 as const },
  { id: 'transport-rail', version: 1, name: '高铁', parentId: 'transport-public', level: 3 as const },
  { id: 'transport-bus', version: 1, name: '公交地铁', parentId: 'transport-public', level: 3 as const },
  { id: 'home', version: 1, name: '居住家居', parentId: null, level: 1 as const },
  { id: 'home-rent', version: 1, name: '居住', parentId: 'home', level: 2 as const },
  { id: 'home-rent-month', version: 1, name: '月租', parentId: 'home-rent', level: 3 as const },
  { id: 'hobby', version: 1, name: '兴趣运动', parentId: null, level: 1 as const },
  { id: 'hobby-run', version: 1, name: '跑步', parentId: 'hobby', level: 2 as const },
  { id: 'hobby-race', version: 1, name: '赛事报名', parentId: 'hobby-run', level: 3 as const },
  { id: 'study', version: 1, name: '学习成长', parentId: null, level: 1 as const },
  { id: 'study-book', version: 1, name: '资料书籍', parentId: 'study', level: 2 as const },
  { id: 'study-book-paper', version: 1, name: '纸质书', parentId: 'study-book', level: 3 as const },
  { id: 'health', version: 1, name: '健康医疗', parentId: null, level: 1 as const },
  { id: 'health-care', version: 1, name: '医疗护理', parentId: 'health', level: 2 as const },
  { id: 'health-medicine', version: 1, name: '药品', parentId: 'health-care', level: 3 as const },
  { id: 'entertainment', version: 1, name: '文化娱乐', parentId: null, level: 1 as const },
  { id: 'entertainment-film', version: 1, name: '影音', parentId: 'entertainment', level: 2 as const },
  { id: 'entertainment-film-ticket', version: 1, name: '电影票', parentId: 'entertainment-film', level: 3 as const },
];

function expense(
  id: string,
  date: string,
  amountCents: number,
  categoryId: string | null,
  content: string,
  note: string,
  options: { analysisOnly?: boolean } = {},
): FinanceTransaction {
  return {
    id,
    version: 1,
    kind: 'expense',
    occurredAt: `${date}T12:00:00+08:00`,
    accountId: 'wallet',
    amountCents,
    personalCents: amountCents,
    counterparty: note,
    allocations: [
      {
        id: `${id}-allocation`,
        categoryId,
        content,
        amountCents,
        nature: 'daily',
      },
    ],
    analysisOnly: options.analysisOnly,
  };
}

/** A deterministic, synthetic ledger used by report-data tests and PDF previews. */
export function makeFinanceReportFixture(): FinanceState {
  const transactions: FinanceTransaction[] = [
    expense('food-main', '2026-09-02', 4_500, 'life-meal', '晚餐', '合成食堂'),
    {
      id: 'aa-split',
      version: 1,
      kind: 'expense',
      occurredAt: '2026-09-04T18:30:00+08:00',
      accountId: 'wallet',
      amountCents: 6_000,
      personalCents: 3_000,
      counterparty: '合成餐厅（AA）',
      allocations: [
        {
          id: 'aa-meal',
          categoryId: 'life-meal',
          content: '聚餐本人承担',
          amountCents: 2_000,
          nature: 'daily',
        },
        {
          id: 'aa-snack',
          categoryId: 'life-snack',
          content: '饮品本人承担',
          amountCents: 1_000,
          nature: 'daily',
        },
      ],
    },
    expense('rail-ticket', '2026-09-06', 7_500, 'transport-rail', '往返高铁', '合成铁路'),
    expense('monthly-rent', '2026-09-08', 12_000, 'home-rent-month', '九月房租', '合成公寓'),
    expense('race-entry', '2026-09-10', 5_000, 'hobby-race', '赛事报名', '合成赛事'),
    expense('book-purchase', '2026-09-12', 3_600, 'study-book-paper', '专业书籍', '合成书店'),
    expense('medicine', '2026-09-15', 2_400, 'health-medicine', '常用药品', '合成药房'),
    expense('movie', '2026-09-18', 1_800, 'entertainment-film-ticket', '电影票', '合成影院'),
    expense(
      'long-note',
      '2026-09-20',
      1_200,
      null,
      '暂未归档的长说明',
      '一段用于验证中文复制、PDF换行和明细截短策略的合成长说明商户名称',
    ),
    expense(
      'analysis-only',
      '2026-09-22',
      900,
      'hobby-race',
      '分析记录',
      '仅分析记录',
      { analysisOnly: true },
    ),
    {
      id: 'sep-refund',
      version: 1,
      kind: 'refund',
      occurredAt: '2026-10-02T10:00:00+08:00',
      accountId: 'wallet',
      amountCents: 1_500,
      personalCents: 1_500,
      relatedId: 'rail-ticket',
      allocations: [
        {
          id: 'sep-refund-allocation',
          categoryId: 'transport-rail',
          content: '跨月退款',
          amountCents: 1_500,
          nature: 'daily',
          refundOfAllocationId: 'rail-ticket-allocation',
        },
      ],
    },
    {
      id: 'unmapped-refund',
      version: 1,
      kind: 'refund',
      occurredAt: '2026-09-28T10:00:00+08:00',
      accountId: 'wallet',
      amountCents: 500,
      personalCents: 500,
      relatedId: 'food-main',
      allocations: [],
    },
    {
      id: 'income',
      version: 1,
      kind: 'income',
      occurredAt: '2026-09-07T09:00:00+08:00',
      accountId: 'wallet',
      amountCents: 30_000,
      allocations: [],
    },
    {
      id: 'transfer',
      version: 1,
      kind: 'transfer',
      occurredAt: '2026-09-09T09:00:00+08:00',
      accountId: 'wallet',
      targetAccountId: 'savings',
      amountCents: 10_000,
      allocations: [],
    },
    {
      id: 'lend',
      version: 1,
      kind: 'lend',
      occurredAt: '2026-09-11T09:00:00+08:00',
      accountId: 'wallet',
      amountCents: 2_000,
      allocations: [],
    },
  ];
  return {
    owner: 'synthetic-report-owner',
    space: 'demo',
    version: 1,
    accounts: [
      { ...account },
      {
        id: 'savings',
        version: 1,
        name: '合成储蓄账户',
        kind: 'asset',
        openingCents: 0,
        openingAt: '2026-01-01T00:00:00+08:00',
      },
    ],
    categories: categories.map(c => ({ ...c })),
    places: [],
    activities: [],
    transactions,
    meals: [],
    sponsorships: [],
    history: [],
  };
}

export const REPORT_FIXTURE_RANGE = {
  from: '2026-09-01',
  to: '2026-10-01',
} as const;

export const REPORT_FIXTURE_METADATA = {
  generatedAt: '2026-10-09T04:00:00Z',
  pendingCount: 2,
  localDraft: false,
} as const;
