"use client";
/* eslint-disable react/react-compiler */

import {useEffect, useMemo, useState} from 'react';
import {Check, Edit3, Palette, Plus, RotateCcw, X} from 'lucide-react';
import {FLOWS} from '@/lib/domain';
import type {Category} from '@/lib/categories';
import {Button} from '@/components/ui/button';
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {CategoryBadge} from '@/components/category-badge';

type CategoryPatch = Partial<Pick<Category, 'name' | 'displayLabel' | 'color' | 'archived'>>;

export type CategoryManagerProps = {
  open: boolean;
  flow: string;
  categories?: readonly Category[];
  onClose: () => void;
  onCreate: (category: Category) => Promise<unknown>;
  onUpdate: (categoryId: string, patch: CategoryPatch) => Promise<unknown>;
};

type Draft = Pick<Category, 'id' | 'name' | 'displayLabel' | 'color' | 'archived'>;

const PALETTE = [
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
];

const countText = (value: string) => Array.from(value).length;
const nameKey = (value: string) => value.trim().normalize().toLocaleLowerCase('zh-CN');

function blankDraft(): Draft {
  return {
    id: 'category-' + crypto.randomUUID(),
    name: '',
    displayLabel: '',
    color: PALETTE[5],
    archived: false,
  };
}

function categoryFromDraft(draft: Draft, flow: string): Category {
  const name = draft.name.trim();
  const short = draft.displayLabel.trim() || (countText(name) <= 3 ? name : '');
  return {id: draft.id, flow, name, displayLabel: short, color: draft.color, archived: draft.archived};
}

