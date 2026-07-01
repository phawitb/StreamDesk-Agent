import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState } from "../types/messages";

interface Props {
  onMediaControl: (action: string, value?: number) => void;
  title?: string;
  poster?: string;
  isPlaying?: boolean;
  monitorMode?: "inapp" | "device" | "url";
  currentState?: AgentState;
}

interface MediaStatus {
  currentTime: number;
  duration: number;
  paused: boolean;
  volume: number;
  muted: boolean;
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const WAITING_STATES = new Set<string>(["launching", "navigating", "loading_player"]);

export function MediaControls({ onMediaControl, title, poster, isPlaying, monitorMode = "device", currentState = "idle" }: Props) {
  const [status, setStatus] = useState<MediaStatus>({ currentTime: 0, duration: 0, paused: false, volume: 50, muted: false });
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const titleRef = useRef<HTMLDivElement>(null);
  const [needsMarquee, setNeedsMarquee] = useState(false);

  const isWaiting = WAITING_STATES.has(currentState);
  const active = !!isPlaying;

  useEffect(() => {
    if (!isPlaying) return;
    const poll = () => onMediaControl("get_status");
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [onMediaControl, isPlaying]);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const data = e.detail;
      if (data.type === "media_status") {
        setStatus({ currentTime: data.currentTime || 0, duration: data.duration || 0, paused: data.paused ?? false, volume: data.volume ?? 50, muted: data.muted ?? false });
      }
    };
    window.addEventListener("media_status" as any, handler as any);
    return () => window.removeEventListener("media_status" as any, handler as any);
  }, []);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const prev = el.style.overflow;
    el.style.overflow = "visible";
    const overflows = el.scrollWidth > el.clientWidth;
    el.style.overflow = prev;
    setNeedsMarquee(overflows);
  }, [title, isPlaying]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDragTime(parseFloat(e.target.value));
    setDragging(true);
  }, []);

  const handleSliderCommit = useCallback(() => {
    onMediaControl("seek_to", dragTime);
    setDragging(false);
  }, [onMediaControl, dragTime]);

  const progress = status.duration > 0 ? ((dragging ? dragTime : status.currentTime) / status.duration) * 100 : 0;

  // Display text logic
  let displayText: React.ReactNode;
  if (active) {
    if (needsMarquee) {
      displayText = (
        <span className="np-marquee-track">
          <span>{title}</span>
          <span aria-hidden="true">{title}</span>
        </span>
      );
    } else {
      displayText = title || "Now Playing";
    }
  } else if (isWaiting) {
    displayText = <span className="np-waiting">Waiting...</span>;
  } else {
    displayText = "Not Playing";
  }

  const controlsActive = active || isWaiting;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Progress bar */}
      <div style={{ height: 3, background: "rgba(255,255,255,0.08)", flexShrink: 0, position: "relative" }}>
        <div style={{
          width: `${progress}%`,
          height: "100%",
          background: "var(--accent)",
          transition: dragging ? "none" : "width 0.3s",
        }} />
        <input
          type="range"
          min={0}
          max={status.duration || 100}
          step={1}
          value={dragging ? dragTime : status.currentTime}
          onChange={handleSliderChange}
          onMouseUp={handleSliderCommit}
          onTouchEnd={handleSliderCommit}
          disabled={!active}
          style={{
            position: "absolute", top: -6, left: 0, width: "100%", height: 16,
            opacity: 0, cursor: active ? "pointer" : "default", margin: 0,
          }}
        />
      </div>

      {/* Main controls row */}
      <div style={{ display: "flex", alignItems: "center", flex: 1, padding: "0 12px", gap: 8 }}>
        {/* Poster thumbnail */}
        <div style={{
          width: 40, height: 40, borderRadius: 4, overflow: "hidden", flexShrink: 0,
          background: "var(--bg-elevated)",
        }}>
          {poster ? (
            <img src={poster} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20, color: "var(--text-muted)" }}>
                <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 8v8l6-4-6-4z" fill="currentColor" opacity="0.5" />
              </svg>
            </div>
          )}
        </div>

        {/* Title + time */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            ref={titleRef}
            style={{
              fontSize: 13, fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap",
              color: (active || isWaiting) ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {displayText}
          </div>
          {active && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>
              {formatTime(dragging ? dragTime : status.currentTime)} / {formatTime(status.duration)}
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          {/* Backward |< */}
          <button onClick={() => active && onMediaControl("seek_backward", 10)} disabled={!active} style={controlBtn(active)}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
              <rect x="4" y="5" width="2.5" height="14" rx="0.5" />
              <path d="M20 5l-12 7 12 7V5z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={() => active && onMediaControl(status.paused ? "resume" : "pause")}
            disabled={!active}
            style={{
              width: 36, height: 36, borderRadius: "50%", border: "none",
              background: active ? "#fff" : "rgba(255,255,255,0.15)",
              color: "var(--bg-base)", cursor: active ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
            }}
          >
            {!active || status.paused ? (
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16, marginLeft: 2 }}><path d="M8 5v14l11-7z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            )}
          </button>

          {/* Forward >| */}
          <button onClick={() => active && onMediaControl("seek_forward", 10)} disabled={!active} style={controlBtn(active)}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16 }}>
              <path d="M4 5l12 7-12 7V5z" />
              <rect x="17.5" y="5" width="2.5" height="14" rx="0.5" />
            </svg>
          </button>

          {/* Volume remote — external monitor only */}
          {monitorMode !== "inapp" && controlsActive && (
            <>
              <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
              <button
                onClick={() => active && onMediaControl("volume_down", 10)}
                disabled={!active}
                style={controlBtn(active)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                  {status.volume <= 0 || status.muted ? (
                    <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
                  ) : (
                    <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><line x1="23" y1="12" x2="17" y2="12" /></>
                  )}
                </svg>
              </button>
              <button
                onClick={() => active && onMediaControl("volume_up", 10)}
                disabled={!active}
                style={controlBtn(active)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                  <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
                  <line x1="17" y1="12" x2="23" y2="12" />
                  <line x1="20" y1="9" x2="20" y2="15" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`
        .np-marquee-track {
          display: inline-flex;
          animation: npMarquee 14s linear infinite;
        }
        .np-marquee-track span {
          flex-shrink: 0;
          padding-right: 48px;
        }
        @keyframes npMarquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .np-waiting {
          animation: npBlink 1.2s ease-in-out infinite;
        }
        @keyframes npBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

function controlBtn(active: boolean): React.CSSProperties {
  return {
    width: 34, height: 34, borderRadius: "50%", border: "none",
    background: "transparent",
    color: active ? "var(--text-secondary)" : "rgba(255,255,255,0.2)",
    cursor: active ? "pointer" : "default",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
  };
}
