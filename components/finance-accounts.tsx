'use client';
import { categoryLabel } from '@/lib/finance-category-codes';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { Plus, Download, Upload, ChevronRight } from 'lucide-react';
import type {
  FinanceAccount,
  FinanceActivity,
  FinanceCategory,
  FinanceEntity,
  FinancePlace,
  FinanceSponsorship,
  FinanceCollection,
  FinanceMutation,
} from '@/lib/finance-types';
import { financeRequest, type FinanceClient } from '@/lib/finance-client';
import { parseMoney } from '@/lib/finance-imports';
import { calculateFinanceStats } from '@/lib/finance-stats';
import {
  CategoryPicker,
  Dialog,
  Empty,
  Field,
  Panel,
  amount,
  bounds,
  exportFile,
  isoTime,
  isUnder,
  localTime,
  money,
  pathName,
  today,
  uid,
} from './finance-ui';

type Editor = {
  collection: Exclude<FinanceCollection, 'transactions' | 'meals'>;
  entity?: FinanceEntity;
};
export function FinanceAccounts({
  client,
  onMessage,
  onOpening,
}: {
  client: FinanceClient;
  onMessage: (s: string) => void;
  onOpening: () => void;
}) {
  const data = client.data!,
    [section, setSection] = useState<
      'accounts' | 'catalog' | 'places' | 'activities' | 'resources' | 'backup'
    >('accounts'),
    [editor, setEditor] = useState<Editor>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reviewDownload, setReviewDownload] = useState(''),
    [reviewText, setReviewText] = useState(''),
    [restore, setRestore] = useState<{
      file: unknown;
      count: number;
      version: number;
    }>();
  useEffect(
    () => () => {
      if (reviewDownload) URL.revokeObjectURL(reviewDownload);
    },
    [reviewDownload],
  );
  const balancesPending = data.accounts.some(
    (a) => !a.deleted && a.openingConfirmed === false,
  );
  const stats = calculateFinanceStats(data, bounds(today().slice(0, 7))),
    live = <T extends FinanceEntity>(items: T[]) =>
      items.filter((x) => !x.deleted);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const settings = [
    ['accounts', '账户与往来'],
    ['catalog', '分类目录'],
    ['places', '商家地点'],
    ['activities', '活动与事项'],
    ['resources', '赞助资源'],
    ['backup', '数据与备份'],
  ] as const;
  const ledgers = new Map<string, number>();
  for (const t of data.transactions.filter(
    (t) => !t.deleted && !t.analysisOnly,
  ))
    for (const p of t.postings || [])
      if (/^(receivable|payable|custody):/.test(p.account))
        ledgers.set(p.account, (ledgers.get(p.account) || 0) + p.cents);
  const outstanding = [...ledgers].filter(([, c]) => c !== 0);
  const configure = async (file: File) =>
    run(async () => {
      const value = JSON.parse(await file.text());
      if (!Array.isArray(value.categories))
        throw new Error('配置文件需要 categories 分类数组');
      await client.enqueue({
        type: 'configure',
        categories: value.categories,
        places: value.places || [],
      });
      onMessage('私有分类配置已加载');
    });
  const backup = async () =>
    run(async () => {
      if (client.pending.length)
        throw new Error('先完成待同步修改，再导出完整备份');
      const value = await financeRequest(
        '/api/finance/export?space=' + client.space,
      );
      exportFile(
        '生活账本-' + client.space + '-' + today() + '.json',
        JSON.stringify(value, null, 2),
      );
      onMessage('已导出带校验的账本备份');
    });
  const previewRestore = async (file: File) =>
    run(async () => {
      if (client.pending.length)
        throw new Error('请先处理待同步修改，恢复不会覆盖本机草稿');
      const value = JSON.parse(await file.text());
      if (value.space !== client.space)
        throw new Error('备份与当前个人 / 演示空间不一致');
      await financeRequest('/api/finance/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backup: value }),
      });
      setRestore({
        file: value,
        count: value.state.transactions.filter(
          (t: { deleted?: boolean }) => !t.deleted,
        ).length,
        version: data.version,
      });
    });
  return (
    <>
      <div className="f-subnav" role="tablist" aria-label="账户设置">
        {settings.map(([id, name]) => (
          <button
            role="tab"
            aria-selected={section === id}
            key={id}
            onClick={() => setSection(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {error && (
        <p className="f-error" role="alert">
          {error}
        </p>
      )}
      {section === 'accounts' && (
        <div className="f-account-layout">
          <Panel
            title="资金账户"
            action={
              <div className="f-row">
                <button
                  className="f-text"
                  disabled={!data.accounts.length}
                  onClick={onOpening}
                >
                  期初往来
                </button>
                <button
                  className="f-text"
                  onClick={() => setEditor({ collection: 'accounts' })}
                >
                  <Plus />
                  添加账户
                </button>
              </div>
            }
          >
            {stats.accountBalances.length ? (
              <div className="f-account-grid">
                {stats.accountBalances.map((a) => (
                  <button
                    className="f-account"
                    key={a.id}
                    onClick={() =>
                      setEditor({
                        collection: 'accounts',
                        entity: data.accounts.find((x) => x.id === a.id),
                      })
                    }
                  >
                    <span>
                      {a.name}
                      <small>
                        {a.kind === 'credit' ? '信用账户' : '资产账户'}
                      </small>
                    </span>
                    <strong>
                      {data.accounts.find((x) => x.id === a.id)
                        ?.openingConfirmed === false
                        ? '期初待填'
                        : money(a.cents)}
                    </strong>
                    <small>
                      截至当前 ·{' '}
                      {data.accounts.find((x) => x.id === a.id)?.archived
                        ? '已停用'
                        : '查看设置'}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                title="从期初余额开始"
                detail="填写余额截至时刻。历史账单只做分析时，不改变这一刻的余额。"
                action={
                  <button
                    className="f-primary"
                    onClick={() => setEditor({ collection: 'accounts' })}
                  >
                    建立第一个账户
                  </button>
                }
              />
            )}
            <div className="f-networth">
              <span>本人净资金</span>
              <b>
                {balancesPending
                  ? '待核对期初余额'
                  : money(
                      stats.accountBalances.reduce((s, a) => s + a.cents, 0) +
                        stats.receivableCents -
                        stats.payableCents -
                        stats.custodyCents,
                    )}
              </b>
              <small>账户余额＋待收－待付－代管款</small>
            </div>
          </Panel>
          <Panel title="尚未结清">
            <div className="f-three-summary">
              <span>
                待收<b>{money(stats.receivableCents)}</b>
              </span>
              <span>
                待付<b>{money(stats.payableCents)}</b>
              </span>
              <span>
                代管<b>{money(stats.custodyCents)}</b>
              </span>
            </div>
            {outstanding.length ? (
              <div className="f-list">
                {outstanding.map(([key, c]) => {
                  const [kind, id] = key.split(':'),
                    origin = data.transactions.find((t) => t.id === id),
                    caseInfo = data.activities.find((a) => a.id === id);
                  return (
                    <div key={key}>
                      <span>
                        <b>
                          {caseInfo?.name ||
                            origin?.counterparty ||
                            origin?.note ||
                            '未命名往来'}
                        </b>
                        <small>
                          {kind === 'receivable'
                            ? '待收'
                            : kind === 'payable'
                              ? '待付'
                              : '代管余额'}
                        </small>
                      </span>
                      <strong>{money(Math.abs(c))}</strong>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="目前没有未结往来"
                detail="AA、代垫、借还款和班费会按原事项列在这里。"
              />
            )}
          </Panel>
        </div>
      )}
      {section === 'catalog' && (
        <Panel
          title="三级分类目录"
          action={
            <div className="f-row">
              <label className="f-file-button">
                载入私有配置
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void configure(f);
                  }}
                />
              </label>
              <button onClick={() => setEditor({ collection: 'categories' })}>
                <Plus />
                新增分类
              </button>
            </div>
          }
        >
          <p className="f-hint">
            主要用途决定分类。停用保留历史，移动或改名会先展示影响范围。
          </p>
          {!data.categories.length ? (
            <Empty
              title="先载入你的分类目录"
              detail="个人分类和商家配置保存在自己的账本里，不打包进公开站点代码。"
            />
          ) : (
            <div className="f-catalog">
              {live(data.categories)
                .filter((c) => c.level === 1)
                .map((top) => (
                  <details key={top.id} open>
                    <summary>
                      <b>{top.name}</b>
                      <button
                        className="f-text"
                        onClick={(e) => {
                          e.preventDefault();
                          setEditor({ collection: 'categories', entity: top });
                        }}
                      >
                        编辑
                      </button>
                    </summary>
                    {live(data.categories)
                      .filter((c) => c.parentId === top.id)
                      .map((mid) => (
                        <details key={mid.id}>
                          <summary>
                            {categoryLabel(mid, 'both')}
                            <small>
                              {
                                data.categories.filter(
                                  (c) => c.parentId === mid.id && !c.deleted,
                                ).length
                              }{' '}
                              项明细
                            </small>
                            <button
                              className="f-text"
                              onClick={(e) => {
                                e.preventDefault();
                                setEditor({
                                  collection: 'categories',
                                  entity: mid,
                                });
                              }}
                            >
                              编辑
                            </button>
                          </summary>
                          <div className="f-leaves">
                            {live(data.categories)
                              .filter((c) => c.parentId === mid.id)
                              .map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() =>
                                    setEditor({
                                      collection: 'categories',
                                      entity: c,
                                    })
                                  }
                                >
                                  {c.name}
                                  {c.archived && <small>已停用</small>}
                                  <ChevronRight />
                                </button>
                              ))}
                          </div>
                        </details>
                      ))}
                  </details>
                ))}
            </div>
          )}
        </Panel>
      )}
      {section === 'places' && (
        <Panel
          title="商家与地点"
          action={
            <button onClick={() => setEditor({ collection: 'places' })}>
              <Plus />
              新增地点
            </button>
          }
        >
          <p className="f-hint">
            餐饮按“一级地点 →
            具体餐厅”录入。地点与消费分类彼此独立；同一栋楼的楼层可设置为同一统计组。
          </p>
          <div className="f-catalog">
            {live(data.places)
              .filter((p) => !p.parentId)
              .map((p) => (
                <details key={p.id} open>
                  <summary>
                    {p.name}
                    {p.summaryGroupName && (
                      <small>合并统计：{p.summaryGroupName}</small>
                    )}
                    <button
                      className="f-text"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditor({ collection: 'places', entity: p });
                      }}
                    >
                      编辑
                    </button>
                  </summary>
                  <div className="f-leaves">
                    {live(data.places)
                      .filter((c) => c.parentId === p.id)
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() =>
                            setEditor({ collection: 'places', entity: c })
                          }
                        >
                          {c.name}
                          {c.archived && <small>已停用</small>}
                          <ChevronRight />
                        </button>
                      ))}
                  </div>
                </details>
              ))}
          </div>
          {!data.places.length && <Empty title="添加常去的地方" />}
        </Panel>
      )}
      {section === 'activities' && (
        <Panel
          title="活动与代管事项"
          action={
            <button onClick={() => setEditor({ collection: 'activities' })}>
              <Plus />
              新建事项
            </button>
          }
        >
          <div className="f-list">
            {live(data.activities).map((a) => (
              <button
                key={a.id}
                onClick={() =>
                  setEditor({ collection: 'activities', entity: a })
                }
              >
                <span>
                  <b>{a.name}</b>
                  <small>
                    {a.kind === 'custody'
                      ? '代管事项，不计个人收支'
                      : '关联消费活动'}
                    {a.date ? ' · ' + a.date : ''}
                  </small>
                </span>
                <ChevronRight />
              </button>
            ))}
          </div>
          {!data.activities.length && (
            <Empty
              title="为一场活动归集花费"
              detail="赛事、旅行和项目可关联不同用途的消费；班费使用代管事项。"
            />
          )}
        </Panel>
      )}
      {section === 'resources' && (
        <Panel
          title="家庭直接赞助与实物支持"
          action={
            <button onClick={() => setEditor({ collection: 'sponsorships' })}>
              <Plus />
              记录赞助
            </button>
          }
        >
          <p className="f-callout">
            只记录直接由家人支付或提供的资源；现金资助请记真实收入，再记录自己的购买，避免重复增加投入。
          </p>
          <div className="f-list">
            {live(data.sponsorships).map((s) => (
              <button
                key={s.id}
                onClick={() =>
                  setEditor({ collection: 'sponsorships', entity: s })
                }
              >
                <span>
                  <b>{s.name}</b>
                  <small>
                    {s.date || '日期未记录'} ·{' '}
                    {pathName(data.categories, s.categoryId)}
                  </small>
                </span>
                <strong>{money(s.amountCents)}</strong>
              </button>
            ))}
          </div>
          {!data.sponsorships.length && <Empty title="尚未记录直接赞助" />}
        </Panel>
      )}
      {section === 'backup' && (
        <Panel title="数据与备份">
          <div className="f-backup-options">
            {' '}
            <div>
              <h3>迁移核对草稿</h3>
              <details>
                <summary>文本迁移（下载或剪贴板不可用时）</summary>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setReviewText(
                        JSON.stringify(await client.exportReviewBundle()),
                      );
                    })
                  }
                >
                  生成草稿文本
                </button>
                <textarea
                  aria-label="核对草稿文本"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  rows={4}
                  spellCheck={false}
                />
                <button
                  disabled={busy || !reviewText.trim()}
                  onClick={() =>
                    void run(async () => {
                      if (reviewText.length > 40000000)
                        throw new Error('草稿内容超过40 MB');
                      await client.importReviewBundle(JSON.parse(reviewText));
                      setReviewText('');
                      onMessage('核对草稿已导入本机');
                    })
                  }
                >
                  导入草稿文本
                </button>
              </details>
              <p>
                将待核对账单与饭卡截图带到另一台设备或正式站。先迁入账本流水，再导入草稿；不会覆盖已有不同草稿。
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setReviewDownload(
                      URL.createObjectURL(
                        new Blob(
                          [JSON.stringify(await client.exportReviewBundle())],
                          { type: 'application/json' },
                        ),
                      ),
                    );
                    onMessage('核对草稿已准备，请下载保存；原稿仍保留');
                  })
                }
              >
                导出核对草稿
              </button>{' '}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(
                      JSON.stringify(await client.exportReviewBundle()),
                    );
                    onMessage('核对草稿已复制');
                  })
                }
              >
                复制核对草稿
              </button>{' '}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const text = await navigator.clipboard.readText();
                    if (text.length > 40000000)
                      throw new Error('草稿内容超过40 MB');
                    await client.importReviewBundle(JSON.parse(text));
                    onMessage('核对草稿已导入本机');
                  })
                }
              >
                从剪贴板导入草稿
              </button>{' '}
              {reviewDownload && (
                <a href={reviewDownload} download="finance-review-drafts.json">
                  下载核对草稿文件
                </a>
              )}{' '}
              <label className="f-file-button">
                导入核对草稿
                <input
                  aria-label="导入核对草稿"
                  disabled={busy}
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void run(async () => {
                      if (file.size > 40000000)
                        throw new Error('草稿文件超过40 MB');
                      await client.importReviewBundle(
                        JSON.parse(await file.text()),
                      );
                      onMessage('核对草稿已导入本机');
                    });
                    e.target.value = '';
                  }}
                />
              </label>
            </div>{' '}
            {data.space === 'personal' && (
              <div>
                <h3>接续演示账本的核对草稿</h3>
                <p>
                  流水迁入个人账本后，可复制本机尚待核对的账单与饭卡记录；原草稿保留，已有不同草稿不会覆盖。
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await client.copyDemoReviewDrafts();
                      onMessage('核对草稿已复制到个人账本，原草稿仍保留');
                    })
                  }
                >
                  复制演示核对草稿
                </button>
              </div>
            )}
            <div>
              <h3>完整备份</h3>
              <p>
                包含分类、账户、流水、餐饮、往来和撤销记录；工作流与时间记录保持独立。
              </p>
              <button disabled={busy} onClick={() => void backup()}>
                <Download />
                导出账本备份
              </button>
            </div>
            <div>
              <h3>恢复备份</h3>
              <p>
                先校验并预览。恢复前自动在本机保留完整副本，可随时下载恢复。
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const saved = await client.recoveryBackup();
                    if (!saved) throw new Error('尚未执行过备份恢复');
                    exportFile(
                      '生活账本-恢复前副本.json',
                      JSON.stringify(saved, null, 2),
                    );
                  })
                }
              >
                下载最近一次恢复前副本
              </button>{' '}
              <label className="f-file-button">
                <Upload />
                选择备份文件
                <input
                  disabled={busy}
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void previewRestore(f);
                  }}
                />
              </label>
            </div>
          </div>
        </Panel>
      )}
      {editor && (
        <EntityEditor
          client={client}
          editor={editor}
          onClose={() => setEditor(undefined)}
          onMessage={onMessage}
        />
      )}
      {restore && (
        <Dialog
          title="确认恢复账本"
          onClose={() => setRestore(undefined)}
          busy={busy}
        >
          <div className="f-dialog-body">
            <p>
              文件包含 {restore.count} 笔流水。当前空间的{' '}
              {data.transactions.filter((t) => !t.deleted).length}{' '}
              笔流水及相关设置将被备份替换。
            </p>
            <p className="f-callout">
              请先导出当前账本留存。恢复不覆盖工作流和时间记录。
            </p>
            {error && <p className="f-error">{error}</p>}
          </div>
          <footer>
            <button onClick={() => void backup()} disabled={busy}>
              先导出当前备份
            </button>
            <button
              className="f-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const recovery = await financeRequest(
                    '/api/finance/export?space=' + client.space,
                  );
                  await client.saveRecoveryBackup(recovery);
                  await financeRequest('/api/finance/restore', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      backup: restore.file,
                      confirm: true,
                      expectedVersion: restore.version,
                      operationId: uid('restore'),
                    }),
                  });
                  await client.sync();
                  setRestore(undefined);
                  onMessage('账本已恢复');
                })
              }
            >
              确认恢复
            </button>
          </footer>
        </Dialog>
      )}
    </>
  );
}

