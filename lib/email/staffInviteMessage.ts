const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char] || char));

export type StaffInvite = {
  shopName: string;
  roleLabel: string;
  email: string;
  link: string;
  directSignIn: boolean;
};

export const staffInviteSubject = (invite: StaffInvite) => `You're invited to ${invite.shopName} as ${invite.roleLabel}`;

const inviteInstruction = (invite: StaffInvite) => invite.directSignIn
  ? 'Open this link on this device. It signs you in as this email address.'
  : 'Open this link and choose Google. Use this same email address. AlphaPOS does not create a password.';

export const staffInviteText = (invite: StaffInvite) => [
  `${invite.shopName} invited ${invite.email} as ${invite.roleLabel}.`,
  '',
  inviteInstruction(invite),
  invite.link,
].join('\n');

export const staffInviteHtml = (invite: StaffInvite) => `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1d1f">
  <p style="margin:0 0 10px;font-size:17px;font-weight:700;letter-spacing:-0.03em;color:#1d1d1f">Alpha<span style="color:#0071e3">POS</span></p>
  <h1 style="font-size:22px;margin:0 0 8px;letter-spacing:-0.02em">${escapeHtml(invite.shopName)}</h1>
  <p>You are invited as <strong>${escapeHtml(invite.roleLabel)}</strong> for <strong>${escapeHtml(invite.email)}</strong>.</p>
  <p><a href="${escapeHtml(invite.link)}" style="display:inline-block;background:#0071e3;color:#fff;text-decoration:none;padding:12px 18px;border-radius:980px;font-weight:600">Open AlphaPOS</a></p>
  <p style="color:#66758c;font-size:13px">${escapeHtml(inviteInstruction(invite))}</p>
</body></html>`;
