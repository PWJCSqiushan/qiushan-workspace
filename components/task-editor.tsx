'use client';

import {useEffect, useRef, useState, type Dispatch, type SetStateAction, type SyntheticEvent} from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Clock3,
  Copy,
  Flag,
  ListChecks,
  MapPin,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import {COLORS, FLOWS, STATUSES, doneToday, today} from '@/lib/domain';
import type {Task} from '@/lib/domain';
import type {Workspace} from '@/lib/workspace';
import {Button} from '@/components/ui/button';
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {EditorDateField} from '@/components/editor-date-field';

export type TaskKind = 'project' | 'task';
export type EditorSyncState = 'draft' | 'pending' | 'synced' | 'failed';
export type TaskEditorTask = Task & {kind?: TaskKind; projectId?: string};

export type TaskEditorProps = {
  task: Task;
  baseTask: Task;
  revision: number;
  onSave: (task: Task, revision: number, baseTask: Task) => Promise<Workspace>;
  onDraft: (baseTask: Task, draft: Task) => Promise<void>;
  onClearDraft: (id: string) => Promise<void>;
  onAction: (operation: {kind: string; id: string; reason?: string}, revision: number) => Promise<Workspace>;
  onReload: () => Promise<Workspace>;
  onClose: () => void;
  onCopy: (task: Task) => void;
  tasks?: Task[];
  syncState?: EditorSyncState;
  syncError?: string;
  now?: Date;
};

const FLOW_PRIORITIES = ['S', 'A+', 'A', 'B', 'C', 'D', 'NA', ''];
const COORD_PRIORITIES = ['S', 'A', 'B', 'C', 'D', 'E', 'NA', ''];

const fingerprint = (task: Task) =>
  JSON.stringify({...task, version: 0, updatedAt: '', createdAt: ''});
const editorTask = (task: Task) => task as TaskEditorTask;
const gradeText = (value: string) => value || '未定';
const dateText = (value: string) => (value ? value.replace('T', ' ') : '');
const summary = (values: string[], empty = '未填写') => {
  const present = values.filter(Boolean);
  return present.length ? present.join(' · ') : empty;
};
function coordinationText(task: TaskEditorTask) {
  if (task.coordLetter === 'NA') return 'NA';
  if (task.coordLetter || task.coordOrder !== null) {
    return (task.coordLetter || '·') + (task.coordOrder ?? '');
  }
  return '未定';
}
function initialSections(task: TaskEditorTask) {
  return {
    context: Boolean(task.project || task.stage || task.location),
    activity: Boolean(task.start || task.end || task.minutes !== null),
    details: Boolean(task.notes || task.checklist.length || task.completions.length),
    actions: false,
  };
}

