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

export function MediaControls({ onMediaControl, title, poster, isPlaying }: Props) {
  const [status, setStatus] = useState<MediaStatus>({ currentTime: 0, duration: 0, paused: false, volume: 50, muted: false });
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const [showVolume, setShowVolume] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const titleRef = useRef<HTMLDivElement>(null);
  const [needsMarquee, setNeedsMarquee] = useState(false);

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

  // Check if title overflows and needs marquee
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    // Temporarily remove overflow to measure true scrollWidth
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

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value);
    // We need a way to set volume — use volume_up/down relative, or add set_volume
    // For now, mute/unmute based on 0 threshold, and use the value
    onMediaControl("set_volume", vol);
  }, [onMediaControl]);

  const progress = status.duration > 0 ? ((dragging ? dragTime : status.currentTime) / status.duration) * 100 : 0;
  const active = !!isPlaying;
  const volumePercent = status.muted ? 0 : status.volume;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Progress bar at top of the bar */}
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
              color: active ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {needsMarquee && active ? (
              <span className="np-marquee-track">
                <span>{title}</span>
                <span aria-hidden="true">{title}</span>
              </span>
            ) : (
              active ? (title || "Now Playing") : "Not Playing"
            )}
          </div>
          {active && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>
              {formatTime(dragging ? dragTime : status.currentTime)} / {formatTime(status.duration)}
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
          {/* Backward 10s */}
          <button onClick={() => active && onMediaControl("seek_backward", 10)} disabled={!active} style={controlBtn(active)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
              <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 105.64-8.36L1 10" />
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

          {/* Forward 10s */}
          <button onClick={() => active && onMediaControl("seek_forward", 10)} disabled={!active} style={controlBtn(active)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
              <path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 11-5.64-8.36L23 10" />
            </svg>
          </button>

          {/* Volume button — toggles volume slider */}
          <button
            onClick={() => {
              if (!active) return;
              setShowVolume(!showVolume);
            }}
            disabled={!active}
            style={controlBtn(active)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
              {status.muted || volumePercent === 0 ? (
                <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
              ) : volumePercent < 50 ? (
                <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><path d="M15.54 8.46a5 5 0 010 7.07" /></>
              ) : (
                <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><path d="M15.54 8.46a5 5 0 010 7.07" /><path d="M19.07 4.93a10 10 0 010 14.14" /></>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Volume slider row — slides down when toggled */}
      {showVolume && active && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "0 16px 6px", flexShrink: 0,
        }}>
          <button
            onClick={() => onMediaControl(status.muted ? "unmute" : "mute")}
            style={{
              border: "none", background: "transparent", padding: 0,
              color: status.muted ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              width: 20, height: 20,
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              {status.muted ? (
                <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
              ) : (
                <><polygon points="11,5 6,9 2,9 2,15 6,15 11,19" /><path d="M15.54 8.46a5 5 0 010 7.07" /></>
              )}
            </svg>
          </button>
          <div style={{ flex: 1, position: "relative", height: 20, display: "flex", alignItems: "center" }}>
            <div style={{
              position: "absolute", left: 0, right: 0, height: 3,
              background: "rgba(255,255,255,0.1)", borderRadius: 2,
            }}>
              <div style={{
                width: `${volumePercent}%`, height: "100%",
                background: "var(--text-primary)", borderRadius: 2,
              }} />
            </div>
            <input
              type="range" min={0} max={100} step={1}
              value={volumePercent}
              onChange={handleVolumeChange}
              style={{
                width: "100%", position: "relative", zIndex: 1,
                opacity: 0, cursor: "pointer", height: 20, margin: 0,
              }}
            />
          </div>
          <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {Math.round(volumePercent)}%
          </span>
        </div>
      )}

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
