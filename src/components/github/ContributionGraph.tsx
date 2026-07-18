"use client";

import { useEffect, useState } from "react";

interface ContributionDay {
  date: string;
  level: number;
}

interface ContributionData {
  total: number | null;
  days: ContributionDay[];
}

const GAP_PX = 2;
const MIN_GRID_WIDTH_PX = 530;

const LEVEL_CLASSES = [
  "bg-white/[0.05]",
  "bg-accent-700/50",
  "bg-accent-700",
  "bg-accent-600",
  "bg-accent",
] as const;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function buildWeeks(days: ContributionDay[]): ContributionDay[][] {
  const weeks: ContributionDay[][] = [];
  for (const day of days) {
    const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
    if (weeks.length === 0 || weekday === 0) weeks.push([]);
    weeks[weeks.length - 1].push(day);
  }
  return weeks;
}

function monthLabels(weeks: ContributionDay[][]): { label: string; col: number }[] {
  const labels: { label: string; col: number }[] = [];
  let prevMonth = -1;
  weeks.forEach((week, col) => {
    const month = new Date(`${week[0].date}T00:00:00Z`).getUTCMonth();
    if (month !== prevMonth) {
      // Drop a first label that would collide with the next month marker
      if (labels.length === 1 && col - labels[0].col < 3) labels.pop();
      labels.push({ label: MONTH_NAMES[month], col });
      prevMonth = month;
    }
  });
  return labels;
}

export default function ContributionGraph({ username }: { username: string }) {
  const [data, setData] = useState<ContributionData | null>(null);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    let isActive = true;
    fetch(`/api/v1/github/contributions?username=${encodeURIComponent(username)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Contributions unavailable");
        return response.json();
      })
      .then((payload: ContributionData) => {
        if (isActive) setData(payload);
      })
      .catch(() => {
        if (isActive) setHasFailed(true);
      });
    return () => {
      isActive = false;
    };
  }, [username]);

  if (hasFailed) return null;

  if (!data) {
    return (
      <div className="mt-4 h-[104px] animate-pulse rounded-control bg-surface-2" aria-hidden="true" />
    );
  }

  const weeks = buildWeeks(data.days);
  const labels = monthLabels(weeks);

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-3">
          Contribution activity
        </span>
        {data.total !== null && (
          <span className="font-mono text-[10px] tabular-nums text-text-4">
            {data.total.toLocaleString("en-US")} in the last year
          </span>
        )}
      </div>

      <div className="overflow-x-auto pb-1">
        <div style={{ minWidth: `${MIN_GRID_WIDTH_PX}px` }}>
          <div className="relative h-[14px]" aria-hidden="true">
            {labels.map(({ label, col }) => (
              <span
                key={`${label}-${col}`}
                className="absolute top-0 font-mono text-[9px] text-text-4"
                style={{ left: `${(col / weeks.length) * 100}%` }}
              >
                {label}
              </span>
            ))}
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
              gap: `${GAP_PX}px`,
            }}
            role="img"
            aria-label={`GitHub contribution calendar for ${username}`}
          >
            {weeks.flatMap((week, colIdx) =>
              week.map((day) => (
                <span
                  key={day.date}
                  title={day.date}
                  className={`aspect-square w-full rounded-[2px] ${LEVEL_CLASSES[day.level] ?? LEVEL_CLASSES[0]}`}
                  style={{
                    gridColumnStart: colIdx + 1,
                    gridRowStart: new Date(`${day.date}T00:00:00Z`).getUTCDay() + 1,
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1.5 font-mono text-[9px] text-text-4">
        <span>less</span>
        {LEVEL_CLASSES.map((cls) => (
          <span key={cls} className={`h-2 w-2 rounded-[2px] ${cls}`} />
        ))}
        <span>more</span>
      </div>
    </div>
  );
}
