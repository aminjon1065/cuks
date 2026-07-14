const DAY_MS = 86_400_000;
const REPORT_DELAY_MS = 15 * 60_000;

/** Stable chronology for map fixtures: a report always follows occurrence. */
export function mapIncidentTimes(
  anchorMs: number,
  index: number,
): {
  occurredAt: Date;
  reportedAt: Date;
} {
  const reportedAt = new Date(anchorMs - index * DAY_MS);
  return {
    occurredAt: new Date(reportedAt.getTime() - REPORT_DELAY_MS),
    reportedAt,
  };
}
