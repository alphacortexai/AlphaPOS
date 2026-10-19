import type { SalesDigest } from '../pos/salesEmail';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char] || char));

const money = (value: number) => `UGX ${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(Math.round(value))}`;

export const salesReportSubject = (digest: SalesDigest) => `${digest.shopName} sales · ${digest.periodLabel}`;

export const salesReportText = (digest: SalesDigest) => {
  const lines = [
    `${digest.shopName}`,
    digest.periodLabel,
    '',
    `Sales: ${money(digest.revenue)}`,
    `Receipts: ${digest.receipts}`,
    `Tax on those sales: ${money(digest.tax)}`,
    `Expenses: ${money(digest.expenses)}`,
    `Sales minus expenses: ${money(digest.revenue - digest.expenses)}`,
    '',
  ];
  if (digest.topItems.length > 0) {
    lines.push('Top items');
    digest.topItems.forEach((item) => lines.push(`- ${item.name}: ${item.qty} · ${money(item.revenue)}`));
    lines.push('');
  } else {
    lines.push('No sales were recorded in this period.');
    lines.push('');
  }
  lines.push('This is a shop record from AlphaPOS. It is not a tax filing, and it does not move money.');
  return lines.join('\n');
};

export const salesReportHtml = (digest: SalesDigest) => {
  const items = digest.topItems.length > 0
    ? `<ul>${digest.topItems.map((item) => `<li>${escapeHtml(item.name)} · ${item.qty} · ${escapeHtml(money(item.revenue))}</li>`).join('')}</ul>`
    : '<p>No sales were recorded in this period.</p>';
  return `<!doctype html><html><body style="font-family:sans-serif;color:#172033">
    <p style="margin:0 0 4px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#66758c">AlphaPOS</p>
    <h1 style="font-size:22px;margin:0 0 4px">${escapeHtml(digest.shopName)}</h1>
    <p style="margin:0 0 16px;color:#66758c">${escapeHtml(digest.periodLabel)}</p>
    <p><strong>Sales:</strong> ${escapeHtml(money(digest.revenue))}<br>
    <strong>Receipts:</strong> ${digest.receipts}<br>
    <strong>Tax on those sales:</strong> ${escapeHtml(money(digest.tax))}<br>
    <strong>Expenses:</strong> ${escapeHtml(money(digest.expenses))}<br>
    <strong>Sales minus expenses:</strong> ${escapeHtml(money(digest.revenue - digest.expenses))}</p>
    <h2 style="font-size:16px">Top items</h2>
    ${items}
    <p style="color:#66758c;font-size:13px">This is a shop record from AlphaPOS. It is not a tax filing, and it does not move money.</p>
  </body></html>`;
};
