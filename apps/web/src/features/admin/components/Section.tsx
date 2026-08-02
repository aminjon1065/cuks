/**
 * One titled block of the health screen.
 *
 * Extracted because the screen is assembled from two files — `HealthPage` and `JobRunsSection` —
 * and both need the same heading. Duplicated, the two copies drift the first time the heading
 * scale changes, and the jobs panel ends up looking like it belongs to a different page.
 */
export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text-muted">{title}</h2>
      {children}
    </section>
  );
}
