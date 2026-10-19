'use client';

import { useMemo, useState } from 'react';
import type { PaymentMethod } from '../../lib/pos/retail';
import { PAYMENT_METHOD_LABELS } from '../../lib/pos/retail';

export type ReturnableLine = {
  id: string;
  name: string;
  type: 'product' | 'service';
  soldQty: number;
  returnableQty: number;
  unitAmount: number;
};

export default function ReturnDialog({
  receiptNumber,
  lines,
  formatMoney,
  onClose,
  onSubmit,
}: {
  receiptNumber: string;
  lines: ReturnableLine[];
  formatMoney: (value: number) => string;
  onClose: () => void;
  onSubmit: (quantities: Record<string, number>, method: PaymentMethod, reference: string) => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((line) => [line.id, 0])));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const refund = useMemo(() => lines.reduce((sum, line) => sum + (quantities[line.id] || 0) * line.unitAmount, 0), [lines, quantities]);
  const hasReturn = lines.some((line) => (quantities[line.id] || 0) > 0);

  return (
    <div className="pos-overlay">
      <form className="pos-sheet" role="dialog" aria-modal="true" aria-labelledby="return-title" onSubmit={(event) => {
        event.preventDefault();
        if (!hasReturn) return;
        onSubmit(quantities, method, reference);
      }}>
        <header>
          <div>
            <p>Original sale stays unchanged</p>
            <h3 id="return-title">Return {receiptNumber}</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close return">×</button>
        </header>
        <div className="pos-return-list">
          {lines.map((line) => (
            <label key={line.id}>
              <span>
                <strong>{line.name}</strong>
                <small>{line.returnableQty} of {line.soldQty} can be returned · {formatMoney(line.unitAmount)} each</small>
              </span>
              <input
                type="number"
                min={0}
                max={line.returnableQty}
                step="1"
                value={quantities[line.id] || 0}
                disabled={line.returnableQty <= 0}
                onChange={(event) => {
                  const next = Math.max(0, Math.min(line.returnableQty, Math.round(Number(event.target.value) || 0)));
                  setQuantities((prev) => ({ ...prev, [line.id]: next }));
                }}
              />
            </label>
          ))}
        </div>
        <label>
          Refund method
          <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((item) => <option key={item} value={item}>{PAYMENT_METHOD_LABELS[item]}</option>)}
          </select>
        </label>
        {method !== 'cash' && method !== 'on_account' && (
          <label>
            Reference
            <input value={reference} maxLength={80} onChange={(event) => setReference(event.target.value)} />
          </label>
        )}
        <div className="pos-total-row is-due"><span>Refund</span><strong>{formatMoney(refund)}</strong></div>
        <p className="pos-pay-note">Returned products go back into stock. This records a credit note and does not rewrite the original receipt.</p>
        <button type="submit" className="primary pos-charge" disabled={!hasReturn}>Issue credit note</button>
      </form>
    </div>
  );
}
