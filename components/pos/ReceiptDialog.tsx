'use client';

import Image from 'next/image';
import type { ReceiptModel } from '../../lib/pos/retail';
import { printReceipt } from '../../lib/pos/retail';

export default function ReceiptDialog({
  receipt,
  formatMoney,
  onClose,
}: {
  receipt: ReceiptModel;
  formatMoney: (value: number) => string;
  onClose: () => void;
}) {
  return (
    <div className="pos-overlay" role="presentation">
      <div className="pos-sheet pos-receipt-sheet" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
        <header>
          <div>
            <p>{receipt.kind === 'return' ? 'Credit note' : 'Sale complete'}</p>
            <h3 id="receipt-title">{receipt.receiptNumber}</h3>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close receipt">×</button>
        </header>
        <article className="pos-receipt-paper">
          <div className="pos-receipt-shop">
            <strong>{receipt.shopName}</strong>
            {receipt.address && <span>{receipt.address}</span>}
            {receipt.phone && <span>{receipt.phone}</span>}
          </div>
          <p>{new Date(receipt.createdAt).toLocaleString()}</p>
          <p>{receipt.cashier}</p>
          {(receipt.customerName || receipt.customerPhone) && <p>{receipt.customerName || 'Customer'}{receipt.customerPhone ? ` · ${receipt.customerPhone}` : ''}</p>}
          <ul>
            {receipt.lines.map((line) => (
              <li key={`${line.name}-${line.qty}-${line.amount}`}>
                <span>{line.name}<small>× {line.qty}</small></span>
                <strong>{formatMoney(line.amount)}</strong>
              </li>
            ))}
          </ul>
          <div className="pos-total-row"><span>Subtotal</span><span>{formatMoney(receipt.subtotal)}</span></div>
          {receipt.discount > 0 && <div className="pos-total-row"><span>Discount</span><span>− {formatMoney(receipt.discount)}</span></div>}
          {receipt.showTax && <div className="pos-total-row"><span>{receipt.taxName}</span><span>{formatMoney(receipt.tax)}</span></div>}
          <div className="pos-total-row is-due"><span>Total</span><strong>{formatMoney(receipt.total)}</strong></div>
          {receipt.tenders.map((tender) => (
            <div key={`${tender.label}-${tender.amount}`}>
              <div className="pos-total-row"><span>{tender.label}</span><span>{formatMoney(tender.amount)}</span></div>
              {typeof tender.tendered === 'number' && <div className="pos-total-row is-muted"><span>Tendered</span><span>{formatMoney(tender.tendered)}</span></div>}
              {typeof tender.change === 'number' && tender.change > 0 && <div className="pos-total-row"><span>Change</span><span>{formatMoney(tender.change)}</span></div>}
              {tender.reference && <p className="pos-pay-note">Ref {tender.reference}</p>}
            </div>
          ))}
          <p className="pos-pay-note">{receipt.note}</p>
          {receipt.footer && <p className="pos-receipt-footer">{receipt.footer}</p>}
          <p className="pos-receipt-brand"><Image src="/brand/wordmark.png" alt="" width={165} height={34} unoptimized /></p>
        </article>
        <div className="pos-actions">
          <button type="button" className="edit-btn" onClick={onClose}>New sale</button>
          <button type="button" className="primary" onClick={() => printReceipt(receipt, formatMoney)}>Print receipt</button>
        </div>
      </div>
    </div>
  );
}
