"use client";

import { useMemo } from "react";

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export default function CommitGraph() {
  const cells = useMemo(() => {
    const rand = seededRandom(42);
    return Array.from({ length: 16 }, () =>
      Array.from({ length: 7 }, () => rand())
    );
  }, []);

  return (
    <div className="flex gap-[2px] overflow-hidden" role="img" aria-label="Commit activity heatmap showing 16 weeks of contributions">
      {cells.map((week, w) => (
        <div key={w} className="flex flex-col gap-[2px]">
          {week.map((i, d) => (
            <div
              key={d}
              className="h-[6px] w-[6px] rounded-[1px]"
              style={{
                background:
                  i > 0.7
                    ? "#8b5cf6"
                    : i > 0.4
                      ? "#5b21b6"
                      : i > 0.15
                        ? "#3b0764"
                        : "rgba(255,255,255,0.03)",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
