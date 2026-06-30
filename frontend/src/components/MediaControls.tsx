import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onMediaControl: (action: string, value?: number) => void;
}

interface MediaStatus {
  currentTime: number;
  duration: number;
  paused: boolean;
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function MediaControls({ onMediaControl }: Props) {
  const [status, setStatus] = useState<MediaStatus>({
    currentTime: 0,
    duration: 0,
    paused: false,
  });
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Poll status every 2 seconds
  useEffect(() => {
    const poll = () => onMediaControl("get_status");
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [onMediaControl]);

  // Listen for media_status messages from WebSocket
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const data = e.detail;
      if (data.type === "media_status") {
        setStatus({
          currentTime: data.currentTime || 0,
          duration: data.duration || 0,
          paused: data.paused ?? false,
        });
      }
    };
    window.addEventListener("media_status" as any, handler as any);
    return () => window.removeEventListener("media_status" as any, handler as any);
  }, []);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      setDragTime(val);
      setDragging(true);
    },
    []
  );

  const handleSliderCommit = useCallback(() => {
    onMediaControl("seek_to", dragTime);
    setDragging(false);
  }, [onMediaControl, dragTime]);

  const progress = status.duration > 0
    ? ((dragging ? dragTime : status.currentTime) / status.duration) * 100
    : 0;

  const btnStyle: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #45475a",
    background: "#313244",
    color: "#cdd6f4",
    fontSize: 16,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 36,
  };

  return (
    <div
      style={{
        padding: "8px 16px",
        background: "#181825",
        borderTop: "1px solid #313244",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {/* Timeline slider */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "#a6adc8", minWidth: 45, textAlign: "right" }}>
          {formatTime(dragging ? dragTime : status.currentTime)}
        </span>
        <div style={{ flex: 1, position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              height: 4,
              background: "#45475a",
              borderRadius: 2,
              transform: "translateY(-50%)",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                background: "#89b4fa",
                borderRadius: 2,
              }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={status.duration || 100}
            step={1}
            value={dragging ? dragTime : status.currentTime}
            onChange={handleSliderChange}
            onMouseUp={handleSliderCommit}
            onTouchEnd={handleSliderCommit}
            style={{
              width: "100%",
              position: "relative",
              zIndex: 1,
              opacity: 0,
              cursor: "pointer",
              height: 20,
              margin: 0,
            }}
          />
        </div>
        <span style={{ fontSize: 12, color: "#a6adc8", minWidth: 45 }}>
          {formatTime(status.duration)}
        </span>
      </div>

      {/* Control buttons */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, alignItems: "center" }}>
        <button style={btnStyle} onClick={() => onMediaControl("seek_backward", 30)} title="-30s">
          -30
        </button>
        <button style={btnStyle} onClick={() => onMediaControl("seek_backward", 10)} title="-10s">
          -10
        </button>
        <button
          style={{ ...btnStyle, fontSize: 20, minWidth: 44, background: "#89b4fa", color: "#1e1e2e", border: "none" }}
          onClick={() => onMediaControl(status.paused ? "resume" : "pause")}
          title={status.paused ? "Play" : "Pause"}
        >
          {status.paused ? "\u25B6" : "\u23F8"}
        </button>
        <button style={btnStyle} onClick={() => onMediaControl("seek_forward", 10)} title="+10s">
          +10
        </button>
        <button style={btnStyle} onClick={() => onMediaControl("seek_forward", 30)} title="+30s">
          +30
        </button>
      </div>
    </div>
  );
}
