"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const COMMANDS = [
  "trudev verify --lock --ship",
  "trudev launch --vesting 90d",
  "trudev status --trust-tier",
  "trudev connect --github --wallet",
  "trudev lock --amount 10% --stream",
];

const TYPE_SPEED = 50;
const ERASE_SPEED = 25;
const PAUSE_AFTER_TYPE = 2400;
const PAUSE_AFTER_ERASE = 400;

export default function HeroTerminal() {
  const [typed, setTyped] = useState("");
  const [isTyping, setIsTyping] = useState(true);
  const cmdIdx = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    let charPos = 0;
    let phase: "typing" | "paused" | "erasing" | "gap" = "typing";
    let currentCmd = COMMANDS[0];

    const tick = () => {
      switch (phase) {
        case "typing": {
          if (charPos <= currentCmd.length) {
            setTyped(currentCmd.slice(0, charPos));
            charPos++;
            timerRef.current = setTimeout(tick, TYPE_SPEED);
          } else {
            setIsTyping(false);
            phase = "paused";
            timerRef.current = setTimeout(tick, PAUSE_AFTER_TYPE);
          }
          break;
        }
        case "paused": {
          setIsTyping(true);
          phase = "erasing";
          charPos = currentCmd.length;
          timerRef.current = setTimeout(tick, ERASE_SPEED);
          break;
        }
        case "erasing": {
          if (charPos > 0) {
            charPos--;
            setTyped(currentCmd.slice(0, charPos));
            timerRef.current = setTimeout(tick, ERASE_SPEED);
          } else {
            phase = "gap";
            timerRef.current = setTimeout(tick, PAUSE_AFTER_ERASE);
          }
          break;
        }
        case "gap": {
          cmdIdx.current = (cmdIdx.current + 1) % COMMANDS.length;
          currentCmd = COMMANDS[cmdIdx.current];
          charPos = 0;
          phase = "typing";
          timerRef.current = setTimeout(tick, TYPE_SPEED);
          break;
        }
      }
    };

    timerRef.current = setTimeout(tick, TYPE_SPEED);
    return clear;
  }, [clear]);

  return (
    <div className="mb-5 inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-emerald-accent/15 bg-emerald-accent/[0.06] px-3.5 py-1.5 font-mono text-[clamp(11px,2.5vw,14px)] text-emerald-accent">
      <span className="text-[#555]">$ </span>
      {typed}
      <span
        className={`text-emerald-accent ${isTyping ? "" : "animate-[cursor-blink_1.06s_step-end_infinite]"}`}
        style={isTyping ? { opacity: 1 } : undefined}
      >
        &#9610;
      </span>
    </div>
  );
}
