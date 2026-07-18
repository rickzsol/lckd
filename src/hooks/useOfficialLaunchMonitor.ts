"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseOfficialLaunchResponse,
  type OfficialLaunchEvent,
} from "@/lib/launchMonitor";

interface MonitorRevision {
  epoch: string;
  version: number;
}

export function useOfficialLaunchMonitor(
  initialLaunch: OfficialLaunchEvent | null,
  monitorUrl: string | null,
) {
  const [launch, setLaunch] = useState(initialLaunch);
  const [isLive, setIsLive] = useState(false);
  const revision = useRef<MonitorRevision | null>(null);

  useEffect(() => {
    if (!monitorUrl) return;
    const applyState = (value: unknown) => {
      const parsed = parseOfficialLaunchResponse(value);
      if (!parsed) return;
      const current = revision.current;
      if (current?.epoch === parsed.epoch && parsed.version < current.version) return;
      revision.current = { epoch: parsed.epoch, version: parsed.version };
      setLaunch(parsed.launch);
    };
    const refresh = async () => {
      try {
        const response = await fetch(`${monitorUrl}/latest`, { cache: "no-store" });
        if (response.ok) applyState(await response.json());
      } catch {
        return;
      }
    };

    const source = new EventSource(`${monitorUrl}/events`);
    source.onopen = () => setIsLive(true);
    source.onerror = () => setIsLive(false);
    source.addEventListener("state", (event) => {
      try {
        applyState(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        return;
      }
    });
    void refresh();
    const interval = window.setInterval(() => {
      if (source.readyState !== EventSource.OPEN) void refresh();
    }, 10_000);
    return () => {
      window.clearInterval(interval);
      source.close();
    };
  }, [monitorUrl]);

  return { isLive, launch };
}