export function CategoryManager({open, flow, categories = [], onClose, onCreate, onUpdate}: CategoryManagerProps) {
  const flowInfo = FLOWS.find((candidate) => candidate.id === flow);
  const flowCategories = useMemo(() => categories.filter((category) => category.flow === flow), [categories, flow]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blankDraft());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setDraft(blankDraft());
    setError('');
  }, [open, flow]);

  function edit(category: Category) {
    setEditingId(category.id);
    setDraft({
      id: category.id,
      name: category.name,
      displayLabel: category.displayLabel,
      color: category.color,
      archived: category.archived,
    });
    setError('');
  }

  function beginCreate() {
    setEditingId('new');
    setDraft(blankDraft());
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(blankDraft());
    setError('');
  }

  function validate() {
    const name = draft.name.trim();
    const short = draft.displayLabel.trim();
    if (!name) return '请填写分类全名';
    if (countText(name) > 20) return '分类全名最多 20 字';
    if (countText(name) > 3 && !short) return '全名超过 3 字时，请填写 1—3 字卡面简称';
    if (short && (countText(short) < 1 || countText(short) > 3)) return '卡面简称限 1—3 字';
    if (!/^#[0-9a-fA-F]{6}$/.test(draft.color)) return '请选择有效的 6 位十六进制颜色';
    const duplicate = flowCategories.some(
      (category) => category.id !== draft.id && nameKey(category.name) === nameKey(name),
    );
    if (duplicate) return '同一工作流中已有同名分类';
    return '';
  }

  async function save() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const category = categoryFromDraft(draft, flow);
      if (editingId === 'new') {
        await onCreate(category);
      } else if (editingId) {
        const current = flowCategories.find((candidate) => candidate.id === editingId);
        if (!current) throw new Error('分类已不存在，请刷新后重试');
        const patch: CategoryPatch = {};
        if (current.name !== category.name) patch.name = category.name;
        if (current.displayLabel !== category.displayLabel) patch.displayLabel = category.displayLabel;
        if (current.color !== category.color) patch.color = category.color;
        if (current.archived !== category.archived) patch.archived = category.archived;
        if (Object.keys(patch).length) await onUpdate(editingId, patch);
      }
      cancelEdit();
    } catch (cause) {
      setError((cause as Error).message || '分类保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchived(category: Category) {
    setBusy(true);
    setError('');
    try {
      await onUpdate(category.id, {archived: !category.archived});
    } catch (cause) {
      setError((cause as Error).message || '分类状态更新失败');
    } finally {
      setBusy(false);
    }
  }

  const preview = categoryFromDraft(draft, flow);
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onClose(); }}>
      <SheetContent className="category-manager-panel" showCloseButton={false}>
        <SheetHeader className="category-manager-header">
          <div className="category-manager-heading">
            <div>
              <SheetTitle>管理分类</SheetTitle>
              <SheetDescription>{flowInfo?.name || flow} · 当前工作流独立目录</SheetDescription>
            </div>
            <Button type="button" className="btn text" onClick={onClose} disabled={busy}>关闭</Button>
          </div>
        </SheetHeader>

        <div className="category-manager-scroll">
          <div className="category-manager-intro">
            <div>
              <strong>把相似事项放在一起</strong>
              <p>分类只用于识别，不会改变排序、优先级、旗标或完成规则。</p>
            </div>
            {editingId === null && <Button type="button" className="btn primary" onClick={beginCreate}><Plus aria-hidden="true" />新增分类</Button>}
          </div>

          {error && <div className="category-manager-error" role="alert">{error}</div>}

          {editingId !== null && (
            <section className="category-form" aria-label={editingId === 'new' ? '新增分类' : '编辑分类'}>
              <div className="category-form-title">
                <span>{editingId === 'new' ? '新增分类' : '编辑分类'}</span>
                <button type="button" className="category-icon-button" onClick={cancelEdit} aria-label="取消编辑" disabled={busy}><X /></button>
              </div>
              <label className="category-field">
                分类全名
                <span className="category-field-hint">{countText(draft.name)} / 20 字</span>
                <input aria-label="分类全名" maxLength={20} value={draft.name} onChange={(event) => {
                  const name = event.currentTarget.value;
                  setDraft((current) => ({...current, name, displayLabel: current.displayLabel === current.name && countText(current.name) <= 3 ? name : current.displayLabel}));
                  setError('');
                }} placeholder="例如：考试、竞赛或内容制作" />
              </label>
              <label className="category-field">
                卡面简称
                <span className="category-field-hint">{countText(draft.displayLabel)} / 3 字</span>
                <input aria-label="卡面简称" maxLength={3} value={draft.displayLabel} onChange={(event) => { const displayLabel = event.currentTarget.value; setDraft((current) => ({...current, displayLabel})); setError(''); }} placeholder={countText(draft.name) <= 3 ? '默认使用全名' : '长名称必填'} />
              </label>
              <div className="category-color-label">背景颜色</div>
              <div className="category-palette" aria-label="分类颜色色板">
                {PALETTE.map((color) => <button type="button" key={color} className={'category-color-choice' + (draft.color === color ? ' selected' : '')} style={{backgroundColor: color}} aria-label={'颜色 ' + color} aria-pressed={draft.color === color} onClick={() => setDraft((current) => ({...current, color}))} />)}
                <label className="category-custom-color" title="自定义颜色">
                  <Palette aria-hidden="true" />
                  <input type="color" aria-label="自定义分类背景颜色" value={draft.color} onChange={(event) => { const color = event.currentTarget.value; setDraft((current) => ({...current, color})); }} />
                </label>
              </div>
              <div className="category-preview-box">
                <span>徽章预览</span>
                <CategoryBadge category={preview} />
                <small title={preview.name}>{preview.name || '填写全名后预览'}</small>
              </div>
              <div className="category-form-actions">
                <Button type="button" className="btn" onClick={cancelEdit} disabled={busy}>取消</Button>
                <Button type="button" className="btn primary" onClick={() => void save()} disabled={busy}><Check aria-hidden="true" />保存分类</Button>
              </div>
            </section>
          )}

          <section className="category-list" aria-label="当前工作流分类">
            <div className="category-list-heading"><span>分类目录</span><small>{flowCategories.length} 项 · 改名改色会同步更新已有卡片</small></div>
            {flowCategories.length === 0 && <div className="category-empty"><Palette aria-hidden="true" /><span>还没有分类，新增一个开始整理。</span></div>}
            {flowCategories.map((category) => (
              <article className={'category-row' + (category.archived ? ' archived' : '')} key={category.id}>
                <CategoryBadge category={category} />
                <div className="category-row-copy"><strong>{category.name}</strong><small>{category.archived ? '已停用 · 旧卡仍会显示' : '启用中 · 可在编辑器中选择'}</small></div>
                <div className="category-row-actions">
                  <Button type="button" className="btn" onClick={() => edit(category)} disabled={busy}><Edit3 aria-hidden="true" />编辑</Button>
                  <Button type="button" className="btn" onClick={() => void toggleArchived(category)} disabled={busy}>{category.archived ? <RotateCcw aria-hidden="true" /> : <X aria-hidden="true" />}{category.archived ? '启用' : '停用'}</Button>
                </div>
              </article>
            ))}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
