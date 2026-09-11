import {doneToday,today} from './domain.ts';
import type {Task} from './domain.ts';

/**
 * Presentation-only values used by TaskCard.
 *
 * These helpers deliberately do not mutate a Task.  In particular, the
 * stored hand-picked `color` remains available to the editor and is not used
 * as the card surface color.
 */
export type CardTone = 'completed'|'emergency'|'daily'|'high'|'plain';
export type CardKind = 'project'|'task'|'unclassified';
export type TaskView = Task & {
  kind?: string;
  projectId?: string;
};

export type DueState = 'today'|'soon'|'overdue'|'scheduled'|'complete'|'invalid';

export type DuePresentation = {
  state: DueState;
  label: string;
  detail: string;
  timestamp: number;
  dateOnly: boolean;
};

const HIGH_PRIORITY = new Set(['S+','S','S-','A+']);
const MEDIUM_PRIORITY = new Set(['A','A-']);

export function isCompleted(task: Task, now = new Date()): boolean {
  return task.status === '已结束' || doneToday(task, today(now));
}

export function isStrongPriority(priority: string): boolean {
  return HIGH_PRIORITY.has(priority);
}

export function isMediumPriority(priority: string): boolean {
  return MEDIUM_PRIORITY.has(priority);
}

export function isStrongCoordination(letter: string): boolean {
  return letter === 'S';
}

export function isMediumCoordination(letter: string): boolean {
  return letter === 'A';
}

export function cardTone(task: Task, now = new Date()): CardTone {
  if (isCompleted(task, now)) return 'completed';
  if (task.emergency) return 'emergency';
  if (task.daily) return 'daily';
  if (isStrongPriority(task.priority) || isStrongCoordination(task.coordLetter)) return 'high';
  return 'plain';
}

export function cardKind(task: TaskView, explicit?: CardKind): CardKind {
  if (explicit) return explicit;
  if (task.kind === 'project' || task.kind === 'task') return task.kind;
  return 'unclassified';
}

/** Parse the task's Beijing-local date/time format, including date-only due dates. */
export function taskTimestamp(value: string): number {
  if (!value) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T23:59:59+08:00`);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) return Date.parse(value);
  return Date.parse(`${value}+08:00`);
}

function calendarDate(value: string): {year: number; month: number; day: number}|null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return {year: Number(match[1]), month: Number(match[2]), day: Number(match[3])};
}

export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Use Beijing calendar labels without shifting a date-only value. */
export function formatTaskDate(value: string): string {
  const date = calendarDate(value);
  if (date) {
    const dateLabel = `${date.month}月${date.day}日`;
    if (isDateOnly(value)) return dateLabel;
  }
  const timestamp = taskTimestamp(value);
  if (!Number.isFinite(timestamp)) return value.replace('T',' ');
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(timestamp)).replace(' ', ' ');
}

function remainingLabel(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000));
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  return `${Math.ceil(hours / 24)}天`;
}

export function duePresentation(task: Task, now = new Date()): DuePresentation|null {
  if (!task.due) return null;
  const timestamp = taskTimestamp(task.due);
  const dateOnly = isDateOnly(task.due);
  const dateLabel = formatTaskDate(task.due);
  if (!Number.isFinite(timestamp)) {
    return {state:'invalid',label:'截止',detail:task.due.replace('T',' '),timestamp,dateOnly};
  }
  if (isCompleted(task, now)) {
    return {state:'complete',label:'截止',detail:`${dateLabel}${dateOnly?'（当日结束）':''}`,timestamp,dateOnly};
  }
  const remaining = timestamp - now.getTime();
  if (remaining < 0) {
    return {state:'overdue',label:'已逾期',detail:`截止 ${dateLabel}`,timestamp,dateOnly};
  }
  const dueDay = task.due.slice(0,10);
  if (dueDay === today(now)) {
    return {state:'today',label:'今日截止',detail:`剩余 ${remainingLabel(remaining)}`,timestamp,dateOnly};
  }
  if (remaining < 86400000) {
    return {state:'soon',label:'即将截止',detail:`剩余 ${remainingLabel(remaining)}`,timestamp,dateOnly};
  }
  return {state:'scheduled',label:'截止',detail:`${dateLabel}${dateOnly?'（当日结束）':''}`,timestamp,dateOnly};
}

export function priorityLabel(priority: string): string {
  return priority || '未定';
}

export function coordinationParts(letter: string, order: number|null): {label: string; letter: string; order: string} {
  if (letter === 'NA') return {label:'NA',letter:'NA',order:''};
  if (!letter && order === null) return {label:'未定',letter:'未定',order:''};
  const coordinationLetter = letter || '·';
  const coordinationOrder = order === null ? '' : String(order);
  return {label:`${coordinationLetter}${coordinationOrder}`,letter:coordinationLetter,order:coordinationOrder};
}
