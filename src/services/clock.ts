export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type DayPeriod = 'weekday' | 'weekend';

export interface ClockContext {
  now: Date;
  timeOfDay: TimeOfDay;
  dayPeriod: DayPeriod;
  hour: number;
  dayName: string;
  greeting: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function getClockContext(): ClockContext {
  const now = new Date();
  const hour = now.getHours();
  const dow = now.getDay();

  const timeOfDay: TimeOfDay =
    hour >= 5  && hour < 12 ? 'morning'   :
    hour >= 12 && hour < 17 ? 'afternoon' :
    hour >= 17 && hour < 21 ? 'evening'   : 'night';

  const dayPeriod: DayPeriod = (dow === 0 || dow === 6) ? 'weekend' : 'weekday';

  const greeting =
    timeOfDay === 'morning'   ? 'Good morning' :
    timeOfDay === 'afternoon' ? 'Good afternoon' :
    timeOfDay === 'evening'   ? 'Good evening' : 'Hey';

  return { now, timeOfDay, dayPeriod, hour, dayName: DAY_NAMES[dow]!, greeting };
}
