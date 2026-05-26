/** Date helpers. Entries are bucketed by the user's *local* day. */

export const ymd = (d = new Date()): string => {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return tz.toISOString().slice(0, 10);
};

const DAY_MS = 86_400_000;

export const shiftYmd = (date: string, days: number): string =>
  ymd(new Date(new Date(date + "T00:00:00").getTime() + days * DAY_MS));
