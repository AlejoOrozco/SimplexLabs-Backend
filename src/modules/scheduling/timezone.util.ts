/**
 * Minimal, dependency-free timezone helpers for the availability engine.
 *
 * We store absolute time (UTC) for appointments and blocked times, but
 * working hours are "HH:mm local" relative to a company's IANA timezone on
 * CompanySettings.timezone. These two helpers glue the two worlds together
 * and are DST-safe (double-offset lookup handles the spring-forward /
 * fall-back edges correctly).
 *
 * Intentionally NOT using luxon/moment to keep cold-start light.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday, 6 = Saturday. Matches schema `WorkingHours.dayOfWeek`. */
  dayOfWeek: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  let f = PARTS_FORMATTER_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hour12: false,
    });
    PARTS_FORMATTER_CACHE.set(tz, f);
  }
  return f;
}

/** Project a UTC instant onto the wall-clock parts of the given IANA zone. */
export function getZonedParts(date: Date, tz: string): ZonedParts {
  const parts = getFormatter(tz).formatToParts(date);
  const pick = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  // Intl renders midnight as "24" in some environments; normalize to "00".
  const hourStr = pick('hour');
  const hour = hourStr === '24' ? 0 : Number(hourStr);

  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour,
    minute: Number(pick('minute')),
    second: Number(pick('second')),
    dayOfWeek: WEEKDAY_MAP[pick('weekday')] ?? 0,
  };
}

/** UTC-ms offset of `tz` at the moment `date` represents. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = getZonedParts(date, tz);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - date.getTime();
}

/**
 * Build a UTC Date from a wall-clock time expressed in `tz`. DST-safe via
 * a second pass: the first offset lookup uses a naive UTC guess; the second
 * re-computes the offset at the corrected instant.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = tzOffsetMs(new Date(naiveUtc), tz);
  const off2 = tzOffsetMs(new Date(naiveUtc - off1), tz);
  return new Date(naiveUtc - off2);
}

/** Parse "HH:mm" → { h, m }. Caller has already validated format upstream. */
export function parseHHmm(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { h, m };
}

/**
 * Produce the sequence of calendar dates (year/month/day) that fall within
 * [fromUtc, toUtc) when projected into `tz`. Returns tz-local anchors so the
 * caller can build per-day working-hours intervals.
 */
export function enumerateZonedDates(
  fromUtc: Date,
  toUtc: Date,
  tz: string,
): { year: number; month: number; day: number; dayOfWeek: number }[] {
  if (toUtc <= fromUtc) return [];

  const startParts = getZonedParts(fromUtc, tz);
  const endParts = getZonedParts(toUtc, tz);

  const out: {
    year: number;
    month: number;
    day: number;
    dayOfWeek: number;
  }[] = [];
  let { year, month, day } = startParts;

  // Walk calendar days until we pass the end date (inclusive of end date if
  // the window actually covers any portion of it).
  // Safety cap prevents infinite loops from pathological inputs.
  for (let safety = 0; safety < 400; safety += 1) {
    const anchor = zonedWallTimeToUtc(year, month, day, 0, 0, tz);
    const parts = getZonedParts(anchor, tz);
    out.push({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      dayOfWeek: parts.dayOfWeek,
    });
    if (
      parts.year > endParts.year ||
      (parts.year === endParts.year && parts.month > endParts.month) ||
      (parts.year === endParts.year &&
        parts.month === endParts.month &&
        parts.day >= endParts.day)
    ) {
      break;
    }
    // Advance one calendar day in tz.
    const nextAnchor = new Date(anchor.getTime() + 26 * 60 * 60 * 1000);
    const nextParts = getZonedParts(nextAnchor, tz);
    year = nextParts.year;
    month = nextParts.month;
    day = nextParts.day;
  }

  return out;
}
