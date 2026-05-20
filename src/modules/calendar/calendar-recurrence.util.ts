import {
  CreateRecurringDto,
  RecurrenceFrequency,
} from './dto/create-recurring.dto';

export function buildRecurrenceRRule(dto: CreateRecurringDto): string {
  let rule = `FREQ=${dto.frequency}`;
  if (dto.count) rule += `;COUNT=${dto.count}`;
  if (dto.endDate) {
    const until = new Date(dto.endDate)
      .toISOString()
      .replace(/[-:]/g, '')
      .split('.')[0];
    rule += `;UNTIL=${until}Z`;
  }
  if (
    dto.frequency === RecurrenceFrequency.WEEKLY &&
    dto.dayOfWeek !== undefined
  ) {
    const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    rule += `;BYDAY=${days[dto.dayOfWeek]}`;
  }
  return rule;
}

export function generateRecurrenceOccurrences(
  start: Date,
  dto: CreateRecurringDto,
): Date[] {
  const dates: Date[] = [new Date(start)];
  const endDate = dto.endDate ? new Date(dto.endDate) : null;
  const total = dto.count;

  for (let i = 1; i < total; i += 1) {
    const prev = dates[dates.length - 1];
    const next = new Date(prev);

    if (dto.frequency === RecurrenceFrequency.DAILY) {
      next.setUTCDate(next.getUTCDate() + 1);
    } else if (dto.frequency === RecurrenceFrequency.WEEKLY) {
      next.setUTCDate(next.getUTCDate() + 7);
    } else if (dto.frequency === RecurrenceFrequency.MONTHLY) {
      next.setUTCMonth(next.getUTCMonth() + 1);
    }

    if (endDate && next > endDate) break;
    dates.push(next);
  }

  return dates;
}
