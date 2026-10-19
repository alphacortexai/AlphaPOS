import { NextResponse } from 'next/server';
import { salesReportHtml, salesReportSubject, salesReportText } from '../../../../lib/email/salesReportMessage';
import type { SalesDigest } from '../../../../lib/pos/salesEmail';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

const readDigest = (value: unknown): SalesDigest | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<SalesDigest>;
  const cadence = record.cadence === 'daily' || record.cadence === 'weekly' || record.cadence === 'monthly' ? record.cadence : null;
  const revenue = finite(record.revenue);
  const expenses = finite(record.expenses);
  const tax = finite(record.tax);
  const receipts = finite(record.receipts);
  if (!cadence || revenue === null || expenses === null || tax === null || receipts === null) return null;
  if (typeof record.shopName !== 'string' || typeof record.periodLabel !== 'string' || typeof record.periodKey !== 'string') return null;
  const topItems = Array.isArray(record.topItems) ? record.topItems.slice(0, 5).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { name?: unknown; qty?: unknown; revenue?: unknown };
    const qty = finite(row.qty);
    const itemRevenue = finite(row.revenue);
    if (typeof row.name !== 'string' || qty === null || itemRevenue === null) return [];
    return [{ name: row.name.slice(0, 80), qty, revenue: itemRevenue }];
  }) : [];
  return {
    shopName: record.shopName.slice(0, 80) || 'Shop',
    periodLabel: record.periodLabel.slice(0, 80),
    periodKey: record.periodKey.slice(0, 40),
    cadence,
    revenue,
    expenses,
    tax,
    receipts: Math.max(0, Math.round(receipts)),
    topItems,
  };
};

const callerEmail = async (idToken: string) => {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey || !idToken) return '';
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return '';
  const payload = await response.json() as { users?: { email?: string }[] };
  return payload.users?.[0]?.email?.trim().toLowerCase() || '';
};

export async function POST(request: Request) {
  let body: { idToken?: unknown; recipients?: unknown; digest?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'The report could not be read.' }, { status: 400 });
  }

  const digest = readDigest(body.digest);
  if (!digest) return NextResponse.json({ ok: false, error: 'The sales report is incomplete.' }, { status: 400 });

  const sender = await callerEmail(typeof body.idToken === 'string' ? body.idToken : '');
  if (!sender) return NextResponse.json({ ok: false, error: 'Sign in again before sending email.' }, { status: 401 });

  const requested = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients = [...new Set([sender, ...requested.map((email) => String(email || '').trim().toLowerCase())]
    .filter((email) => emailPattern.test(email)))].slice(0, 5);
  if (recipients.length === 0) return NextResponse.json({ ok: false, error: 'Add at least one email address.' }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 503 });
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject: salesReportSubject(digest),
      html: salesReportHtml(digest),
      text: salesReportText(digest),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json({ ok: false, error: detail.slice(0, 180) || 'The email service rejected the report.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true, recipients });
}
