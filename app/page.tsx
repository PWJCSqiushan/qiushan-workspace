'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BoardSwitch } from '@/components/board-switch';
import {
  Mountain,
  Plus,
  Columns3,
  ListOrdered,
  Search,
  Database,
  Download,
  Flag,
  Trash2,
  History,
  Settings2,
  RefreshCw,
  Upload,
  Check,
  Tags,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { TaskCard } from '@/components/task-card';
import { FlowLane } from '@/components/flow-lane';
import { TaskEditor } from '@/components/task-editor';
import { CategoryManager } from '@/components/category-manager';
import { AnalyticsDashboard } from '@/components/analytics-dashboard';
import './analytics.css';
import type { Category } from '@/lib/categories';
import {
  FLOWS,
  Task,
  newTask,
  globalSort,
  groupOf,
  GROUP_NAMES,
  matches,
  doneToday,
  stampMs,
  today,
} from '@/lib/domain';
import type { Workspace } from '@/lib/workspace';
import {
  SyncEngine,
  api,
  type EngineState,
  type DraftRecord,
} from '@/lib/client-sync';
import { sha256 } from '@/lib/protocol';
import { ConflictPanel } from '@/components/conflict-panel';
type View = 'board' | 'global' | 'history' | 'trash' | 'analytics';
export default function Home() {
  const [space, setSpace] = useState<'personal' | 'demo'>('personal');
  const [data, setData] = useState<Workspace | null>(null);
  const [view, setView] = useState<View>('board');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Task | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('正在连接工作台');
  const [settings, setSettings] = useState(false);
  const [importData, setImportData] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [now, setNow] = useState(new Date());
  const [undo, setUndo] = useState<{ id: string; kind: string } | null>(null);
  const [categoryManagerFlow, setCategoryManagerFlow] = useState<string | null>(
    null,
  );
  const current = useRef(data);
  current.current = data;
  const currentSpace = useRef(space);
  currentSpace.current = space;
  const fileInput = useRef<HTMLInputElement>(null);
  const engine = useRef<SyncEngine | null>(null);
  const [syncState, setSyncState] = useState<EngineState | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<DraftRecord[]>([]);
  const [editorBase, setEditorBase] = useState<Task | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [cloudBackups, setCloudBackups] = useState<any[]>([]);
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const e = new SyncEngine();
    const selectedSpace = localStorage.getItem('qs-selected-space');
    if (selectedSpace === 'demo') { e.space = 'demo'; setSpace('demo'); }
    engine.current = e;
    e.start((s) => {
      setSyncState(s);
      setData(s.workspace);
      if (!s.workspace) {
        setEditor(null);
        setSavedDrafts([]);
        setSettings(false);
      }
      setMessage(s.message);
      setError(s.error);
      setNow(new Date(Date.now() + s.clockOffset));
    })
      .then(() =>
        e.session && e.display() ? e.drafts().then(setSavedDrafts) : undefined,
      )
      .catch((err) => setError(err.message));
    const refresh = () => {
      if (!document.hidden) void e.refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    if (
      'serviceWorker' in navigator &&
      process.env.NODE_ENV === 'production' &&
      (location.protocol === 'https:' ||
        ['localhost', '127.0.0.1'].includes(location.hostname))
    ) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((r) => {
          const cacheResources = () =>
            navigator.serviceWorker.controller?.postMessage({
              type: 'CACHE_APP',
              urls: performance.getEntriesByType('resource').map((x) => x.name),
            });
          void navigator.serviceWorker.ready.then(cacheResources);
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            cacheResources,
          );
          if (r.waiting && navigator.serviceWorker.controller)
            setUpdateReady(true);
          r.addEventListener('updatefound', () =>
            r.installing?.addEventListener('statechange', () => {
              if (r.waiting && navigator.serviceWorker.controller)
                setUpdateReady(true);
            }),
          );
        })
        .catch(() => setError('离线资源未准备好，下次登录后可重试'));
    }
    return () => {
      e.stop();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => {
    const tick = () =>
      setNow(new Date(Date.now() + (engine.current?.clockOffset || 0)));
    const clock = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(clock);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  const reload = useCallback(async () => engine.current!.refresh(), []);
  async function chooseSpace(next: 'personal' | 'demo') {
    if (editor || busy) return;
    setSpace(next);
    localStorage.setItem('qs-selected-space', next);
    setFilter('all');
    setUndo(null);
    setImportData(null);
    setSearch('');
    setView('board');
    await engine.current!.switchSpace(next);
    setSavedDrafts(await engine.current!.drafts());
  }
  const mutate = useCallback(
    async (operation: any, _revision?: number, baseTask?: Task) => {
      setBusy(true);
      try {
        return await engine.current!.enqueue(operation, baseTask);
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  async function quick(op: any) {
    try {
      const task = current.current?.tasks.find((t) => t.id === op.id);
      await mutate(op);
      if (op.kind === 'complete' && task && !task.daily)
        setUndo({ id: op.id, kind: 'reopen' });
      if (op.kind === 'delete') setUndo({ id: op.id, kind: 'restore' });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function open(t: Task, baseTask?: Task) {
    setEditorBase(structuredClone(baseTask || t));
    setEditor(structuredClone(t));
    setEditorKey((k) => k + 1);
  }
  function create(flow = 'study') {
    open(newTask(flow));
  }
  function copy(t: Task) {
    const source = t as Task & { categoryId?: string };
    const sourceCategory = categories.find(
      (category) =>
        category.id === source.categoryId &&
        category.flow === source.flow &&
        !category.archived,
    );
    const clone = {
      ...structuredClone(t),
      id: crypto.randomUUID(),
      version: 0,
      title: t.title + '（副本）',
      status: '准备推进',
      completions: [],
      deletedAt: null,
      boostAt: '',
      boostDate: '',
      categoryId: sourceCategory?.id || '',
    };
    open(clone);
  }
  useEffect(() => {
    const mc = (document as any).modelContext;
    if (!mc?.registerTool) return;
    const life = new AbortController();
    const register = (t: any) =>
      Promise.resolve(mc.registerTool(t, { signal: life.signal })).catch(
        () => {},
      );
    void register({
      name: 'list_workspace_tasks',
      title: '读取工作台事项',
      description: '读取当前正式或演示工作区内的事项。',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({
        space: currentSpace.current,
        revision: current.current?.revision,
        tasks: current.current?.tasks || [],
      }),
    });
    void register({
      name: 'create_workspace_task',
      title: '创建工作台事项',
      description: '在当前工作区创建事项并保存到本地。',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          flow: { type: 'string', enum: FLOWS.map((f) => f.id) },
        },
        required: ['title', 'flow'],
        additionalProperties: false,
      },
      execute: async (input: any) => {
        if (
          typeof input?.title !== 'string' ||
          !input.title.trim() ||
          !FLOWS.some((f) => f.id === input.flow)
        )
          throw new Error('名称或工作流无效');
        const t = { ...newTask(input.flow), title: input.title };
        const w = await mutate({ kind: 'save', task: t });
        return { id: t.id, revision: w.revision };
      },
    });
    return () => life.abort();
  }, [mutate]);
  const tasks = data?.tasks || [];
  const active = tasks.filter((t) => !t.deletedAt && t.status !== '已结束');
  const pending = active.filter((t) => !doneToday(t, today(now)));
  const dueWeek = (t: Task) =>
    Number.isFinite(stampMs(t.due)) &&
    stampMs(t.due) >= +now &&
    stampMs(t.due) < +now + 7 * 86400000;
  const filled = pending.filter((t) => t.minutes !== null);
  const minutes = filled.reduce((s, t) => s + (t.minutes ?? 0), 0);
  const time =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? (minutes % 60) + 'm' : ''}`
      : `${minutes}m`;
  const source =
    view === 'trash'
      ? tasks.filter((t) => t.deletedAt)
      : view === 'history'
        ? tasks.filter((t) => !t.deletedAt && t.status === '已结束')
        : active;
  const filtered = source.filter((t) => {
    const q = search.toLowerCase();
    const hit = [t.title, t.project, t.location, t.notes, t.stage].some((v) =>
      v.toLowerCase().includes(q),
    );
    return (
      hit &&
      (filter === 'em'
        ? t.emergency
        : filter === 'progress'
          ? t.status === '正在推进' && !doneToday(t, today(now))
          : filter === 'dueWeek'
            ? dueWeek(t)
            : filter === 'estimated'
              ? t.minutes !== null && !doneToday(t, today(now))
              : matches(t, filter, now))
    );
  });
  const stats = [
    {
      value: String(pending.length),
      label: '当前未完成',
      note: '九条工作流',
      key: 'all',
    },
    {
      value: String(pending.filter((t) => t.emergency).length),
      label: '紧急事项',
      note: '手动标注 EM',
      key: 'em',
    },
    {
      value: String(pending.filter((t) => t.status === '正在推进').length),
      label: '正在推进',
      note: '明确下一步',
      key: 'progress',
    },
    {
      value: String(pending.filter(dueWeek).length),
      label: '七天内截止',
      note: '临期只作提示',
      key: 'dueWeek',
    },
    {
      value: time,
      label: '已填写预计用时',
      note: `${filled.length} / ${pending.length} 项填写 · 缺失未计入`,
      key: 'estimated',
    },
  ];
  function changeView(v: View) {
    setView(v);
    setFilter('all');
    setSearch('');
  }
  function download(w: any, name: string) {
    const blob = new Blob([JSON.stringify(w, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function exportBackup() {
    try {
      await reload();
      const w = await api('/api/export?space=' + space);
      download(
        { ...w, exportedAt: new Date().toISOString() },
        `丘山工作台-${space}-${today()}.json`,
      );
      setMessage('备份已导出');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function readFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 4000000) throw new Error('备份文件请控制在 4 MB 内');
      const parsed = JSON.parse(await file.text());
      const w = parsed.workspace || parsed;
      if (parsed.sha256 && (await sha256(w)) !== parsed.sha256)
        throw new Error('备份哈希校验失败');
      if (w.schemaVersion !== 1 || !Array.isArray(w.tasks))
        throw new Error('不是有效的工作台备份');
      setImportData(w);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function restoreBackup(kind: 'migration' | 'restore' = 'restore') {
    try {
      if (engine.current!.queue.length)
        throw new Error('请先处理待同步操作，再恢复备份');
      const preview = await api('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          kind,
          space,
          workspace: importData,
        }),
      });
      if (
        !confirm(
          (kind === 'migration' ? '将无损迁移 ' : '将恢复 ') +
            preview.taskCount +
            ' 张卡片，当前数据会先保存快照。' +
            (preview.coordinationChanges?.length
              ? '编号将收拢：' +
                preview.coordinationChanges
                  .map((t: any) => t.title + ' ' + t.from + '→' + t.to)
                  .join('；')
              : '') +
            '确认恢复？',
        )
      )
        return;
      await api('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'commit',
          kind,
          space,
          workspace: importData,
          sourceHash: preview.sourceHash,
          expectedRevision: preview.expectedRevision,
          runId: crypto.randomUUID(),
          confirm: true,
        }),
      });
      await reload();
      setImportData(null);
      setMessage('备份已恢复 · 恢复前数据已留存快照');
      await loadSnapshots();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function loadSnapshots() {
    try {
      const res = await fetch('/api/backups?space=' + space);
      if (!res.ok) throw new Error('无法读取快照');
      setSnapshots(await res.json());
      setCloudBackups(await api('/api/backup-status?space=' + space));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function enableQueue() {
    try {
      if (engine.current!.queue.length)
        throw new Error('请先同步或处理本机操作');
      const preview = await api('/api/coordination?space=' + space);
      if (
        !confirm(
          '启用连续编号：' +
            preview.changes
              .map(
                (t: any) =>
                  t.title + ' ' + (t.from ?? '空') + '→' + (t.to ?? '空'),
              )
              .join('；') +
            '。调整前将自动保留快照。',
        )
      )
        return;
      await api('/api/coordination', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space,
          expectedRevision: preview.expectedRevision,
          confirm: true,
        }),
      });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const categories = ((
    data?.settings as
      | (Workspace['settings'] & { categories?: Category[] })
      | undefined
  )?.categories || []) as Category[];
  const coordinationReady = (
    data as (Workspace & { coordinationReady?: boolean }) | null
  )?.coordinationReady;
  const showCategoryPreview =
    Boolean(syncState?.session?.local);
  const importHasNoCategoryFields = Boolean(
    importData?.tasks?.length &&
    importData.tasks.every(
      (task: Task) => !Object.prototype.hasOwnProperty.call(task, 'categoryId'),
    ),
  );
  const flowCount = (id: string) =>
    filtered.filter((t) => t.flow === id && !doneToday(t, today(now))).length;
  return (
    <main
      className={
        'shell ' +
        (desktop ? 'force-desktop ' : 'mobile-default ') +
        (data?.settings.density === 'comfortable' ? 'comfortable' : '')
      }
    >
      <header className="masthead">
        <div className="identity">
          <div className="logo">
            <Mountain />
          </div>
          <div>
            <h1>丘山 · 个人工作台<BoardSwitch current="workflow" space={space}/></h1>
            <div className="eyebrow">QIUSHAN / PERSONAL WORKSPACE</div>
          </div>
        </div>
        <div className="head-actions">
          <output className="saved">
            <i className="dot" />
            {message}
          </output>
          <div className="space-switch">
            <button
              className={space === 'personal' ? 'selected' : ''}
              disabled={!data || !!editor || busy}
              title={editor ? '关闭编辑面板后可切换' : ''}
              onClick={() => void chooseSpace('personal')}
            >
              正式
            </button>
            <button
              className={space === 'demo' ? 'selected demo' : ''}
              disabled={!data || !!editor || busy}
              title={editor ? '关闭编辑面板后可切换' : ''}
              onClick={() => void chooseSpace('demo')}
            >
              演示
            </button>
          </div>
          <Button
            className="btn"
            onClick={() => {
              setSettings(true);
              void loadSnapshots();
            }}
          >
            <Settings2 />
            数据与设置
          </Button>
          <Button
            className="btn primary"
            disabled={!data || busy}
            onClick={() => create()}
          >
            <Plus />
            新增事项
          </Button>
        </div>
      </header>
      {data && coordinationReady === false && (
        <div className="notice">
          <span>连续编号尚未启用，请先核对调整预览。</span>
          <button className="btn" onClick={() => void enableQueue()}>
            预览并启用编号规则
          </button>
        </div>
      )}
      <section className="stats">
        {stats.map((s) => (
          <button
            className="stat"
            key={s.label}
            onClick={() => {
              setView('board');
              setFilter(s.key);
              setSearch('');
            }}
          >
            <span className="stat-value">{data ? s.value : '—'}</span>
            <div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-note">{s.note}</div>
            </div>
          </button>
        ))}
      </section>
      <div className="toolbar">
        <div className="segments">
          <button
            className={view === 'board' ? 'selected' : ''}
            onClick={() => changeView('board')}
          >
            <Columns3 />
            工作流总览
          </button>
          <button
            className={view === 'global' ? 'selected' : ''}
            onClick={() => changeView('global')}
          >
            <ListOrdered />
            全局协调
          </button>
          <button
            className={view === 'analytics' ? 'selected' : ''}
            onClick={() => changeView('analytics')}
          >
            统计总览
          </button>
          <button
            className={view === 'history' ? 'selected' : ''}
            onClick={() => changeView('history')}
          >
            <History />
            历史
          </button>
          <button
            className={view === 'trash' ? 'selected' : ''}
            onClick={() => changeView('trash')}
          >
            <Trash2 />
            回收站
          </button>
        </div>
        <div className="filters">
          <div className="search">
            <Search />
            <input
              aria-label="搜索事项"
              placeholder="搜索事项、地点或项目"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {[
            ['all', '全部'],
            ['today', '今天'],
            ['week', '七天内'],
            ['overdue', '逾期'],
            ['flag', '旗标'],
          ].map(([v, l]) => (
            <button
              className={'filter ' + (filter === v ? 'on' : '')}
              key={v}
              onClick={() => setFilter(v)}
            >
              {v === 'flag' && <Flag size={12} />} {l}
            </button>
          ))}
          <button
            className="refresh-button"
            aria-label="刷新数据"
            onClick={() =>
              reload()
                .then(() => {
                  setError('');
                  setMessage('已刷新');
                })
                .catch((e) => setError(e.message))
            }
          >
            <RefreshCw />
          </button>
        </div>
      </div>
      <div className="mobile-layout-switch">
        <button className="btn" onClick={() => setDesktop(!desktop)}>
          {desktop ? '切换紧凑列表' : '切换桌面总览'}
        </button>
      </div>
      <div className="board-context">
        <div className="notice">
          <Database size={13} />
          {space === 'demo' ? (
            <>
              <strong>演示工作台</strong>
              <span>示例可自由修改，与正式待办分开。</span>
            </>
          ) : (
            <>
              <span>正式工作台</span>
              <span className="context-divider">/</span>
              <span>
                {tasks.length === 0
                  ? '从一件小事开始，或切换演示体验布局。'
                  : '多设备同步 · 北京时间'}
              </span>
            </>
          )}
        </div>
        <span className="small">
          {filter !== 'all' || search
            ? `筛选结果 ${filtered.length} / ${source.length} 项`
            : `${view === 'global' ? '先看数字，特殊事项可临时提前' : view === 'history' ? '已结束的事项可恢复' : view === 'trash' ? '删除的事项可恢复' : view === 'analytics' ? '按北京时间汇总新增、完成与每日变化' : '协调数字 → 协调字母 → 本流优先级'}`}
        </span>
      </div>
      {showCategoryPreview && (
        <output className="category-local-preview-notice">
          <Tags aria-hidden="true" />
          分类本地预览 · 合成数据 · 尚未发布
        </output>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button className="btn text" onClick={() => setError('')}>
            收起
          </button>
        </div>
      )}
      {syncState?.session && !data && (
        <div className="error">
          <Link className="btn" href="/login">
            重新登录
          </Link>
        </div>
      )}
      {updateReady && (
        <div className="notice">
          新版本已准备好。
          <button
            className="btn"
            disabled={!!editor || !!syncState?.queue.length}
            onClick={() =>
              void navigator.serviceWorker.getRegistration().then((r) => {
                if (r?.waiting) {
                  navigator.serviceWorker.addEventListener(
                    'controllerchange',
                    () => location.reload(),
                    { once: true },
                  );
                  r.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
                } else location.reload();
              })
            }
          >
            保存编辑后更新
          </button>
        </div>
      )}
      {data && savedDrafts.length > 0 && (
        <details className="draft-list">
          <summary>本机草稿 · {savedDrafts.length} 份</summary>
          {savedDrafts.map((d) => (
            <button
              className="btn"
              key={d.draft.id}
              onClick={() => open(d.draft, d.base)}
            >
              {d.draft.title || '未命名事项'}
            </button>
          ))}
        </details>
      )}
      {data &&
        syncState?.queue
          .filter((q) => q.state !== 'queued')
          .map((q) => (
            <ConflictPanel
              key={q.mutation.operationId}
              item={q}
              engine={engine.current!}
            />
          ))}
      {view === 'analytics' ? (
        <AnalyticsDashboard
          space={space}
          revision={data?.revision || 0}
          syncStatus={message}
        />
      ) : view === 'board' ? (
        <section className="board">
          <div className="board-head">
            <div>工作流</div>
            <div className="urgent-label">紧急事项 · EM</div>
            <div className="queue-label">
              <span>事项 · 协调顺序</span>
              <span>本流 / 协调</span>
            </div>
          </div>
          {FLOWS.map((f) => (
            <section
              className={
                'flow-row ' + (collapsed.includes(f.id) ? 'collapsed' : '')
              }
              key={f.id}
              data-flow={f.id}
            >
              <div className="flow-info">
                <button
                  className="flow-collapse"
                  aria-label={'折叠或展开' + f.name}
                  aria-expanded={!collapsed.includes(f.id)}
                  onClick={() =>
                    setCollapsed((c) =>
                      c.includes(f.id)
                        ? c.filter((x) => x !== f.id)
                        : [...c, f.id],
                    )
                  }
                >
                  {collapsed.includes(f.id) ? '展开' : '折叠'}
                </button>
                <div className="flow-top">
                  <h2>
                    <span className="flow-number">{Number(f.mark)}</span>{' '}
                    {f.name}
                  </h2>
                  <span className="count">{flowCount(f.id)}</span>
                </div>
                <small>{f.detail}</small>
                <button
                  type="button"
                  className="flow-manage" aria-label={f.name + '：管理分类'} title="管理分类"
                  onClick={() => setCategoryManagerFlow(f.id)}
                >
                  <Tags aria-hidden="true" />
                </button>
              </div>
              <FlowLane
                visible={filtered}
                flow={f.id}
                now={now}
                filtering={filter !== 'all' || !!search}
                busy={!data || busy}
                ready={!!data}
                categories={categories}
                onOpen={open}
                onFlag={(t) => void quick({ kind: 'flag', id: t.id })}
                onComplete={(t) => void quick({ kind: 'complete', id: t.id })}
                onCreate={create}
              />
            </section>
          ))}
        </section>
      ) : view === 'global' ? (
        <div className="global-view">
          {GROUP_NAMES.map((name, g) => {
            const list = filtered
              .filter((t) => groupOf(t, today(now)) === g)
              .sort((a, b) => globalSort(a, b, today(now)));
            return (
              list.length > 0 && (
                <section key={name} className="global-section">
                  <h2>
                    <span className={'group-index group-' + g}>
                      {String(g + 1).padStart(2, '0')}
                    </span>
                    {name}
                    <span className="count">{list.length}</span>
                  </h2>
                  <div className="global-grid">
                    {list.map((t) => (
                      <div className="global-wrapper" key={t.id}>
                        <div className="global-flow">
                          {FLOWS.find((f) => f.id === t.flow)?.name}
                          {g === 1 && (
                            <span>
                              今天有效 · {t.boostReason || '临时安排'}
                            </span>
                          )}
                        </div>
                        <TaskCard
                          task={t}
                          categories={categories}
                          now={now}
                          onComplete={() => {
                            if (!busy)
                              void quick({ kind: 'complete', id: t.id });
                          }}
                          onOpen={open}
                          showFlow
                          onFlag={() => {
                            if (!busy) void quick({ kind: 'flag', id: t.id });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )
            );
          })}
          {!filtered.length && (
            <div className="empty-view">当前没有符合条件的事项</div>
          )}
        </div>
      ) : (
        <div>
          <div className="history-heading">
            <h2>{view === 'history' ? '完成的事情，留在这里。' : '回收站'}</h2>
            <span>
              {view === 'history'
                ? '点击卡片可重新打开'
                : '没有永久删除操作，可以随时恢复。'}
            </span>
          </div>
          <div className="global-grid">
            {filtered.map((t) => (
              <div key={t.id}>
                <div className="global-flow">
                  {FLOWS.find((f) => f.id === t.flow)?.name}
                </div>
                <TaskCard
                  task={t}
                  categories={categories}
                  now={now}
                  onOpen={open}
                />
              </div>
            ))}
          </div>
          {!filtered.length && (
            <div className="empty-view">
              {view === 'history' ? '还没有已结束事项' : '回收站为空'}
            </div>
          )}
        </div>
      )}
      <footer className="footer">
        <span>按阶段协调，让重要的事情有位置。</span>
        <span>
          同步 v0.3 · {data ? today(now) : '加载中'} ·{' '}
          {data ? '版本 ' + data.revision : '连接中'}
        </span>
      </footer>
      {undo && (
        <div className="undo-toast">
          <Check />
          <span>操作已保存</span>
          <button
            onClick={() => {
              void quick(undo);
              setUndo(null);
            }}
          >
            撤销
          </button>
          <button aria-label="关闭撤销提示" onClick={() => setUndo(null)}>
            ×
          </button>
        </div>
      )}
      {editor && data && (
        <TaskEditor
          key={editorKey}
          tasks={tasks}
          categories={categories}
          onManageCategories={setCategoryManagerFlow}
          now={now}
          syncState={
            syncState?.queue.some(
              (q) =>
                q.mutation.taskId === editor.id &&
                (q.state === 'failed' || q.state === 'conflict'),
            )
              ? 'failed'
              : syncState?.queue.some((q) => q.mutation.taskId === editor.id)
                ? 'pending'
                : syncState?.message === '已同步'
                  ? 'synced'
                  : 'pending'
          }
          syncError={
            syncState?.queue.find(
              (q) => q.mutation.taskId === editor.id && q.state !== 'queued',
            )?.error
          }
          task={editor}
          baseTask={editorBase || editor}
          revision={data.revision}
          onSave={(t, r, b) => mutate({ kind: 'save', task: t }, r, b)}
          onDraft={(b, t) => engine.current!.saveDraft(b, t)}
          onClearDraft={(id) => engine.current!.clearDraft(id)}
          onAction={mutate}
          onReload={reload}
          onClose={() => {
            setEditor(null);
            void engine.current!.drafts().then(setSavedDrafts);
          }}
          onCopy={copy}
        />
      )}
      <Sheet open={settings} onOpenChange={setSettings}>
        <SheetContent className="editor-panel" showCloseButton={false}>
          <SheetHeader className="editor-header">
            <div className="editor-heading">
              <div>
                <SheetTitle>数据与设置</SheetTitle>
                <SheetDescription>
                  {space === 'personal' ? '正式工作台' : '演示工作台'} ·
                  数据分别保存
                </SheetDescription>
              </div>
              <Button className="btn text" onClick={() => setSettings(false)}>
                关闭
              </Button>
            </div>
          </SheetHeader>
          <div className="editor-scroll">
            <div className="editor-section-title">显示方式</div>
            <p className="field-help">统一紧凑卡片 · 每条工作流横向浏览</p>
            <div className="editor-section-title spaced">备份与恢复</div>
            <p className="field-help">
              备份包含事项、两套优先级、编号恢复位置、回收站及统计事件历史。使用一键启动入口时，还会在项目
              backups 文件夹生成当天备份。
            </p>
            <div className="data-buttons">
              <Button
                className="btn"
                onClick={() => void exportBackup()}
                disabled={!data}
              >
                <Download />
                导出当前工作台
              </Button>
              <Button
                className="btn"
                onClick={() => fileInput.current?.click()}
              >
                <Upload />
                选择 JSON 备份
              </Button>
              <input
                type="file"
                accept=".json,application/json"
                ref={fileInput}
                hidden
                onChange={(e) => {
                  void readFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
            {importData && (
              <div className="restore-preview">
                <h3>准备恢复 {importData.tasks.length} 张卡片</h3>
                <p>
                  来源：{importData.space === 'demo' ? '演示数据' : '正式数据'}
                  。将替换当前{space === 'demo' ? '演示' : '正式'}
                  工作台；现有数据会先保留一份快照。
                  {importHasNoCategoryFields &&
                    '恢复卡片无分类，现有分类目录保留。'}
                </p>
                {importHasNoCategoryFields && (
                  <p className="category-restore-note">
                    此备份没有分类字段；恢复时不会清空当前分类目录。
                  </p>
                )}
                <Button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void restoreBackup()}
                >
                  确认恢复到当前工作台
                </Button>
                {syncState?.session?.migrationEnabled &&
                  data?.revision === 0 && (
                    <Button
                      className="btn primary"
                      onClick={() => void restoreBackup('migration')}
                    >
                      初次迁移：保留原版本与时间
                    </Button>
                  )}
                <Button
                  className="btn text"
                  onClick={() => setImportData(null)}
                >
                  取消
                </Button>
              </div>
            )}
            <div className="editor-section-title spaced">恢复前快照</div>
            {snapshots.length ? (
              snapshots.map((s) => (
                <div className="snapshot-row" key={s.id}>
                  <span>
                    {new Date(s.created_at).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                    })}
                  </span>
                  <button
                    className="btn"
                    onClick={async () => {
                      try {
                        const response = await fetch(
                          '/api/backups?space=' +
                            space +
                            '&id=' +
                            encodeURIComponent(s.id),
                        );
                        if (!response.ok) throw new Error('无法读取快照');
                        setImportData(await response.json());
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    选择恢复
                  </button>
                </div>
              ))
            ) : (
              <p className="field-help">导入备份前会自动留存，可在这里找回。</p>
            )}
            <div className="editor-section-title spaced">云端备份</div>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/api/backup-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirm: true }),
                  });
                  await loadSnapshots();
                  setMessage('云端备份已创建');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              立即创建云端备份
            </button>
            {cloudBackups.some((b) => b.capacityWarning) && (
              <p className="error">
                备份空间接近保护上限，请下载备份并检查容量。系统不会自动删除旧备份。
              </p>
            )}
            {cloudBackups.length ? (
              cloudBackups.map((b) => (
                <div className="snapshot-row" key={b.id}>
                  <span>
                    {b.id} ·{' '}
                    {b.status === 'success'
                      ? '已备份'
                      : b.error === 'BACKUP_CAPACITY_LIMIT'
                        ? '备份失败：容量保护阈值已到，需下载留存'
                        : '备份失败，请检查云端状态'}
                  </span>
                  {b.status === 'success' && (
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          const data = await api(
                            '/api/backup-status?space=' +
                              space +
                              '&id=' +
                              encodeURIComponent(b.id),
                          );
                          download(data, '工作台云备份-' + b.id + '.json');
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      下载
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="field-help">尚无云端备份记录。</p>
            )}
            <div className="editor-section-title spaced">本机未同步数据</div>
            <button
              className="btn"
              onClick={async () =>
                download(
                  await engine.current!.exportPending(),
                  '工作台草稿与队列.json',
                )
              }
            >
              导出草稿与待同步操作
            </button>
            <div className="editor-section-title spaced">登录与安装</div>
            <p className="field-help">
              {syncState?.session?.email}
              <br />
              Android：浏览器菜单 → 安装应用。iPhone / iPad：Safari 分享 →
              添加到主屏幕。
            </p>
            {!syncState?.session?.local && (
              <button
                className="btn"
                disabled={!!editor}
                onClick={() => {
                  if (
                    confirm(
                      '退出后保留本机草稿和待同步操作，再次登录可继续。确定退出？',
                    )
                  )
                    void engine
                      .current!.logout()
                      .catch((e) => setError(e.message));
                }}
              >
                退出登录
              </button>
            )}
            <div className="editor-section-title spaced">当前版本</div>
            <p className="field-help">
              个人同步工作台 · v0.3
              <br />
              在线权威数据与本机草稿分别保存；离线修改在连接恢复后重试。
            </p>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <CategoryManager
        open={Boolean(categoryManagerFlow)}
        flow={categoryManagerFlow || 'study'}
        categories={categories}
        onClose={() => setCategoryManagerFlow(null)}
        onCreate={(category) => mutate({ kind: 'categoryCreate', category })}
        onUpdate={(categoryId, patch) =>
          mutate({ kind: 'categoryUpdate', categoryId, patch })
        }
      />
    </main>
  );
}
