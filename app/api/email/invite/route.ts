import { NextResponse } from 'next/server';
import { cleanEmailFrom, explainResendFailure, resendFailureStatus } from '../../../../lib/email/resendError';
import { staffInviteHtml, staffInviteSubject, staffInviteText } from '../../../../lib/email/staffInviteMessage';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  let body: { idToken?: unknown; email?: unknown; roleLabel?: unknown; shopName?: unknown; link?: unknown; directSignIn?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'The invite could not be read.' }, { status: 400 });
  }

  const sender = await callerEmail(typeof body.idToken === 'string' ? body.idToken : '');
  if (!sender) return NextResponse.json({ ok: false, error: 'Sign in again before sending email.' }, { status: 401 });

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const roleLabel = typeof body.roleLabel === 'string' ? body.roleLabel.slice(0, 40) : '';
  const shopName = typeof body.shopName === 'string' ? body.shopName.slice(0, 80) : '';
  const link = typeof body.link === 'string' ? body.link.trim() : '';
  if (!emailPattern.test(email) || !roleLabel || !shopName || link.length > 4000 || !(link.startsWith('https://') || link.startsWith('http://'))) {
    return NextResponse.json({ ok: false, error: 'The invite is incomplete.' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = cleanEmailFrom(process.env.EMAIL_FROM);
  if (!apiKey || !from) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 503 });

  const invite = { email, roleLabel, shopName, link, directSignIn: body.directSignIn === true };
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: staffInviteSubject(invite),
        html: staffInviteHtml(invite),
        text: staffInviteText(invite),
      }),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'The email service could not be reached. Try again in a moment.' }, { status: 502 });
  }
  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json({ ok: false, error: explainResendFailure(response.status, detail) }, { status: resendFailureStatus(response.status) });
  }
  return NextResponse.json({ ok: true });
}
