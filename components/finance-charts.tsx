'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
} from 'lucide-react';
import type { FinanceState, FinanceStats } from '@/lib/finance-types';
import type { CategoryLabelMode } from '@/lib/finance-category-codes';
import { categoryLabel } from '@/lib/finance-category-codes';
import { calculateFinanceStats } from '@/lib/finance-stats';
import { mealPlaceTone } from '@/lib/finance-places';
import {
  categoryChartModel,
  categoryPath,
  chartDay,
  chartMonthBounds,
  chartPreset,
  completeDays,
  mealChartGroups,
  monthSeries,
  shiftDay,
  type ChartRange,
} from '@/lib/finance-chart-data';
import { Dialog, Panel, Ring, money, today } from './finance-ui';
import type { FinanceFilter } from './finance-overview';

export function CategoryDonut({
  data,
  stats,
  mode,
  base = null,
  onDrill,
  compact = false,
}: {
  data: FinanceState;
  stats: FinanceStats;
  mode: CategoryLabelMode;
  base?: string | null;
  onDrill: (f: FinanceFilter) => void;
  compact?: boolean;
}) {
  const [node, setNode] = useState<string | null>(base);
  const model = useMemo(() => categoryChartModel(data, stats), [data, stats]);
  const groups = model.groups(node, mode),
    path = categoryPath(data.categories, node),
    total = groups.reduce((s, g) => s + g.cents, 0);
  return (
    <div className={'f-category-chart ' + (compact ? 'is-compact' : '')}>
      <div className="f-chart-breadcrumb" aria-label="图表分类路径">
        {node && (
          <button
            className="f-icon"
            aria-label="返回上一级分类"
            onClick={() => setNode(path.at(-1)?.parentId || null)}
          >
            <ArrowLeft />
          </button>
        )}
        <button onClick={() => setNode(null)} aria-label="回到全部用途">
          全部
        </button>
        {path.map((c) => (
          <span key={c.id}>
            <ChevronRight />
            <button title={c.name} onClick={() => setNode(c.id)}>
              {categoryLabel(c, mode)}
            </button>
          </span>
        ))}
        {node === 'unclassified' && <span> / 待分类</span>}
      </div>
      <Ring groups={groups} total={total} onSelect={(id) => setNode(id)} />
      <div className="f-chart-foot">
        <span>{node ? '占当前分类合计' : '占已记录本人消费'}</span>
        <button
          onClick={() =>
            onDrill({
              view: node ? 'purpose' : 'all',
              id: node || '',
              name:
                node === 'unclassified'
                  ? '待分类'
                  : path.at(-1)?.name || '全部消费',
              range: { from: stats.from, to: stats.to },
            })
          }
        >
          查看流水 <ArrowUpRight />
        </button>
      </div>
    </div>
  );
}

