export const EARLY_ARRIVAL_MINUTES = 10;
export const LATE_AFTER_MINUTES = 15;

export function arrivalOpensAt(startsAt: string | Date): number {
  return new Date(startsAt).getTime() - EARLY_ARRIVAL_MINUTES * 60000;
}
export function arrivalAllowed(
  meeting: { status: string; starts_at: string | Date },
  now = Date.now(),
): boolean {
  return meeting.status === "OPEN" && now >= arrivalOpensAt(meeting.starts_at);
}
export function departureAllowed(status: string): boolean {
  return status === "OPEN" || status === "CLOSED";
}
export function isLate(
  checkIn: string | Date,
  startsAt: string | Date,
): boolean {
  return (
    new Date(checkIn).getTime() >
    new Date(startsAt).getTime() + LATE_AFTER_MINUTES * 60000
  );
}
