export const cleanEmailFrom = (value: string | undefined) => (value || '').trim().replace(/^['"]+|['"]+$/g, '');

export const explainResendFailure = (status: number, body: string) => {
  let message = '';
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    message = typeof parsed.message === 'string' ? parsed.message : typeof parsed.error === 'string' ? parsed.error : '';
  } catch {
    message = body;
  }
  const text = message.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  if (lower.includes('not verified') || lower.includes('verify a domain') || lower.includes('verify your domain')) {
    return 'Resend has not verified the sender domain yet. In Resend, open Domains, copy those DNS records into Namecheap Advanced DNS, click Verify, then send again. EMAIL_FROM can use reports@yourshop.com only after that domain shows Verified.';
  }
  if (lower.includes('testing emails') || lower.includes('your own email')) {
    return 'Resend is still in test mode, so it only delivers to the email address on the Resend account. Verify the shop domain, then try again. Until then, remove the extra recipients and send only to that Resend account email.';
  }
  if (lower.includes('from') && (lower.includes('invalid') || lower.includes('missing'))) {
    return 'EMAIL_FROM is not an address Resend can send from. Set it to AlphaPOS <reports@yourshop.com> with no extra quotes, on a domain that shows Verified in Resend.';
  }
  if (status === 401 || lower.includes('api key')) {
    return 'Resend rejected the API key. Check RESEND_API_KEY in the server environment, then redeploy.';
  }
  if (text) return text.slice(0, 240);
  return 'The email service rejected the message.';
};

export const resendFailureStatus = (status: number) => (status >= 500 || status <= 0 ? 502 : 422);