function GradeChoices({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  const values = [...options];
  const legacy = Boolean(value && !options.includes(value));
  return (
    <fieldset className="editor-choice-section">
      <legend>
        {label}{' '}
        <span>
          {legacy ? '旧值：' + value + '（未转换）' : '8档直接选择'}
        </span>
      </legend>
      <div className="choice-grid" role="radiogroup" aria-label={label}>
        {values.map((option) => (
          <button
            type="button"
            key={option || 'unset'}
            className={
              'grade-choice' +
              (option === 'NA' ? ' choice-na' : '') +
              (legacy && option === value ? ' legacy' : '')
            }
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {gradeText(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type SectionState = ReturnType<typeof initialSections>;
function onSectionToggle(
  name: keyof SectionState,
  event: SyntheticEvent<HTMLDetailsElement>,
  setExpanded: Dispatch<SetStateAction<SectionState>>,
) {
  const open = event.currentTarget.open;
  setExpanded((current) => current[name] === open ? current : ({...current, [name]: open}));
}

// Mutable refs intentionally preserve the established draft/outbox transaction boundary.
// This component opts out of compilation; its save and recovery behavior is browser-tested.
/* eslint-disable react/react-compiler */
export function TaskEditor({
  task,
  baseTask,
  revision,
  onSave,
  onDraft,
  onClearDraft,
  onAction,
  onReload,
  onClose,
  onCopy,
  syncState,
  syncError,
  now,
}: TaskEditorProps) {
  'use no memo'; // This editor coordinates mutable draft and outbox refs.
  const [draft, setDraft] = useState<TaskEditorTask>(() => editorTask(structuredClone(task)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [item, setItem] = useState('');
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [internalSync, setInternalSync] = useState<EditorSyncState>(task.version ? 'synced' : 'draft');
  const [expanded, setExpanded] = useState<SectionState>(() => initialSections(editorTask(task)));

  const current = useRef(draft);
  current.current = draft;
  const baseDraft = useRef(editorTask(structuredClone(baseTask)));
  const base = useRef(revision);
  const saved = useRef(fingerprint(task));
  const pending = useRef(false);
  const attempted = useRef('');
  const persistCurrent = useRef<(() => Promise<Workspace | null>) | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const draftWriter = useRef(onDraft);
  draftWriter.current = onDraft;
  const isNew = draft.version === 0;
  const todayDate = today(now || new Date());

  const dirty = fingerprint(draft) !== saved.current;
  const stateIsFailure =
    syncState === 'failed' ||
    Boolean(syncError) ||
    draftStatus === 'failed' ||
    internalSync === 'failed';
  const stateText = stateIsFailure
    ? '保存失败'
    : busy
      ? '正在保存…'
      : dirty
        ? draftStatus === 'saving'
          ? '正在保存本机草稿…'
          : draftStatus === 'saved'
            ? '本机草稿已保存'
            : '正在保存本机草稿…'
        : syncState === 'pending' || (!syncState && internalSync === 'pending')
          ? '待同步'
          : syncState === 'draft' || (!syncState && internalSync === 'draft')
            ? '本机草稿已保存'
            : syncState === 'synced'
              ? '已同步'
              : isNew
                ? '填写名称即可创建'
                : '已读取保存版本';

  const contextSummary = summary([
    draft.project ? '直属 ' + draft.project : '',
    draft.stage ? '阶段 ' + draft.stage : '',
    draft.location ? '地点 ' + draft.location : '',
    draft.status,
  ]);
  const activitySummary = summary(
    [
      draft.due ? '截止 ' + dateText(draft.due) : '',
      draft.start ? '开始 ' + dateText(draft.start) : '',
      draft.end ? '结束 ' + dateText(draft.end) : '',
      draft.minutes !== null ? draft.minutes + ' 分钟' : '',
    ],
    '日期、时长和地点',
  );
  const detailsSummary = summary(
    [
      draft.notes ? '有备注' : '',
      draft.checklist.length ? '清单 ' + draft.checklist.length + ' 项' : '',
      draft.completions.length ? '每日记录 ' + draft.completions.length + ' 天' : '',
    ],
    '备注、清单与卡片设置',
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (fingerprint(current.current) !== saved.current) {
        void draftWriter.current(
          structuredClone(baseDraft.current),
          structuredClone(current.current),
        ).catch(() => {});
      }
    },
    [],
  );

  useEffect(() => {
    if (!isNew) return;
    const timer = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isNew]);

  useEffect(() => {
    if (!dirty) return;

    void draftWriter.current(structuredClone(baseDraft.current), structuredClone(current.current))
      .then(() => {
        if (mounted.current) setDraftStatus('saved');
      })
      .catch((cause: unknown) => {
        if (!mounted.current) return;
        setDraftStatus('failed');
        setError('本机草稿保存失败：' + (cause as Error).message);
      });
  }, [draft, dirty]);


  useEffect(() => {
    function leaving(event: BeforeUnloadEvent) {
      if (fingerprint(current.current) !== saved.current) {
        event.preventDefault();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- Keep unload protection in older Safari.
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, []);

  useEffect(() => {
    if (
      draft.version > 0 &&
      dirty &&
      !busy &&
      !conflict &&
      draft.title.trim() &&
      attempted.current !== fingerprint(draft)
    ) {
      const timer = window.setTimeout(() => void persistCurrent.current?.(), 1000);
      return () => window.clearTimeout(timer);
    }
  }, [draft, dirty, busy, conflict]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && formRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        formRef.current.requestSubmit();
      }
    }
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  function change<K extends keyof Task>(key: K, value: Task[K]) {
    setDraft((currentDraft) => ({...currentDraft, [key]: value}));
    setDraftStatus('idle');
    setError('');
  }
  function validate(taskToSave: TaskEditorTask) {
    if (!taskToSave.title.trim()) {
      setError('请先填写事项名称');
      return false;
    }
    return true;
  }

  async function persistSnapshot(snapshot: TaskEditorTask, close = false) {
    if (pending.current || !validate(snapshot)) return null;
    pending.current = true;
    setBusy(true);
    setInternalSync('pending');
    setError('');
    attempted.current = fingerprint(snapshot);
    try {
      const workspace = await onSave(snapshot, base.current, structuredClone(baseDraft.current));
      const returned = workspace.tasks.find((candidate) => candidate.id === snapshot.id);
      if (!returned) throw new Error('保存后未找到事项');
      const savedTask = editorTask({...snapshot, ...returned});
      const same = fingerprint(current.current) === fingerprint(snapshot);
      base.current = workspace.revision;
      baseDraft.current = structuredClone(savedTask);
      saved.current = fingerprint(savedTask);
      if (same) await onClearDraft(savedTask.id);
      if (same) setDraft(structuredClone(savedTask));
      else
        setDraft((currentDraft) => ({
          ...currentDraft,
          version: savedTask.version,
          createdAt: savedTask.createdAt,
          updatedAt: savedTask.updatedAt,
        }));
      setDraftStatus(same ? 'idle' : 'saved');
      if (close && same) onClose();
      return workspace;
    } catch (cause) {
      const status = (cause as {status?: number}).status;
      setError((cause as Error).message);
      setConflict(status === 409);
      setInternalSync('failed');
      return null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function persist(close = false) {
    return persistSnapshot(structuredClone(current.current), close);
  }
  persistCurrent.current = persist;

  async function fastAction(
    kindName: 'complete' | 'boost' | 'pause' | 'delete' | 'finish' | 'reopen' | 'restore',
  ) {
    if (busy || conflict || pending.current) return;
    if (kindName === 'delete' && !window.confirm('将事项移入回收站？仍可从回收站恢复。')) return;
    if (
      kindName === 'finish' &&
      !window.confirm('结束每日任务？它会离开今日完成区，但完成记录会保留。')
    )
      return;

    const snapshot = structuredClone(current.current);
    try {
      if (dirty) {
        await draftWriter.current(structuredClone(baseDraft.current), snapshot);
        setDraftStatus('saved');
      }
      if (kindName === 'pause') {
        const next = editorTask({
          ...snapshot,
          status: snapshot.status === '暂停' ? '准备推进' : '暂停',
        });
        current.current = next;
        setDraft(next);
        await persistSnapshot(next);
        return;
      }

      let actionRevision = base.current;
      if (dirty || snapshot.version === 0) {
        const workspace = await persistSnapshot(snapshot);
        if (!workspace) return;
        actionRevision = workspace.revision;
      }
      setBusy(true);
      setInternalSync('pending');
      await onAction({kind: kindName, id: snapshot.id, reason: snapshot.boostReason}, actionRevision);
      onClose();
    } catch (cause) {
      const status = (cause as {status?: number}).status;
      setError((cause as Error).message);
      setConflict(status === 409);
      setInternalSync('failed');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (busy || pending.current) return;
    try {
      if (dirty) {
        await draftWriter.current(structuredClone(baseDraft.current), structuredClone(current.current));
        setDraftStatus('saved');
      }
      onClose();
    } catch (cause) {
      setDraftStatus('failed');
      setError('无法保存本机草稿：' + (cause as Error).message);
    }
  }

  async function reload() {
    if (!window.confirm('放弃面板中的草稿并载入最新保存版本？')) return;
    try {
      const workspace = await onReload();
      const returned = workspace.tasks.find((candidate) => candidate.id === draft.id);
      if (!returned) {
        setError('此事项已不在当前数据中，可复制为新卡片保留草稿。');
        return;
      }
      const fresh = editorTask(structuredClone(returned));
      base.current = workspace.revision;
      baseDraft.current = structuredClone(fresh);
      saved.current = fingerprint(fresh);
      await onClearDraft(fresh.id);
      setDraft(fresh);
      setDraftStatus('idle');
      setInternalSync('synced');
      setConflict(false);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function copyDraft() {
    if (busy) return;
    try {
      const snapshot = structuredClone(current.current);
      if (dirty) await draftWriter.current(structuredClone(baseDraft.current), snapshot);
      onCopy(snapshot);
    } catch (cause) {
      setDraftStatus('failed');
      setError('无法保存本机草稿：' + (cause as Error).message);
    }
  }

  function chooseCoordination(next: string) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      coordLetter: next,
      coordOrder: next === 'NA' ? null : currentDraft.coordOrder,
    }));
    setDraftStatus('idle');
    setError('');
  }
  function addChecklist() {
    if (!item.trim()) return;
    change('checklist', [
      ...draft.checklist,
      {id: crypto.randomUUID(), text: item.trim(), done: false},
    ]);
    setItem('');
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) void close(); }}>
      <SheetContent className="editor-panel editor-redesign" showCloseButton={false} initialFocus={isNew ? titleRef : false}>
        <SheetHeader className="editor-header">
          <div className="editor-heading">
            <div>
              <SheetTitle>{isNew ? '新增事项' : '事项详情'}</SheetTitle>
              <SheetDescription>
                {FLOWS.find((flow) => flow.id === draft.flow)?.name || '未命名工作流'} ·{' '}
                {isNew ? '填写名称，再补充细节' : '修改后自动保存'}
              </SheetDescription>
            </div>
            <Button type="button" className="btn text" onClick={() => void close()} disabled={busy}>关闭</Button>
          </div>
        </SheetHeader>

        <form
          className="editor-form"
          onSubmit={(event) => { event.preventDefault(); void persist(true); }}
          ref={formRef}
        >
          <div className="editor-scroll">
            <div className="editor-hero">
              <label className="field">
                事项名称 <span className="required">*</span>
                <input
                  ref={titleRef}
                  aria-label="事项名称"
                  maxLength={200}
                  required
                  className="title-input"
                  value={draft.title}
                  onChange={(event) => change('title', event.currentTarget.value)}
                  placeholder="例如：竞赛组会 · 对齐代码分工"
                />
              </label>



              {draft.version > 0 && !draft.deletedAt && draft.status !== '已结束' && (
                <>
                  <div className="editor-quick-actions" aria-label="常用动作">
                    <Button type="button" className="btn primary-action" disabled={busy || conflict || draft.status === '暂停'} onClick={() => void fastAction('complete')}><Check aria-hidden="true" />{draft.daily ? (doneToday(draft, todayDate) ? '撤销今日完成' : '今日完成') : '标记完成'}</Button>
                    <Button type="button" className="btn" disabled={busy || conflict} onClick={() => void fastAction('pause')}>{draft.status === '暂停' ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{draft.status === '暂停' ? '恢复推进' : '暂停'}</Button>
                    <Button type="button" className={'btn' + (draft.boostDate === todayDate ? ' boost-active' : '')} disabled={busy || conflict} onClick={() => void fastAction('boost')}><ArrowUp aria-hidden="true" />{draft.boostDate === todayDate ? '取消本次先做' : '本次先做'}</Button>
                  </div>
                  <label className="field boost-reason">本次先做 · 原因（可选）<input aria-label="本次先做原因" value={draft.boostReason} maxLength={1000} onChange={(event) => change('boostReason', event.currentTarget.value)} placeholder="为何临时提前？" /></label>
                </>
              )}
              {draft.version > 0 && draft.status === '已结束' && !draft.deletedAt && (
                <div className="editor-quick-actions" aria-label="常用动作"><Button type="button" className="btn primary-action" disabled={busy || conflict} onClick={() => void fastAction('reopen')}><RotateCcw aria-hidden="true" />恢复为待办</Button></div>
              )}
              {draft.version > 0 && draft.deletedAt && (
                <div className="editor-quick-actions" aria-label="常用动作"><Button type="button" className="btn primary-action" disabled={busy} onClick={() => void fastAction('restore')}><RotateCcw aria-hidden="true" />从回收站恢复</Button></div>
              )}

              <div className="editor-section-title">优先级与安排</div>
              <GradeChoices label="本流优先级" value={draft.priority} options={FLOW_PRIORITIES} onChange={(value) => change('priority', value)} />
              <GradeChoices label="协调字母" value={draft.coordLetter} options={COORD_PRIORITIES} onChange={chooseCoordination} />
              <div className="coordination-number-row">
                <label className="field">协调数字<input aria-label="协调数字" type="number" min="0" max="999999" step="1" disabled={draft.coordLetter === 'NA'} value={draft.coordLetter === 'NA' ? '' : draft.coordOrder ?? ''} onChange={(event) => change('coordOrder', event.currentTarget.value === '' ? null : Number(event.currentTarget.value))} placeholder="可填 0，表示最先" /></label>
                <output className="coordination-preview" aria-label="协调完整代码"><span>完整代码</span><strong>{coordinationText(draft)}</strong></output>
              </div>
              {draft.coordLetter === 'NA' && draft.coordOrder !== null && <p className="relation-notice warning">当前载入的旧值为 NA {draft.coordOrder}，原值保留；重新选择 NA 会清空数字。</p>}

              <EditorDateField id="due" label="截止时间" value={draft.due} now={now} quick help="今天、明天和清除按北京时间计算；只填日期时按当天结束处理。" onChange={(value) => change('due', value)} />
              <div className="marker-grid" aria-label="事项标记">
                <label><input aria-label="紧急 EM" type="checkbox" checked={draft.emergency} onChange={(event) => change('emergency', event.currentTarget.checked)} /><AlertTriangle aria-hidden="true" />紧急 EM</label>
                <label><input aria-label="重点旗标" type="checkbox" checked={draft.flagged} onChange={(event) => change('flagged', event.currentTarget.checked)} /><Flag aria-hidden="true" />重点旗标</label>
                <label><input aria-label="每日重复" type="checkbox" checked={draft.daily} onChange={(event) => change('daily', event.currentTarget.checked)} /><Repeat2 aria-hidden="true" />每日重复</label>
              </div>
              <p className="field-help">旗标只作关注；全局协调先看数字。每日完成记录按北京时间独立保存。</p>
            </div>

            <details className="editor-section" open={expanded.context} onToggle={(event) => onSectionToggle('context', event, setExpanded)}>
              <summary><span>事项与上下文</span><span className="section-summary">{contextSummary}</span></summary>
              <div className="editor-section-body">
                <div className="field-grid">
                  <label className="field">所属工作流<select aria-label="所属工作流" value={draft.flow} onChange={(event) => change('flow', event.currentTarget.value)}>{FLOWS.map((flow) => <option value={flow.id} key={flow.id}>{flow.name}</option>)}</select></label>
                  <label className="field">状态<select aria-label="状态" value={draft.status} onChange={(event) => change('status', event.currentTarget.value)}>{STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}</select></label>
                </div>
                <label className="field">直属 / 项目文本<input aria-label="直属 / 项目文本" value={draft.project} maxLength={1000} onChange={(event) => change('project', event.currentTarget.value)} placeholder="例如：课程名称、工作组或所属事项" /></label>
                <label className="field">阶段标签<input aria-label="阶段标签" value={draft.stage} maxLength={1000} onChange={(event) => change('stage', event.currentTarget.value)} placeholder="例如：备赛期" /></label>
              </div>
            </details>

            <details className="editor-section" open={expanded.activity} onToggle={(event) => onSectionToggle('activity', event, setExpanded)}>
              <summary><span>活动安排</span><span className="section-summary">{activitySummary}</span></summary>
              <div className="editor-section-body">
                <div className="activity-grid">
                  <EditorDateField id="start" label="活动开始" value={draft.start} now={now} onChange={(value) => change('start', value)} />
                  <EditorDateField id="end" label="活动结束" value={draft.end} now={now} onChange={(value) => change('end', value)} />
                </div>
                <div className="field-grid">
                  <label className="field">预计耗时（分钟）<input aria-label="预计耗时（分钟）" type="number" min="0" max="1000000" value={draft.minutes ?? ''} onChange={(event) => change('minutes', event.currentTarget.value === '' ? null : Number(event.currentTarget.value))} placeholder="可留空" /></label>
                  <label className="field">地点<span className="field-help"><MapPin aria-hidden="true" /> </span><input aria-label="地点" value={draft.location} maxLength={1000} onChange={(event) => change('location', event.currentTarget.value)} placeholder="会议室、线上会议或操场" /></label>
                </div>
              </div>
            </details>

            <details className="editor-section" open={expanded.details} onToggle={(event) => onSectionToggle('details', event, setExpanded)}>
              <summary><span>补充信息</span><span className="section-summary">{detailsSummary}</span></summary>
              <div className="editor-section-body">
                <label className="field">备注<textarea aria-label="备注" rows={4} maxLength={20000} value={draft.notes} onChange={(event) => change('notes', event.currentTarget.value)} placeholder="需要准备什么？下一步是什么？" /></label>
                <div className="editor-section-title"><span className="section-title-with-icon"><ListChecks aria-hidden="true" />检查清单</span><span>{draft.checklist.filter((entry) => entry.done).length} / {draft.checklist.length}</span></div>
                {draft.checklist.map((entry) => (
                  <div className="checklist-row" key={entry.id}>
                    <input type="checkbox" aria-label={'完成清单 ' + entry.text} checked={entry.done} onChange={(event) => change('checklist', draft.checklist.map((candidate) => candidate.id === entry.id ? {...candidate, done: event.currentTarget.checked} : candidate))} />
                    <span>{entry.text}</span>
                    <button type="button" aria-label={'移除清单 ' + entry.text} onClick={() => change('checklist', draft.checklist.filter((candidate) => candidate.id !== entry.id))}>×</button>
                  </div>
                ))}
                <div className="add-check">
                  <input aria-label="新增检查项" value={item} maxLength={500} onChange={(event) => setItem(event.currentTarget.value)} placeholder="添加一个小步骤" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addChecklist(); } }} />
                  <button type="button" className="btn" aria-label="添加检查项" onClick={addChecklist}><Plus aria-hidden="true" /></button>
                </div>
                <div className="editor-section-title">卡片颜色</div>
                <div className="color-row">
                  {COLORS.map((color) => <button type="button" key={color} aria-label={'颜色 ' + color} aria-pressed={draft.color === color} className={draft.color === color ? 'color-dot chosen' : 'color-dot'} style={{background: color}} onClick={() => change('color', color)} />)}
                  <input type="color" aria-label="自定义卡片颜色" value={draft.color} onChange={(event) => change('color', event.currentTarget.value)} />
                </div>
                {draft.daily && draft.completions.length > 0 && <details className="daily-history"><summary>每日完成记录 · {draft.completions.length} 天</summary><p>{[...draft.completions].sort().reverse().join(' / ')}</p></details>}
              </div>
            </details>

            {draft.version > 0 && (
              <details className="editor-section" open={expanded.actions} onToggle={(event) => onSectionToggle('actions', event, setExpanded)}>
                <summary><span>更多动作</span><span className="section-summary">复制、结束和回收站</span></summary>
                <div className="editor-section-body secondary-actions">
                  <Button type="button" className="btn" disabled={busy} onClick={() => void copyDraft()}><Copy aria-hidden="true" />复制为新卡片</Button>
                  {draft.daily && !draft.deletedAt && draft.status !== '已结束' && <Button type="button" className="btn" disabled={busy || conflict} onClick={() => void fastAction('finish')}><Clock3 aria-hidden="true" />结束每日任务</Button>}
                  {!draft.deletedAt && <Button type="button" className="btn danger" disabled={busy || conflict} onClick={() => void fastAction('delete')}><Trash2 aria-hidden="true" />移入回收站</Button>}
                  {conflict && <><Button type="button" className="btn" onClick={() => void reload()}>丢弃草稿并载入最新</Button><Button type="button" className="btn" onClick={() => onCopy(draft)}>草稿复制为新卡片</Button></>}
                </div>
              </details>
            )}
          </div>

          <div className="editor-save">
            {(error || syncError) && <div className="error" role="alert">{error || syncError}</div>}
            <div className="save-bar">
              <output className={stateText === '保存失败' ? 'save-state failed' : 'save-state'} aria-live="polite">{stateText}</output>
              <Button type="submit" className="btn primary" disabled={busy || conflict}><Save aria-hidden="true" />{isNew ? '创建事项' : '完成编辑'}</Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}


/* eslint-enable react/react-compiler */
