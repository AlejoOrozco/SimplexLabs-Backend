export interface CalendarEventDto {
  id: string;
  title: string;
  start: string;
  end: string;
  extendedProps: Record<string, unknown>;
  editable: boolean;
}

export interface CheckAvailabilityResult {
  available: boolean;
  conflicts: Array<{ id: string; title: string; scheduledAt: Date }>;
  withinWorkingHours: boolean;
  workingHoursReason?: string;
}
