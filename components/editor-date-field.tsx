'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {CalendarDays, Clock3, X} from 'lucide-react';
import {today} from '@/lib/domain';

export type EditorDateMode = 'date' | 'datetime';

type EditorDateFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  now?: Date;
  quick?: boolean;
  help?: string;
};

export function datePart(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
}

export function timePart(value: string) {
  const match = /T(\d{2}:\d{2})/.exec(value);
  return match ? match[1] : '';
}

export function composeEditorDate(date: string, time = '') {
  return date ? (time ? date + 'T' + time : date) : '';
}

export function editorDateMode(value: string): EditorDateMode {
  return timePart(value) ? 'datetime' : 'date';
}

export function shiftBeijingDate(value: string, amount: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || !Number.isInteger(amount)) return value;
  const [year, month, day] = match.slice(1).map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return today(shifted);
}

export function quickEditorDate(current: string, nextDate: string) {
  return composeEditorDate(nextDate, timePart(current));
}

export function EditorDateField({
  id,
  label,
  value,
  onChange,
  now,
  quick = false,
  help,
}: EditorDateFieldProps) {
  const generatedId = useId().replaceAll(':', '');
  const controlId = id + '-' + generatedId;
  const modeId = `${controlId}-mode`;
  const [mode, setMode] = useState<EditorDateMode>(() => editorDateMode(value));
  const previousValue = useRef(value);

  // A reload or a remote update can change the stored date mode without
  // remounting the editor. An empty value remains date-only by default.
  useEffect(() => {
    if (previousValue.current !== value) {
      setMode(editorDateMode(value));
      previousValue.current = value;
    }
  }, [value]);

  const date = datePart(value);
  const time = timePart(value);
  const shanghaiToday = today(now || new Date());
  const tomorrow = shiftBeijingDate(shanghaiToday, 1);

  function toggleTime(enabled: boolean) {
    setMode(enabled ? 'datetime' : 'date');
    // Enabling time only reveals an empty time input. Removing time is an
    // explicit user action, so it removes the stored T component.
    if (!enabled && date && time) onChange(date);
  }

  function changeDate(nextDate: string) {
    onChange(composeEditorDate(nextDate, mode === 'datetime' ? time : ''));
  }

  function changeTime(nextTime: string) {
    if (!nextTime) {
      setMode('date');
      onChange(date);
      return;
    }
    setMode('datetime');
    onChange(composeEditorDate(date, nextTime));
  }

  function chooseDate(nextDate: string) {
    const nextTime = timePart(value);
    setMode(nextTime ? 'datetime' : 'date');
    onChange(composeEditorDate(nextDate, nextTime));
  }

  return (
    <div className="editor-date-field">
      <div className="editor-date-label-row">
        <label htmlFor={controlId} className="field-label">
          {label}
        </label>
        <label htmlFor={modeId} className="date-mode-toggle">
          <input
            id={modeId}
            type="checkbox"
            checked={mode === 'datetime'}
            onChange={(event) => toggleTime(event.currentTarget.checked)}
          />
          <span>{mode === 'datetime' ? '已添加时间' : '添加时间'}</span>
        </label>
      </div>
      <div className="editor-date-control">
        <CalendarDays aria-hidden="true" />
        <input
          id={controlId}
          aria-label={label}
          type="date"
          value={date}
          onChange={(event) => changeDate(event.currentTarget.value)}
        />
        {mode === 'datetime' && (
          <input
            className="editor-time-input"
            aria-label={`${label}具体时间`}
            type="time"
            value={time}
            onChange={(event) => changeTime(event.currentTarget.value)}
          />
        )}
        {value && (
          <button
            type="button"
            className="date-clear-button"
            aria-label={'清除' + label}
            onClick={() => chooseDate('')}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      {quick && (
        <div className="quick-date-row" aria-label={label + '快捷日期'}>
          <button type="button" onClick={() => chooseDate(shanghaiToday)}>今天</button>
          <button type="button" onClick={() => chooseDate(tomorrow)}>明天</button>
          <button type="button" onClick={() => chooseDate('')}>清除</button>
        </div>
      )}
      <p className="field-help editor-date-help">
        <Clock3 aria-hidden="true" />
        <span>{help || '按北京时间保存；需要具体时间时再打开时间。'}</span>
      </p>
    </div>
  );
}
