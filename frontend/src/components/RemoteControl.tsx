import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onMediaControl: (action: string, value?: number) => void;
  title?: string;
  poster?: string;
  isPlaying?: boolean;
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

export function RemoteControl({ onMediaControl, title, poster, isPlaying }: Props) {
  const [status, setStatus] = useState<MediaStatus>({ currentTime: 0, duration: 0, paused: true, volume: 50, muted: false });
  const [displayTime, setDisplayTime] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const tickRef = useRef<ReturnType<typeof setInterval>>();

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
        const ct = data.currentTime || 0;
        const dur = data.duration || 0;
        if (ct === 0 && dur === 0 && status.duration > 0) return;
        setStatus({ currentTime: ct, duration: dur, paused: data.paused ?? true, volume: data.volume ?? 50, muted: data.muted ?? false });
        setDisplayTime(ct);
      }
    };
    window.addEventListener("media_status" as any, handler as any);
    return () => window.removeEventListener("media_status" as any, handler as any);
  }, [status.duration]);

  useEffect(() => {
    if (!isPlaying || status.paused || status.duration <= 0) {
      clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => {
      setDisplayTime((t) => Math.min(t + 1, status.duration));
    }, 1000);
    return () => clearInterval(tickRef.current);
  }, [isPlaying, status.paused, status.duration]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDragTime(parseFloat(e.target.value));
    setDragging(true);
  }, []);

  const handleSliderCommit = useCallback(() => {
    onMediaControl("seek_to", dragTime);
    setDragging(false);
  }, [onMediaControl, dragTime]);

  const currentPos = dragging ? dragTime : displayTime;
  const progress = status.duration > 0 ? (currentPos / status.duration) * 100 : 0;
  const active = !!isPlaying;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "var(--bg-base)", alignItems: "center", justifyContent: "center",
      padding: 24, gap: 20,
    }}>
      {/* Poster */}
      {poster ? (
        <img src={poster} alt="" style={{
          width: 160, height: 90, objectFit: "cover", borderRadius: 10,
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }} />
      ) : (
        <div style={{
          width: 160, height: 90, borderRadius: 10, background: "var(--bg-elevated)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 40, height: 40, color: "var(--text-muted)" }}>
            <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 8v8l6-4-6-4z" fill="currentColor" opacity="0.5" />
          </svg>
        </div>
      )}

      {/* Title */}
      <div style={{
        fontSize: 16, fontWeight: 700, color: active ? "var(--text-primary)" : "var(--text-muted)",
        textAlign: "center", maxWidth: "90%",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {active ? (title || "Now Playing") : "Not Playing"}
      </div>

      {/* Progress bar */}
      {active && (
        <div style={{ width: "100%", maxWidth: 360 }}>
          <div style={{ position: "relative", height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3 }}>
            <div style={{
              width: `${progress}%`, height: "100%", background: "var(--accent)",
              borderRadius: 3, transition: dragging ? "none" : "width 0.3s",
            }} />
            <input
              type="range" min={0} max={status.duration || 100} step={1}
              value={currentPos}
              onChange={handleSliderChange}
              onMouseUp={handleSliderCommit}
              onTouchEnd={handleSliderCommit}
              style={{
                position: "absolute", top: -8, left: 0, width: "100%", height: 24,
                opacity: 0, cursor: "pointer", margin: 0,
              }}
            />
          </div>
          <div style={{
            display: "flex", justifyContent: "space-between", marginTop: 6,
            fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums",
          }}>
            <span>{formatTime(currentPos)}</span>
            <span>{formatTime(status.duration)}</span>
          </div>
        </div>
      )}

      {/* Main controls — big buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={() => active && onMediaControl("seek_backward", 10)} disabled={!active} style={bigBtn(active)}>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 28, height: 28 }}>
            <rect x="4" y="5" width="2.5" height="14" rx="0.5" />
            <path d="M20 5l-12 7 12 7V5z" />
          </svg>
        </button>

        <button
          onClick={() => {
            if (!active) return;
            onMediaControl(status.paused ? "resume" : "pause");
          }}
          disabled={!active}
          style={{
            ...bigBtn(active),
            width: 72, height: 72,
            background: active ? "var(--accent)" : "var(--bg-elevated)",
            color: active ? "#fff" : "var(--text-muted)",
          }}
        >
          {status.paused ? (
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 36, height: 36, marginLeft: 3 }}>
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 36, height: 36 }}>
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          )}
        </button>

        <button onClick={() => active && onMediaControl("seek_forward", 10)} disabled={!active} style={bigBtn(active)}>
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 28, height: 28 }}>
            <path d="M4 5l12 7-12 7V5z" />
            <rect x="17.5" y="5" width="2.5" height="14" rx="0.5" />
          </svg>
        </button>
      </div>

      {/* Volume controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <button onClick={() => active && onMediaControl("volume_down", 10)} disabled={!active} style={medBtn(active)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 22, height: 22 }}>
            {status.volume <= 0 || status.muted ? (
              <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
            ) : (
              <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><line x1="23" y1="12" x2="17" y2="12" /></>
            )}
          </svg>
        </button>

        <div style={{
          width: 120, height: 6, background: "rgba(255,255,255,0.1)", borderRadius: 3,
          position: "relative",
        }}>
          <div style={{
            width: `${status.muted ? 0 : status.volume}%`, height: "100%",
            background: "var(--text-secondary)", borderRadius: 3, transition: "width 0.2s",
          }} />
        </div>

        <button onClick={() => active && onMediaControl("volume_up", 10)} disabled={!active} style={medBtn(active)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 22, height: 22 }}>
            <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
            <line x1="17" y1="12" x2="23" y2="12" />
            <line x1="20" y1="9" x2="20" y2="15" />
          </svg>
        </button>

        <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 36, textAlign: "center" }}>
          {status.muted ? "Mute" : `${status.volume}%`}
        </span>
      </div>
    </div>
  );
}

function bigBtn(active: boolean): React.CSSProperties {
  return {
    width: 56, height: 56, borderRadius: "50%", border: "none",
    background: active ? "var(--bg-elevated)" : "var(--bg-surface)",
    color: active ? "var(--text-primary)" : "rgba(255,255,255,0.2)",
    cursor: active ? "pointer" : "default",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
    transition: "background 0.15s",
  };
}

function medBtn(active: boolean): React.CSSProperties {
  return {
    width: 44, height: 44, borderRadius: "50%", border: "none",
    background: "transparent",
    color: active ? "var(--text-secondary)" : "rgba(255,255,255,0.2)",
    cursor: active ? "pointer" : "default",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
  };
}
