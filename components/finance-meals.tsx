'use client';
import { useEffect, useState } from 'react';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FinanceClient } from '@/lib/finance-client';
import type { FinanceMeal } from '@/lib/finance-types';
import {
  mealCompanionNames,
  mealPaymentNames,
  mealSocialGroups,
} from '@/lib/finance-meal-social';
import { calculateFinanceStats } from '@/lib/finance-stats';
import {
  groupMealPlaces,
  mealPlaceGroup,
  mealNetCents,
  mealPlaceTone,
  mealPlaceColor,
  type MealPlaceLevel,
} from '@/lib/finance-places';
import { Empty, Panel, Ring, bounds, money, today } from './finance-ui';
import { FinanceMealEditor } from './finance-meal-editor';
const meals = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as const;
const companions = mealCompanionNames;
const payments = mealPaymentNames;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10);
export function FinanceMeals({
  client,
  month,
  onMessage,
  openQuick,
  onQuickClose,
  onUnlinked,
}: {
  client: FinanceClient;
  month: string;
  onMessage: (m: string) => void;
  openQuick: boolean;
  onQuickClose: () => void;
  onUnlinked: (ids: string[], range: { from: string; to: string }) => void;
}) {
  const data = client.data!,
    [anchor, setAnchor] = useState(today()),
    [scope, setScope] = useState<'week' | 'month'>('week'),
    [filter, setFilter] = useState<keyof typeof meals | 'all'>('all'),
    [measure, setMeasure] = useState<'count' | 'money'>('count'),
    [placeLevel, setPlaceLevel] = useState<MealPlaceLevel>('area'),
    [editor, setEditor] = useState<{
      date: string;
      meal: FinanceMeal['meal'];
      existing?: FinanceMeal;
    }>(),
    [location, setLocation] = useState<string | null>(null);
  const weekday = (new Date(anchor + 'T00:00:00Z').getUTCDay() + 6) % 7,
    week = addDays(anchor, -weekday),
    range =
      scope === 'week' ? { from: week, to: addDays(week, 7) } : bounds(month);
  const stats = calculateFinanceStats(data, {
      ...range,
      meal: filter === 'all' ? undefined : filter,
    }),
    active = data.meals.filter(
      (m) =>
        !m.deleted &&
        m.date >= range.from &&
        m.date < range.to &&
        (filter === 'all' || m.meal === filter),
    );
  const social = mealSocialGroups(active);
  const days = Array.from(
    {
      length:
        scope === 'week'
          ? 7
          : (Date.parse(range.to) - Date.parse(range.from)) / 86400000,
    },
    (_, i) => addDays(range.from, i),
  );
  const placeRows = groupMealPlaces(
    data.places,
    stats.mealPlaces,
    active,
    placeLevel,
  );
  const groups = placeRows
      .map((p) => ({
        id: p.id,
        name: p.name,
        cents: measure === 'count' ? p.count : p.cents,
        color: mealPlaceColor(data.places, p.id),
      }))
      .filter((p) => measure !== 'count' || p.cents > 0)
      .sort((a, b) => b.cents - a.cents),
    sum = groups.reduce((s, g) => s + g.cents, 0);
  const open = (date: string, meal: FinanceMeal['meal']) =>
    setEditor({
      date,
      meal,
      existing: data.meals.find(
        (m) => !m.deleted && m.date === date && m.meal === meal,
      ),
    });
  const payFor = (m: FinanceMeal) => mealNetCents(data, m.id);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const hour = new Date(now + 8 * 3600000).getUTCHours(),
    suggestedMeal: FinanceMeal['meal'] =
      hour < 10 ? 'breakfast' : hour < 16 ? 'lunch' : 'dinner';
  const quick =
    openQuick && !editor
      ? {
          date: today(),
          meal: suggestedMeal,
          existing: data.meals.find(
            (m) => !m.deleted && m.date === today() && m.meal === suggestedMeal,
          ),
        }
      : undefined;
  return (
    <>
      <div className="f-section-toolbar">
        <div className="f-segment">
          <button
            aria-pressed={scope === 'week'}
            onClick={() => setScope('week')}
          >
            本周
          </button>
          <button
            aria-pressed={scope === 'month'}
            onClick={() => setScope('month')}
          >
            本月
          </button>
        </div>
        <div className="f-row">
          {scope === 'week' && (
            <>
              <button
                className="f-icon"
                aria-label="上一周"
                onClick={() => setAnchor(addDays(anchor, -7))}
              >
                <ChevronLeft />
              </button>
              <span>
                {range.from.slice(5)} — {addDays(range.to, -1).slice(5)}
              </span>
              <button
                className="f-icon"
                aria-label="下一周"
                onClick={() => setAnchor(addDays(anchor, 7))}
              >
                <ChevronRight />
              </button>
              <button className="f-text" onClick={() => setAnchor(today())}>
                回到本周
              </button>
            </>
          )}
        </div>
        <div className="f-segment">
          {(['all', 'breakfast', 'lunch', 'dinner'] as const).map((k) => (
            <button
              key={k}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {k === 'all' ? '三餐' : meals[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="f-meals-layout">
        <Panel
          className="f-meal-calendar-panel"
          title="每一餐"
          action={
            <span className="f-hint">点击记录或编辑 · 空白表示未记录</span>
          }
        >
          <section
            className="f-meal-grid"
            aria-label="每日餐饮记录"
            // Keyboard users need to focus this independently scrolling region.
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
          >
            <div className="f-meal-grid-head">
              <span>日期</span>
              {Object.entries(meals)
                .filter(([k]) => filter === 'all' || k === filter)
                .map(([k, v]) => (
                  <span key={k}>{v}</span>
                ))}
            </div>
            {days.map((date) => (
              <div
                className={'f-meal-day ' + (date === today() ? 'is-today' : '')}
                key={date}
              >
                <div className="f-day-label">
                  <strong>{date.slice(8)}</strong>
                  <small>
                    {
                      ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
                        new Date(date + 'T00:00:00Z').getUTCDay()
                      ]
                    }
                  </small>
                </div>
                {(Object.keys(meals) as FinanceMeal['meal'][])
                  .filter((k) => filter === 'all' || k === filter)
                  .map((k) => {
                    const m = active.find(
                        (m) => m.date === date && m.meal === k,
                      ),
                      p = m
                        ? data.places.find((p) => p.id === m.placeId)
                        : undefined;
                    return (
                      <div
                        key={k}
                        className={'f-meal-cell ' + (m ? 'has-meal' : '')}
                        data-tone={
                          m && m.status !== 'skipped'
                            ? mealPlaceTone(data.places, m.placeId)
                            : undefined
                        }
                        data-status={m?.status || (m ? 'eaten' : 'empty')}
                      >
                        <button
                          onClick={() => open(date, k)}
                          title={
                            m?.status === 'skipped'
                              ? '未用餐 · 点击修改'
                              : p?.name || '未记录 · 点击添加'
                          }
                          aria-label={
                            date +
                            ' ' +
                            meals[k] +
                            (m?.status === 'skipped'
                              ? ' 未用餐'
                              : p
                                ? ' ' + p.name
                                : ' 未记录，添加')
                          }
                          disabled={
                            !!location &&
                            mealPlaceGroup(
                              data.places,
                              m?.placeId || '',
                              placeLevel,
                            ).id !== location
                          }
                        >
                          {m?.status === 'skipped' ? (
                            <>
                              <b>未用餐</b>
                              <small>已明确记录 · 点击修改</small>
                            </>
                          ) : m ? (
                            <>
                              <b>{p?.name || '未命名地点'}</b>
                              <span>
                                {m.pricePending
                                  ? '金额待补'
                                  : payFor(m) === 0
                                    ? '本人 ¥0.00'
                                    : money(payFor(m))}
                              </span>
                              <small>
                                {companions[m.companions]} ·{' '}
                                {payments[m.payment]}
                              </small>
                            </>
                          ) : (
                            <>
                              <Plus />
                              <small>未记录</small>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
              </div>
            ))}
          </section>
        </Panel>
        <section
          className="f-side-stack f-meal-insights"
          aria-label="餐饮统计"
          // Keyboard users need to focus this independently scrolling region.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          <Panel
            title="吃在哪里"
            action={
              <div className="f-segment">
                <button
                  aria-pressed={measure === 'count'}
                  onClick={() => setMeasure('count')}
                >
                  餐数
                </button>
                <button
                  aria-pressed={measure === 'money'}
                  onClick={() => setMeasure('money')}
                >
                  金额
                </button>
              </div>
            }
          >
            <div className="f-ring-tools">
              <select
                aria-label="地点统计层级"
                value={placeLevel}
                onChange={(e) => {
                  setPlaceLevel(e.target.value as MealPlaceLevel);
                  setLocation(null);
                }}
              >
                <option value="area">地点合计</option>
                <option value="floor">分楼层 / 区域</option>
                <option value="venue">具体餐厅</option>
              </select>
            </div>
            {groups.length ? (
              <Ring
                groups={groups}
                total={sum}
                unit={measure === 'count' ? '餐数' : '金额'}
                onSelect={(id) => setLocation(location === id ? null : id)}
              />
            ) : (
              <Empty title="记下一餐后就有分布" />
            )}
            {location && (
              <button className="f-text" onClick={() => setLocation(null)}>
                清除地点筛选
              </button>
            )}
            <p className="f-hint">
              {stats.mealCount} 餐 ·{' '}
              {
                new Set(
                  active
                    .filter((m) => m.status !== 'skipped')
                    .map((m) => m.date),
                ).size
              }{' '}
              天 · {stats.pendingMealCount} 餐金额待补 · 未用餐{' '}
              {stats.skippedMealCount} 次
            </p>
          </Panel>
          <Panel title="地点小计">
            {stats.unlinkedMealTransactionIds.length > 0 && (
              <div className="f-unlinked-meals">
                <b>含未关联餐次消费 {money(stats.unlinkedMealCents)}</b>
                <span>这些消费计入地点金额，不增加餐数或用餐天数。</span>
                <button
                  className="f-text"
                  onClick={() =>
                    onUnlinked(stats.unlinkedMealTransactionIds, range)
                  }
                >
                  查看 {stats.unlinkedMealTransactionIds.length} 笔流水 →
                </button>
              </div>
            )}
            <div className="f-place-summary">
              <div>
                <span>地点</span>
                <span>餐 / 天</span>
                <span>本人消费</span>
              </div>
              {placeRows.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setLocation(location === p.id ? null : p.id)}
                >
                  <b>{p.name}</b>
                  <span>
                    {p.count} / {p.days}
                  </span>
                  <strong>{money(p.cents)}</strong>
                </button>
              ))}
            </div>
            <p className="f-hint">
              天数按地点独立去重；一天去多个地方会分别出现，不能相加。
            </p>
          </Panel>
          <Panel title="和谁吃">
            <Ring groups={social.companions} total={social.total} unit="餐数" />
            <p className="f-hint">
              按已记录用餐餐数统计，含同伴未注明；未用餐不计入。旧朋友记录计入朋友[其他]，可逐餐改为
              F 或 L。
            </p>
          </Panel>
          <Panel title="怎么结算">
            <Ring groups={social.payments} total={social.total} unit="餐数" />
            <p className="f-hint">
              自付、AA、我请客、别人请客分别统计；结算待核对独立显示。“独自吃”属于同伴分类。
            </p>
          </Panel>
        </section>
      </div>
      {(editor || quick) && (
        <FinanceMealEditor
          client={client}
          initial={(editor || quick)!}
          onClose={() => {
            setEditor(undefined);
            onQuickClose();
          }}
          onSaved={onMessage}
        />
      )}
    </>
  );
}
