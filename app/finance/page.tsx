'use client';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LayoutGrid,
  List,
  Plus,
  Redo2,
  RefreshCw,
  Sun,
  Moon,
  Undo2,
  Utensils,
  Wallet,
  X,
} from 'lucide-react';
import { FinanceCharts } from '@/components/finance-charts';
import type { CategoryLabelMode } from '@/lib/finance-category-codes';
import { BoardSwitch } from '@/components/board-switch';
import { FinanceClient } from '@/lib/finance-client';
import type {
  FinanceMutation,
  FinanceSpace,
  FinanceTransaction,
  FinanceKind,
} from '@/lib/finance-types';
import { Dialog, kinds, shiftMonth, today } from '@/components/finance-ui';
import { FinanceTransactionEditor } from '@/components/finance-transaction-editor';
import { FinanceImportPanel } from '@/components/finance-import-panel';
import { FinanceMeals } from '@/components/finance-meals';
import { FinanceAccounts } from '@/components/finance-accounts';
import {
  FinanceOverview,
  type FinanceFilter,
} from '@/components/finance-overview';
import { FinanceTransactions } from '@/components/finance-transactions';
import { FinanceConflictReview } from '@/components/finance-conflict-review';
import './finance.css';
import './charts.css';

type Tab = 'charts' | 'overview' | 'meals' | 'transactions' | 'accounts';
const tabs = [
  { id: 'overview', label: '总览', icon: LayoutGrid },
  { id: 'charts', label: '图表', icon: LayoutGrid },
  { id: 'meals', label: '餐饮', icon: Utensils },
  { id: 'transactions', label: '流水', icon: List },
  { id: 'accounts', label: '账户与往来', icon: Wallet },
] as const;
export default function FinancePage() {
  const [ready, setReady] = useState(false),
    [space, setSpace] = useState<FinanceSpace>('personal'),
    [theme, setTheme] = useState<'light' | 'dark'>('light'),
    [client, setClient] = useState<FinanceClient>(),
    [, redraw] = useState(0),
    [tab, setTab] = useState<Tab>('overview'),
    [labelMode, setLabelMode] = useState<CategoryLabelMode>('both'),
    [month, setMonth] = useState(today().slice(0, 7)),
    [newKind, setNewKind] = useState<FinanceKind>('expense'),
    [edit, setEdit] = useState<FinanceTransaction | 'new'>(),
    [importing, setImporting] = useState(false),
    [quick, setQuick] = useState(false),
    [message, setMessage] = useState(''),
    [pendingOpen, setPendingOpen] = useState(false),
    [filter, setFilter] = useState<FinanceFilter>(),
    [reviewId, setReviewId] = useState<string>();
  useEffect(() => {
    // Hydrate browser-only preferences after matching the server shell.
    // oxlint-disable-next-line react/react-compiler
    setTheme(
      localStorage.getItem('qs-finance-theme') === 'dark' ? 'dark' : 'light',
    );
    setSpace(
      localStorage.getItem('qs-selected-space') === 'demo'
        ? 'demo'
        : 'personal',
    );
    const mode = localStorage.getItem('qs-finance-label-mode');
    if (mode === 'text' || mode === 'code' || mode === 'both')
      setLabelMode(mode);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const c = new FinanceClient(space, () => redraw((n) => n + 1));
    // The external store has a lifecycle tied to the selected ledger.
    // oxlint-disable-next-line react/react-compiler
    setClient(c);
    void c.start();
    return () => c.stop();
  }, [ready, space]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(''), 4500);
    return () => clearTimeout(id);
  }, [message]);
  const data = client?.data,
    undo = data?.history.filter((h) => !h.undone).at(-1),
    redo = data?.history.find((h) => h.undone && !h.redoInvalidated);
  const action = async (m: FinanceMutation) => {
    try {
      const r = await client?.enqueue(m);
      setMessage(r?.message || '');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const drill = (f: FinanceFilter) => {
    setFilter(f);
    setTab('transactions');
  };
  return (
    <main className="finance-app" data-theme={theme}>
      <header className="f-header">
        <div className="f-brand">
          <h1>丘山流调</h1>
          <BoardSwitch current="finance" space={space} />
        </div>
        <nav className="f-tabs" aria-label="生活账本页签">
          {tabs.map((t) => (
            <button
              key={t.id}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => {
                setTab(t.id);
                setFilter(undefined);
              }}
            >
              <t.icon />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="f-header-end">
          <button
            className={'f-sync ' + (client?.pending.length ? 'has-issue' : '')}
            title={client?.message}
            onClick={() => {
              if (client?.pending.length) setPendingOpen(true);
              else void client?.sync();
            }}
          >
            <i />
            {client?.pending.length
              ? `${client.pending.length} 笔待同步`
              : client?.message.startsWith('已同步')
                ? '已同步'
                : '连接状态'}
          </button>
          <button
            className="f-icon"
            title={theme === 'light' ? '切换深色' : '切换浅色'}
            onClick={() => {
              const next = theme === 'light' ? 'dark' : 'light';
              setTheme(next);
              localStorage.setItem('qs-finance-theme', next);
            }}
          >
            {theme === 'light' ? <Moon /> : <Sun />}
          </button>
          <select
            aria-label="账本空间"
            value={space}
            onChange={(e) => {
              const next = e.target.value as FinanceSpace;
              setSpace(next);
              localStorage.setItem('qs-selected-space', next);
              setEdit(undefined);
              setImporting(false);
              setQuick(false);
            }}
          >
            <option value="personal">个人</option>
            <option value="demo">演示</option>
          </select>
        </div>
      </header>
      <div className="f-pagebar">
        <div className="f-page-title">
          <h2>{tabs.find((t) => t.id === tab)?.label}</h2>
          <span>
            {space === 'demo'
              ? '演示账本 · 与个人账本隔离'
              : tab === 'overview'
                ? '自己的消费，清楚有据'
                : tab === 'meals'
                  ? '记住每顿饭，也看见日常'
                  : tab === 'transactions'
                    ? '每一笔都能找到来处'
                    : '账户、往来与私有配置'}
          </span>
        </div>
        <div className="f-page-actions">
          <select
            className="f-label-mode"
            aria-label="分类显示方式"
            value={labelMode}
            onChange={(e) => {
              setLabelMode(e.target.value as CategoryLabelMode);
              localStorage.setItem('qs-finance-label-mode', e.target.value);
            }}
          >
            <option value="both">代码＋文字</option>
            <option value="text">文字</option>
            <option value="code">代码</option>
          </select>
          <div className="f-month">
            <button
              className="f-icon"
              aria-label="上个月"
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <ArrowLeft />
            </button>
            <input
              aria-label="统计月份"
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
            <button
              className="f-icon"
              aria-label="下个月"
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <ArrowRight />
            </button>
          </div>
          {client && client.reviewCount > 0 && (
            <button
              onClick={() => setImporting(true)}
              className="f-review-entry"
            >
              账单核对 · {client.reviewCount}
            </button>
          )}
          <span className="f-action-divider" />
          <button
            className="f-icon"
            title={undo ? '撤销：' + undo.label : '暂无可撤销修改'}
            aria-label="撤销"
            disabled={!undo || !!client?.pending.length}
            onClick={() =>
              undo && void action({ type: 'undo', historyId: undo.id })
            }
          >
            <Undo2 />
          </button>
          <button
            className="f-icon"
            title={redo ? '恢复：' + redo.label : '暂无可恢复修改'}
            aria-label="恢复"
            disabled={!redo || !!client?.pending.length}
            onClick={() =>
              redo && void action({ type: 'redo', historyId: redo.id })
            }
          >
            <Redo2 />
          </button>
          <button
            onClick={() => {
              setTab('meals');
              setQuick(true);
            }}
            disabled={!data}
          >
            <Utensils />
            记一餐
          </button>
          <button
            className="f-primary"
            disabled={!data}
            onClick={() => {
              setNewKind('expense');
              setEdit('new');
            }}
          >
            <Plus />
            记一笔
          </button>
        </div>
      </div>
      {client?.blocked && (
        <div className="f-error" role="alert">
          {client.message}{' '}
          <button
            type="button"
            onClick={() => window.location.assign('/login?next=/finance')}
          >
            重新登录
          </button>
        </div>
      )}
      {!data ? (
        <output className="f-loading">
          {client?.message || '正在载入生活账本…'}
        </output>
      ) : (
        <div className={'f-content f-content-' + tab}>
          {tab === 'overview' && (
            <FinanceOverview
              data={data}
              mode={labelMode}
              month={month}
              onDrill={drill}
              onSetup={() => setTab('accounts')}
              onImport={() => setImporting(true)}
            />
          )}
          {tab === 'charts' && (
            <FinanceCharts
              data={data}
              month={month}
              mode={labelMode}
              onDrill={drill}
            />
          )}
          {tab === 'meals' && (
            <FinanceMeals
              client={client!}
              month={month}
              onMessage={setMessage}
              openQuick={quick}
              onQuickClose={() => setQuick(false)}
            />
          )}
          {tab === 'transactions' && (
            <FinanceTransactions
              client={client!}
              month={month}
              filter={filter}
              onClear={() => setFilter(undefined)}
              onEdit={(t) => {
                setNewKind('expense');
                setEdit(t);
              }}
              onImport={() => setImporting(true)}
              onMessage={setMessage}
            />
          )}
          {tab === 'accounts' && (
            <FinanceAccounts
              client={client!}
              onMessage={setMessage}
              onOpening={() => {
                setNewKind('openingReceivable');
                setEdit('new');
              }}
            />
          )}
        </div>
      )}
      {message && (
        <output className="f-toast">
          <Check />
          <span>{message}</span>
          <button
            className="f-icon"
            aria-label="关闭消息"
            onClick={() => setMessage('')}
          >
            <X />
          </button>
        </output>
      )}
      {client && edit && (
        <FinanceTransactionEditor
          client={client}
          defaultKind={newKind}
          transaction={edit === 'new' ? undefined : edit}
          onClose={() => setEdit(undefined)}
          onSaved={setMessage}
        />
      )}
      {client && importing && (
        <FinanceImportPanel
          client={client}
          onClose={() => setImporting(false)}
        />
      )}
      {pendingOpen && client && (
        <Dialog title="待同步与待核对" onClose={() => setPendingOpen(false)}>
          <div className="f-dialog-body">
            <p className="f-hint">{client.message}</p>
            {client.pending.map((p) => (
              <div className="f-pending" key={p.operationId}>
                <b>
                  {p.mutation.type === 'saveTransaction'
                    ? kinds[p.mutation.transaction.kind]
                    : '账本修改'}
                </b>
                <p>{p.error || '已保存到本机，等待同步'}</p>
                {p.state !== 'queued' && (
                  <div className="f-row">
                    <button
                      onClick={() => void client.resolve(p.operationId, false)}
                    >
                      留存草稿并移出队列
                    </button>
                    <button
                      onClick={() => {
                        setReviewId(p.operationId);
                      }}
                    >
                      核对后重试
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <footer>
            <button className="f-primary" onClick={() => void client.sync()}>
              <RefreshCw />
              立即同步
            </button>
          </footer>
        </Dialog>
      )}
      {reviewId && client?.pending.find((p) => p.operationId === reviewId) && (
        <FinanceConflictReview
          client={client}
          pending={client.pending.find((p) => p.operationId === reviewId)!}
          onClose={() => setReviewId(undefined)}
        />
      )}
    </main>
  );
}