function EntityEditor({
  client,
  editor,
  onClose,
  onMessage,
}: {
  client: FinanceClient;
  editor: Editor;
  onClose: () => void;
  onMessage: (m: string) => void;
}) {
  const data = client.data!,
    { collection, entity } = editor,
    source = (entity || {}) as Partial<
      Omit<FinanceAccount, 'kind'> &
        FinanceCategory &
        FinancePlace &
        Omit<FinanceActivity, 'kind'> &
        FinanceSponsorship
    > & { kind?: string };
  const [name, setName] = useState(source.name || ''),
    [brand, setBrand] = useState(source.brand || ''),
    [aliases, setAliases] = useState((source.aliases || []).join('\n')),
    [code, setCode] = useState(source.code || ''),
    [kind, setKind] = useState<string>(
      source.kind || (collection === 'activities' ? 'event' : 'asset'),
    ),
    [value, setValue] = useState(
      'openingCents' in source
        ? amount(source.openingCents || 0)
        : 'amountCents' in source
          ? amount(source.amountCents || 0)
          : '',
    ),
    [date, setDate] = useState(source.date || today()),
    [time, setTime] = useState(
      source.openingAt
        ? localTime(source.openingAt)
        : localTime(new Date().toISOString()),
    ),
    [parent, setParent] = useState(source.parentId || ''),
    [level, setLevel] = useState(source.level || 3),
    [category, setCategory] = useState<string | null>(
      source.categoryId || null,
    ),
    [note, setNote] = useState(source.note || ''),
    [archived, setArchived] = useState(!!source.archived),
    [other, setOther] = useState(!!source.other),
    [content, setContent] = useState(source.content || ''),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [defaultCategory, setDefaultCategory] = useState<string | null>(
      source.defaultCategoryId || null,
    ),
    [reportGroup, setReportGroup] = useState(source.summaryGroupId || ''),
    [groupName, setGroupName] = useState(source.summaryGroupName || '');
  const reportGroups = [
    ...new Map(
      data.places
        .filter((p) => !p.deleted && !p.parentId && p.summaryGroupId)
        .map((p) => [p.summaryGroupId!, p.summaryGroupName!]),
    ).entries(),
  ];
  const affected =
    collection === 'categories' && entity
      ? data.transactions.filter(
          (t) =>
            !t.deleted &&
            t.allocations.some((a) =>
              isUnder(data.categories, a.categoryId, entity.id),
            ),
        )
      : [];
  const titles: Partial<Record<FinanceCollection, string>> = {
    accounts: '账户',
    categories: '分类',
    places: '地点',
    activities: '活动 / 事项',
    sponsorships: '赞助资源',
  };
  const save = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (
      collection === 'categories' &&
      entity &&
      (affected.length || code !== source.code || parent !== source.parentId) &&
      !preview
    ) {
      setPreview(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const base = {
        id: entity?.id || uid(collection.slice(0, 3)),
        version: entity?.version || 0,
        name: name.trim(),
      };
      let next: FinanceEntity;
      if (collection === 'accounts') {
        const cents =
          kind === 'credit'
            ? -parseMoney(value.replace(/^-/, ''))
            : value.startsWith('-')
              ? -parseMoney(value.slice(1))
              : parseMoney(value);
        next = {
          ...base,
          kind: kind as FinanceAccount['kind'],
          openingCents: cents,
          openingAt: isoTime(time),
          openingConfirmed: true,
          archived,
        };
      } else if (collection === 'categories')
        next = {
          ...source,
          ...base,
          level: level as 1 | 2 | 3,
          parentId: level === 1 ? null : parent || null,
          archived,
          other,
          content: content || undefined,
          code: level < 3 ? code.trim().toUpperCase() || undefined : undefined,
        };
      else if (collection === 'places') {
        if (!parent && reportGroup === 'new' && !groupName.trim())
          throw new Error('请填写统计合并名称');
        const groupId =
          reportGroup === 'new' ? uid('place_group') : reportGroup;
        next = {
          ...source,
          ...base,
          brand: brand.trim() || undefined,
          aliases: [
            ...new Set(
              aliases
                .split(/[\n，,]/)
                .map((a) => a.trim())
                .filter(Boolean),
            ),
          ],
          parentId: parent || null,
          archived,
          defaultCategoryId: defaultCategory || undefined,
          summaryGroupId: !parent && groupId ? groupId : undefined,
          summaryGroupName:
            !parent && groupId
              ? reportGroup === 'new'
                ? groupName.trim()
                : reportGroups.find(([id]) => id === groupId)?.[1]
              : undefined,
        } as FinancePlace;
      } else if (collection === 'activities')
        next = { ...base, kind: kind as FinanceActivity['kind'], date, note };
      else {
        if (!category) throw new Error('请选择赞助对应的三级用途');
        next = {
          ...base,
          date,
          categoryId: category,
          amountCents: parseMoney(value),
          note,
        };
      }
      const edits: Exclude<FinanceMutation, { type: 'batch' }>[] = [
        {
          type: 'put',
          collection,
          entity: next,
          expectedVersion: entity?.version || 0,
        },
      ];
      if (
        collection === 'categories' &&
        level === 1 &&
        code &&
        code !== source.code
      ) {
        for (const child of data.categories.filter(
          (c) => c.parentId === entity?.id && c.code && !c.deleted,
        ))
          edits.push({
            type: 'put',
            collection: 'categories',
            entity: {
              ...child,
              code: code.toUpperCase() + child.code!.slice(1),
            },
            expectedVersion: child.version,
          });
      }
      const result = await client.enqueue(
        edits.length === 1 ? edits[0] : { type: 'batch', mutations: edits },
      );
      onMessage(result.message);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={(entity ? '编辑' : '新增') + titles[collection]}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={save}>
        <div className="f-dialog-body">
          {preview && collection === 'categories' && (
            <p className="f-notice">
              代码 {source.code || '未设置'} → {code || '未设置'}；关联的{' '}
              {affected.length} 条流水保持原分类
              ID。一级前缀变化会同步调整直属小类代码。
            </p>
          )}
          <Field label="名称">
            <input
              required
              value={name}
              maxLength={100}
              onChange={(e) => {
                setName(e.target.value);
                setPreview(false);
              }}
            />
          </Field>
          {collection === 'accounts' && (
            <>
              <Field label="账户类型">
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="asset">
                    资产账户（银行卡、现金、饭卡等）
                  </option>
                  <option value="credit">信用账户（信用卡、花呗等）</option>
                </select>
              </Field>
              <div className="f-form-grid">
                <Field label={kind === 'credit' ? '期初信用欠款' : '期初余额'}>
                  <input
                    required
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </Field>
                <Field label="余额截至时刻">
                  <input
                    type="datetime-local"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </Field>
              </div>
              <p className="f-hint">
                第一次补期初余额时，截至时刻需在已记流水之前；如果只知道今天的余额，可以通过余额校正处理。
              </p>
            </>
          )}
          {collection === 'categories' && (
            <>
              <Field label="分类层级">
                <select
                  value={level}
                  disabled={!!entity}
                  onChange={(e) => {
                    setLevel(Number(e.target.value) as 1 | 2 | 3);
                    setParent('');
                  }}
                >
                  <option value={1}>大类</option>
                  <option value={2}>小类</option>
                  <option value={3}>明细</option>
                </select>
              </Field>
              {level < 3 && (
                <Field
                  label="分类代码"
                  help={
                    level === 1
                      ? '一个大写字母；修改时同步调整小类前缀。'
                      : '两个大写字母，首字母对应所属大类。'
                  }
                >
                  <input
                    value={code}
                    maxLength={level}
                    pattern={level === 1 ? '[A-Z]' : '[A-Z]{2}'}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      setPreview(false);
                    }}
                  />
                </Field>
              )}
              {level > 1 && (
                <Field label="所属分类">
                  <select
                    required
                    value={parent}
                    onChange={(e) => {
                      setParent(e.target.value);
                      const nextParent = data.categories.find(
                        (c) => c.id === e.target.value,
                      );
                      if (level === 2 && code && nextParent?.code)
                        setCode(nextParent.code + code.slice(1));
                      setPreview(false);
                    }}
                  >
                    <option value="">选择上级分类</option>
                    {data.categories
                      .filter(
                        (c) =>
                          !c.deleted && !c.archived && c.level === level - 1,
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {pathName(data.categories, c.id)}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              {level === 3 && (
                <>
                  <Field label="常用内容属性（可选）">
                    <input
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                  </Field>
                  <label className="f-check">
                    <input
                      type="checkbox"
                      checked={other}
                      onChange={(e) => setOther(e.target.checked)}
                    />
                    其他已确认用途，录入时要求说明
                  </label>
                </>
              )}
            </>
          )}
          {collection === 'places' && (
            <>
              <Field
                label="品牌"
                help="仅填写已确认的品牌；不同门店可按品牌合并统计。"
              >
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  maxLength={100}
                />
              </Field>
              <Field
                label="账单别名"
                help="每行一个，供饭卡截图匹配；不会修改原始商户名称。"
              >
                <textarea
                  value={aliases}
                  onChange={(e) => setAliases(e.target.value)}
                  rows={2}
                />
              </Field>
              <Field label="一级地点">
                <select
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                >
                  <option value="">本身就是一级地点</option>
                  {data.places
                    .filter(
                      (p) => !p.deleted && !p.parentId && p.id !== entity?.id,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              {!parent && (
                <>
                  <Field
                    label="合并统计"
                    help="录入仍按各地点区分；统计可把同一栋楼或区域合并。"
                  >
                    <select
                      value={reportGroup}
                      onChange={(e) => setReportGroup(e.target.value)}
                    >
                      <option value="">单独统计</option>
                      {reportGroups.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                      <option value="new">新建一个合并组…</option>
                    </select>
                  </Field>
                  {reportGroup === 'new' && (
                    <Field label="合并后的显示名称">
                      <input
                        required
                        maxLength={100}
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                      />
                    </Field>
                  )}
                </>
              )}
              <details className="f-extra">
                <summary>默认用餐分类</summary>
                <p className="f-hint">
                  可给常去餐厅设置日常消费用途。具体餐厅未设置时继承一级地点；请客时仍需单独确认用途。
                </p>
                <CategoryPicker
                  categories={data.categories}
                  value={defaultCategory}
                  onChange={setDefaultCategory}
                />
              </details>
            </>
          )}

          {collection === 'activities' && (
            <Field label="事项性质">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="event">活动 / 赛事 / 旅行 / 项目</option>
                <option value="custody">代管款事项（班费等）</option>
              </select>
            </Field>
          )}
          {['activities', 'sponsorships'].includes(collection) && (
            <>
              <Field label="日期">
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              {collection === 'sponsorships' && (
                <>
                  <CategoryPicker
                    categories={data.categories}
                    value={category}
                    onChange={setCategory}
                  />
                  <Field label="资源金额">
                    <input
                      required
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label="说明">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </Field>
            </>
          )}
          {['accounts', 'categories', 'places'].includes(collection) &&
            entity && (
              <label className="f-check">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => {
                    setArchived(e.target.checked);
                    setPreview(false);
                  }}
                />
                停用（保留历史记录）
              </label>
            )}
          {preview && (
            <div className="f-callout">
              <b>将影响 {affected.length} 笔历史消费的分类展示</b>
              <p>
                {pathName(data.categories, entity?.id)} →{' '}
                {level > 1 ? pathName(data.categories, parent) + ' / ' : ''}
                {name}
              </p>
              <p>金额和原始分配不变，可用撤销恢复目录修改。</p>
              <ul>
                {affected.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    {localTime(t.occurredAt).slice(0, 10)} ·{' '}
                    {t.counterparty || t.note || '未命名消费'} ·{' '}
                    {money(t.personalCents || 0)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <p className="f-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="f-primary" disabled={busy}>
            {busy ? '正在保存…' : preview ? '确认上述影响并保存' : '保存'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
