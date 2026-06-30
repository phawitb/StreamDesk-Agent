import type { AgentState } from "../types/messages";

const STATE_LABELS: Record<AgentState, { label: string; color: string }> = {
  idle: { label: "พร้อม", color: "#6b7280" },
  launching: { label: "กำลังเปิด Browser...", color: "#f59e0b" },
  navigating: { label: "กำลังนำทาง...", color: "#3b82f6" },
  loading_player: { label: "กำลังโหลด Player...", color: "#8b5cf6" },
  playing: { label: "กำลังเล่น", color: "#10b981" },
  error: { label: "เกิดข้อผิดพลาด", color: "#ef4444" },
};

interface Props {
  state: AgentState;
  connected: boolean;
}

export function StatusBar({ state, connected }: Props) {
  const info = STATE_LABELS[state];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginLeft: "auto",
        fontSize: 13,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: connected ? info.color : "#ef4444",
          animation:
            state !== "idle" && state !== "error" && state !== "playing"
              ? "pulse 1.5s infinite"
              : "none",
        }}
      />
      <span style={{ color: "#cdd6f4" }}>
        {connected ? info.label : "ไม่ได้เชื่อมต่อ"}
      </span>
    </div>
  );
}
