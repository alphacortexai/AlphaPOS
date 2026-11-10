import { businessDayKey, businessDayRange, shiftDayKey, type ShopClock } from './reports';

export const HISTORICAL_DAYS = 92;

export type HistoricalPlan = {
  ok: true;
  backdated: boolean;
  createdAt: string;
  enteredAt: string;
  backdateReason?: string;
};

export type HistoricalRefusal = { ok: false; error: string };

/** A live sale is dated now. A missed sale keeps the day it happened, and records when it was typed in. */
export const planHistoricalEntry = (input: {
  dayKey: string;
  now: Date;
  clock: ShopClock;
  reason: string;
}): HistoricalPlan | HistoricalRefusal => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dayKey)) return { ok: false, error: 'Choose the day this happened.' };
  const today = businessDayKey(input.now, input.clock);
  if (input.dayKey > today) return { ok: false, error: 'That day has not happened yet.' };
  const enteredAt = input.now.toISOString();
  if (input.dayKey === today) return { ok: true, backdated: false, createdAt: enteredAt, enteredAt };
  const oldest = shiftDayKey(today, -(HISTORICAL_DAYS - 1));
  if (input.dayKey < oldest) return { ok: false, error: `A missed entry can go back ${HISTORICAL_DAYS} days. Older than that needs the shop books adjusted by hand.` };
  const reason = input.reason.trim().replace(/\s+/g, ' ').slice(0, 180);
  if (reason.length < 8) return { ok: false, error: 'Write why this was not entered on the day it happened.' };
  const createdAt = new Date(businessDayRange(input.dayKey, input.clock).start.getTime() + 60 * 60 * 1000).toISOString();
  return { ok: true, backdated: true, createdAt, enteredAt, backdateReason: reason };
};