type MealCardConfig = { slot: string; level: 'area' | 'venue' | 'brand' };
type Preferences = {
  slots: string[];
  mealCards: MealCardConfig[];
  measure: 'count' | 'money';
};
const slotNames: Record<string, string> = {
  all: '三餐合计',
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
};
const defaultMeals: MealCardConfig[] = [
  { slot: 'all', level: 'area' },
  { slot: 'breakfast', level: 'area' },
  { slot: 'lunch', level: 'area' },
  { slot: 'dinner', level: 'area' },
];
export function FinanceCharts({
  data,
  month,
  mode,
  onDrill,
}: {
  data: FinanceState;
  month: string;
  mode: CategoryLabelMode;
  onDrill: (f: FinanceFilter) => void;
}) {
  const [theme, setTheme] = useState<'structure' | 'trends' | 'meals'>(
      'structure',
    ),
    [preset, setPreset] = useState('month'),
    [custom, setCustom] = useState({
      from: month + '-01',
      to: shiftDay(chartMonthBounds(month).to, -1),
    }),
    [prefs, setPrefs] = useState<Preferences>({
      slots: [],
      mealCards: defaultMeals,
      measure: 'count',
    }),
    [loaded, setLoaded] = useState(false),
    [mealCalendar, setMealCalendar] = useState(false);
  const storageKey = 'qs-finance-charts-v1/' + data.owner + '/' + data.space;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = JSON.parse(
          localStorage.getItem(storageKey) || 'null',
        ) as Partial<Preferences> | null;
        if (saved)
          setPrefs({
            slots: Array.isArray(saved.slots)
              ? saved.slots.filter((x) => typeof x === 'string').slice(0, 3)
              : [],
            mealCards:
              Array.isArray(saved.mealCards) && saved.mealCards.length === 4
                ? saved.mealCards.map((x, i) => ({
                    slot: slotNames[x.slot] ? x.slot : defaultMeals[i].slot,
                    level: ['area', 'venue', 'brand'].includes(x.level)
                      ? x.level
                      : 'area',
                  }))
                : defaultMeals,
            measure: saved.measure === 'money' ? 'money' : 'count',
          });
      } catch {
        /* Preference corruption never affects financial records. */
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [storageKey]);
  const changePrefs = (next: Preferences) => {
    setPrefs(next);
    if (loaded) localStorage.setItem(storageKey, JSON.stringify(next));
  };
  const invalid =
    preset === 'custom' &&
    (!custom.from ||
      !custom.to ||
      custom.from > custom.to ||
      Date.parse(custom.to) - Date.parse(custom.from) > 3660 * 86400000);
  const range = invalid
    ? chartMonthBounds(month)
    : preset === 'custom'
      ? { from: custom.from, to: shiftDay(custom.to, 1) }
      : chartPreset(preset, today(), month);
  const { from, to } = range;
  const stats = calculateFinanceStats(data, { from, to });
  const choices = data.categories.filter(
    (c) => !c.deleted && !c.archived && c.level < 3,
  );
  const defaults = ['L', 'H', 'E'].map(
    (code, i) =>
      choices.find((c) => c.code === code)?.id ||
      choices.filter((c) => c.level === 1)[i]?.id ||
      '',
  );
  const selected = [0, 1, 2].map((i) =>
    choices.some((c) => c.id === prefs.slots[i]) ? prefs.slots[i] : defaults[i],
  );
  return (
    <div className="f-chart-page">
      <div className="f-chart-toolbar">
        <nav className="f-segment" aria-label="图表主题">
          {(
            [
              ['structure', '消费结构'],
              ['trends', '趋势日历'],
              ['meals', '餐饮去向'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={theme === id}
              onClick={() => setTheme(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="f-chart-range">
          <select
            aria-label="图表日期范围"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {[
              ['month', '所选月份'],
              ['current', '本月'],
              ['7', '近7天'],
              ['30', '近30天'],
              ['m3', '近3个月'],
              ['m6', '近6个月'],
              ['m12', '近12个月'],
              ['custom', '自定义'],
            ].map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          {preset === 'custom' ? (
            <>
              <input
                aria-label="图表开始日期"
                type="date"
                value={custom.from}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })}
              />
              <span>—</span>
              <input
                aria-label="图表结束日期"
                type="date"
                value={custom.to}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })}
              />
            </>
          ) : (
            <span>
              {range.from} — {shiftDay(range.to, -1)}
            </span>
          )}
        </div>
      </div>
      {invalid && (
        <div className="f-error" role="alert">
          请选择有效的起止日期（最多十年）；当前仍显示所选月份。
        </div>
      )}
      {theme === 'structure' && (
        <div className="f-chart-workspace">
          <Panel title="主要用途" className="f-chart-main">
            <CategoryDonut
              data={data}
              stats={stats}
              mode={mode}
              onDrill={onDrill}
            />
          </Panel>
          <div className="f-chart-slots">
            {selected.map((id, i) => (
              <Panel
                key={i}
                title={'分类视图 ' + (i + 1)}
                className="f-chart-mini"
                action={
                  <select
                    aria-label={'小图' + (i + 1) + '分类'}
                    value={id}
                    onChange={(e) => {
                      const slots = [...selected];
                      slots[i] = e.target.value;
                      changePrefs({ ...prefs, slots });
                    }}
                  >
                    {choices.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.level === 2 ? '　' : ''}
                        {categoryLabel(c, 'both')}
                      </option>
                    ))}
                  </select>
                }
              >
                <CategoryDonut
                  key={id}
                  data={data}
                  stats={stats}
                  mode={mode}
                  base={id || null}
                  compact
                  onDrill={onDrill}
                />
              </Panel>
            ))}
          </div>
        </div>
      )}
      {theme === 'trends' && (
        <TrendCharts data={data} stats={stats} onDrill={onDrill} />
      )}
      {theme === 'meals' && (
        <>
          <div className="f-chart-subtoolbar">
            <div className="f-segment">
              <button
                aria-pressed={prefs.measure === 'count'}
                onClick={() => changePrefs({ ...prefs, measure: 'count' })}
              >
                按餐数
              </button>
              <button
                aria-pressed={prefs.measure === 'money'}
                onClick={() => changePrefs({ ...prefs, measure: 'money' })}
              >
                按本人金额
              </button>
            </div>
            <button onClick={() => setMealCalendar(!mealCalendar)}>
              <CalendarDays />
              {mealCalendar ? '返回占比' : '用餐日历'}
            </button>
            <small>仅统计已有记录 · 金额未知不会按零元计算</small>
          </div>
          {mealCalendar ? (
            <MealCalendar data={data} range={range} />
          ) : (
            <div className="f-chart-workspace">
              <MealChart
                data={data}
                range={range}
                config={prefs.mealCards[0]}
                measure={prefs.measure}
                main
                onChange={(config) =>
                  changePrefs({
                    ...prefs,
                    mealCards: prefs.mealCards.map((c, i) =>
                      i === 0 ? config : c,
                    ),
                  })
                }
              />
              <div className="f-chart-slots">
                {prefs.mealCards.slice(1).map((config, i) => (
                  <MealChart
                    key={i}
                    data={data}
                    range={range}
                    config={config}
                    measure={prefs.measure}
                    onChange={(next) =>
                      changePrefs({
                        ...prefs,
                        mealCards: prefs.mealCards.map((c, j) =>
                          j === i + 1 ? next : c,
                        ),
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MealChart({
  data,
  range,
  config,
  measure,
  onChange,
  main = false,
}: {
  data: FinanceState;
  range: ChartRange;
  config: MealCardConfig;
  measure: 'count' | 'money';
  onChange: (c: MealCardConfig) => void;
  main?: boolean;
}) {
  const { from, to } = range;
  const stats = useMemo(
    () =>
      calculateFinanceStats(data, {
        from,
        to,
        meal:
          config.slot === 'all'
            ? undefined
            : (config.slot as 'breakfast' | 'lunch' | 'dinner'),
      }),
    [data, from, to, config.slot],
  );
  const { groups, pending } = mealChartGroups(
      data,
      stats,
      config.slot,
      config.level,
      measure,
    ),
    total = groups.reduce((s, g) => s + g.cents, 0);
  return (
    <Panel
      title={main ? '用餐去向' : slotNames[config.slot]}
      className={main ? 'f-chart-main' : 'f-chart-mini'}
      action={
        <div className="f-meal-chart-controls">
          <select
            aria-label="图表餐次"
            value={config.slot}
            onChange={(e) => onChange({ ...config, slot: e.target.value })}
          >
            {Object.entries(slotNames).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          <select
            aria-label="图表地点层级"
            value={config.level}
            onChange={(e) =>
              onChange({
                ...config,
                level: e.target.value as MealCardConfig['level'],
              })
            }
          >
            <option value="area">区域</option>
            <option value="venue">具体餐厅</option>
            <option value="brand">餐厅 / 品牌</option>
          </select>
        </div>
      }
    >
      <Ring
        groups={groups}
        total={total}
        unit={measure === 'count' ? '餐数' : '金额'}
      />
      <div className="f-chart-foot">
        <span>
          {measure === 'count'
            ? '一餐只按主地点计一次'
            : '按实际商家汇总本人承担'}
        </span>
        <span>{pending ? pending + ' 餐结算待核对' : '已知记录'}</span>
      </div>
    </Panel>
  );
}

function Series({
  items,
  lines = false,
  onSelect,
}: {
  items: {
    date: string;
    cents: number;
    recorded: boolean;
    partial?: boolean;
  }[];
  lines?: boolean;
  onSelect?: (date: string) => void;
}) {
  const max = Math.max(1, ...items.map((d) => d.cents));
  const points = items
    .map((d, i) =>
      d.recorded
        ? `${i && items[i - 1].recorded ? 'L' : 'M'}${((i + 0.5) / items.length) * 1000},${100 - (d.cents / max) * 90}`
        : '',
    )
    .join(' ');
  return (
    <div className={'f-chart-series ' + (lines ? 'is-line' : '')}>
      <div className="f-series-scale">
        <span>{money(max)}</span>
        <span>¥0</span>
      </div>
      <div className="f-series-plot">
        <div
          className="f-series-inner"
          style={{
            minWidth: items.length > 62 ? items.length * 13 : undefined,
          }}
        >
          {lines && (
            <svg
              viewBox="0 0 1000 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d={points}
                fill="none"
                stroke="var(--f-accent)"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          {items.map((d, i) => (
            <button
              key={d.date}
              title={
                d.date +
                ' · ' +
                (d.recorded ? money(d.cents) : '无记录') +
                (d.partial ? ' · 部分月份' : '')
              }
              aria-label={
                d.date + ' ' + (d.recorded ? money(d.cents) : '无记录')
              }
              onClick={() => onSelect?.(d.date)}
              style={{ flex: '1 0 ' + (items.length > 62 ? '10px' : '0') }}
            >
              <span
                className="f-series-column"
                style={{
                  height:
                    Math.max(d.recorded ? 2 : 0, (d.cents / max) * 90) + '%',
                }}
              />
              {lines && d.recorded && (
                <i style={{ bottom: (d.cents / max) * 90 + '%' }} />
              )}
              <small>
                {items.length <= 12 || i % Math.ceil(items.length / 10) === 0
                  ? d.date.length === 7
                    ? d.date.slice(2)
                    : d.date.slice(5)
                  : ''}
                {d.partial ? '*' : ''}
              </small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TrendCharts({
  data,
  stats,
  onDrill,
}: {
  data: FinanceState;
  stats: FinanceStats;
  onDrill: (f: FinanceFilter) => void;
}) {
  const [dailyLine, setDailyLine] = useState(false),
    [monthlyLine, setMonthlyLine] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const days = useMemo(() => completeDays(data, stats), [data, stats]),
    months = monthSeries(days, stats, today()),
    max = Math.max(1, ...days.map((d) => d.cents));
  const records = selected
    ? data.transactions.filter(
        (t) =>
          !t.deleted &&
          t.kind === 'expense' &&
          chartDay(t.occurredAt) === selected,
      )
    : [];
  return (
    <div className="f-trend-layout">
      <Panel
        title="每日消费"
        className="f-trend-daily"
        action={
          <button className="f-text" onClick={() => setDailyLine(!dailyLine)}>
            <ChartNoAxesCombined />
            {dailyLine ? '切换柱状' : '切换折线'}
          </button>
        }
      >
        <Series items={days} lines={dailyLine} onSelect={setSelected} />
      </Panel>
      <Panel
        title="消费日历"
        className="f-trend-calendar"
        action={<span className="f-hint">浅 → 深 · 消费增加</span>}
      >
        <div className="f-heat-months">
          {months.map((m) => {
            const md = days.filter((d) => d.date.startsWith(m.date));
            const pad =
              (new Date(md[0].date + 'T00:00:00Z').getUTCDay() + 6) % 7;
            return (
              <section key={m.date}>
                <h3>{m.date}</h3>
                <div className="f-heat-grid">
                  {'一二三四五六日'.split('').map((d) => (
                    <small key={d}>{d}</small>
                  ))}
                  {Array.from({ length: pad }, (_, i) => (
                    <span key={'blank' + i} />
                  ))}
                  {md.map((d) => (
                    <button
                      key={d.date}
                      className={d.recorded ? 'is-recorded' : ''}
                      style={
                        d.recorded
                          ? {
                              background: `color-mix(in srgb, var(--f-accent) ${d.cents === 0 ? 8 : 15 + (65 * d.cents) / max}%, var(--f-panel))`,
                            }
                          : undefined
                      }
                      title={
                        d.date + ' ' + (d.recorded ? money(d.cents) : '无记录')
                      }
                      onClick={() => setSelected(d.date)}
                    >
                      <b>{Number(d.date.slice(8))}</b>
                      <small>
                        {d.recorded
                          ? d.cents === 0
                            ? '净额0'
                            : (d.cents / 100).toFixed(d.cents >= 10000 ? 0 : 1)
                          : '—'}
                      </small>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </Panel>
      <Panel
        title="月度消费对比"
        className="f-trend-monthly"
        action={
          <button
            className="f-text"
            onClick={() => setMonthlyLine(!monthlyLine)}
          >
            {monthlyLine ? '切换柱状' : '切换折线'}
          </button>
        }
      >
        <Series items={months} lines={monthlyLine} />
        <small className="f-hint">
          * 仅包含所选日期或尚未结束的月份；无记录不代表没有消费。
        </small>
      </Panel>
      {selected && (
        <Dialog
          title={selected + ' · 消费记录'}
          onClose={() => setSelected(null)}
        >
          <div className="f-dialog-body">
            <strong className="f-day-total">
              {days.find((d) => d.date === selected)?.recorded
                ? money(days.find((d) => d.date === selected)?.cents || 0)
                : '无记录'}
            </strong>
            <p className="f-hint">本人承担净额，关联退款回冲原消费日。</p>
            {records.map((t) => (
              <div className="f-day-row" key={t.id}>
                <span>{t.counterparty || '未注明商家'}</span>
                <b>{money(t.personalCents ?? t.amountCents)}</b>
              </div>
            ))}
          </div>
          <footer>
            <button
              onClick={() => {
                onDrill({
                  view: 'all',
                  id: selected,
                  name: selected,
                  range: { from: selected, to: shiftDay(selected, 1) },
                });
                setSelected(null);
              }}
            >
              查看流水
            </button>
            <button onClick={() => setSelected(null)}>关闭</button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}

function MealCalendar({
  data,
  range,
}: {
  data: FinanceState;
  range: ChartRange;
}) {
  const dates: string[] = [];
  for (let d = range.from; d < range.to; d = shiftDay(d, 1)) dates.push(d);
  return (
    <div className="f-meal-calendar-visual">
      <div className="f-meal-calendar-head">
        <b>日期</b>
        <b>早餐</b>
        <b>午餐</b>
        <b>晚餐</b>
      </div>
      <div className="f-meal-calendar-scroll">
        {dates.map((date) => (
          <div className="f-meal-calendar-row" key={date}>
            <b>{date.slice(5)}</b>
            {['breakfast', 'lunch', 'dinner'].map((slot) => {
              const meal = data.meals.find(
                (m) => !m.deleted && m.date === date && m.meal === slot,
              );
              return (
                <div
                  className={meal ? 'has-meal' : ''}
                  key={slot}
                  data-status={meal?.status}
                  data-tone={
                    meal && meal.status !== 'skipped'
                      ? mealPlaceTone(data.places, meal.placeId)
                      : undefined
                  }
                >
                  <span>
                    {meal?.status === 'skipped'
                      ? '未用餐'
                      : meal
                        ? data.places.find((p) => p.id === meal.placeId)
                            ?.name || '地点未知'
                        : '未记录'}
                  </span>
                  {meal && meal.status !== 'skipped' && (
                    <small>
                      {meal.pricePending
                        ? '金额待核对'
                        : meal.payment === 'unknown'
                          ? '结算待核对'
                          : meal.payment === 'invited'
                            ? '他人承担'
                            : '已记录'}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
