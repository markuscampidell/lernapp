export type Mark = 'ok' | 'bad' | 'pending';

/** Fortschrittsbalken beim Lernen: grün für richtig, rot für falsch (in der Reihenfolge der Antworten). */
export function ResultMeter({ total, marks }: { total: number; marks: Mark[] }) {
  const n = Math.max(1, total);
  // Gleiche Farben hintereinander zu einem Stück zusammenfassen, damit keine Nähte zu sehen sind.
  const runs: { mark: Mark; count: number }[] = [];
  for (const m of marks.slice(0, n)) {
    const last = runs[runs.length - 1];
    if (last && last.mark === m) last.count++;
    else runs.push({ mark: m, count: 1 });
  }
  const ok = marks.filter((m) => m === 'ok').length;
  const bad = marks.filter((m) => m === 'bad').length;
  return (
    <div className="meter wide result-meter" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={marks.length} aria-label={`${ok} richtig, ${bad} falsch, ${total} insgesamt`}>
      {runs.map((r, i) => (
        <div key={i} className={`meter-seg ${r.mark}`} style={{ width: `${(r.count / n) * 100}%` }} />
      ))}
    </div>
  );
}
