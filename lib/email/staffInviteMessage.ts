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
};

export const staffInviteSubject = (invite: StaffInvite) => `You're invited to ${invite.shopName} as ${invite.roleLabel}`;

export const staffInviteText = (invite: StaffInvite) => [
  `${invite.shopName} invited ${invite.email} as ${invite.roleLabel}.`,
  '',
  'Open this link and sign in with that same email address:',
  invite.link,
  '',
  'Google sign-in works when the Google account uses this email. AlphaPOS does not create a separate password.',
].join('\n');

export const staffInviteHtml = (invite: StaffInvite) => `<!doctype html><html><body style="font-family:sans-serif;color:#172033">
  <p style="margin:0 0 4px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#66758c">AlphaPOS</p>
  <h1 style="font-size:22px;margin:0 0 8px">${escapeHtml(invite.shopName)}</h1>
  <p>You are invited as <strong>${escapeHtml(invite.roleLabel)}</strong>. Sign in with <strong>${escapeHtml(invite.email)}</strong>.</p>
  <p><a href="${escapeHtml(invite.link)}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px">Open AlphaPOS</a></p>
  <p style="color:#66758c;font-size:13px">Use Google with this same address if that is how you sign in. AlphaPOS does not create a password.</p>
</body></html>`;
