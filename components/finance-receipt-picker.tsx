'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Check } from 'lucide-react';
import type { FinanceOcrCandidate } from '@/lib/finance-ocr';
import { amount, money } from './finance-ui';
export function FinanceReceiptPicker({
  value,
  onAmount,
  onBusy,
}: {
  value: string;
  onAmount: (v: string) => void;
  onBusy: (v: boolean) => void;
}) {
  const [working, setWorking] = useState(false),
    [status, setStatus] = useState(''),
    [candidates, setCandidates] = useState<FinanceOcrCandidate[]>([]),
    [error, setError] = useState('');
  const alive = useRef(true),
    recognizing = useRef(false),
    current = useRef({ value, onAmount, onBusy });
  useEffect(() => {
    current.current = { value, onAmount, onBusy };
  }, [value, onAmount, onBusy]);
  const recognize = async (file: File) => {
    if (recognizing.current) return;
    recognizing.current = true;
    setWorking(true);
    current.current.onBusy(true);
    setCandidates([]);
    setError('');
    setStatus('准备本机识别…');
    try {
      const { recognizeReceipt } = await import('@/lib/finance-ocr');
      const result = await recognizeReceipt(file, (s) => {
        if (alive.current) setStatus(s);
      });
      if (!alive.current) return;
      setCandidates(result.candidates);
      if (result.candidates.length === 1 && !current.current.value.trim()) {
        current.current.onAmount(amount(result.candidates[0].cents));
        setStatus('金额已填入，请核对后保存');
      } else
        setStatus(
          result.candidates.length
            ? '点选实际付款金额'
            : '未识别到明确金额，可以直接手填',
        );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      recognizing.current = false;
      if (alive.current) {
        setWorking(false);
        current.current.onBusy(false);
      }
    }
  };
  const handler = useRef(recognize);
  useEffect(() => {
    handler.current = recognize;
  });
  useEffect(() => {
    alive.current = true;
    const paste = (e: ClipboardEvent) => {
      const image = Array.from(e.clipboardData?.files || []).find((f) =>
        f.type.startsWith('image/'),
      );
      if (image) {
        e.preventDefault();
        void handler.current(image);
      }
    };
    document.addEventListener('paste', paste);
    return () => {
      alive.current = false;
      document.removeEventListener('paste', paste);
      current.current.onBusy(false);
    };
  }, []);
  return (
    <div className="f-receipt-picker">
      <label className={'f-receipt-button ' + (working ? 'is-working' : '')}>
        <Camera />
        {working ? '识别中…' : '截图识别金额'}
        <input
          aria-label="选择消费截图"
          disabled={working}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void recognize(f);
          }}
        />
      </label>
      <small>{working ? status : '也可直接粘贴截图 · 图片不上传'}</small>
      {!working && status && <output>{status}</output>}
      {!!candidates.length && (
        <div className="f-ocr-candidates">
          {candidates.map((c, index) => (
            <button
              type="button"
              key={index}
              title={c.label}
              aria-pressed={value !== '' && Number(value) === c.cents / 100}
              onClick={() => {
                onAmount(amount(c.cents));
                setStatus('已采用该金额，可继续保存');
              }}
            >
              <b>{money(c.cents)}</b>
              <small>{c.label}</small>
              {value !== '' && Number(value) === c.cents / 100 && <Check />}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="f-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
