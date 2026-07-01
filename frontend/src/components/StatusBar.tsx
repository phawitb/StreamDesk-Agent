import type { AgentState } from "../types/messages";

const STATE_LABELS: Record<AgentState, { label: string; color: string }> = {
  idle: { label: "Ready", color: "var(--text-muted)" },
  launching: { label: "Launching...", color: "#E87C03" },
  navigating: { label: "Navigating...", color: "#E87C03" },
  loading_player: { label: "Loading...", color: "#E87C03" },
  playing: { label: "Playing", color: "#46D369" },
  error: { label: "Error", color: "var(--accent)" },
};

interface Props {
  state: AgentState;
  connected: boolean;
}

export function StatusBar({ state, connected }: Props) {
  const info = STATE_LABELS[state];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "2px 0" }}>
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: connected ? info.color : "var(--accent)",
          flexShrink: 0,
          animation: state !== "idle" && state !== "error" && state !== "playing" ? "pulse 1.5s infinite" : "none",
        }}
      />
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
        {connected ? info.label : "Disconnected"}
      </span>
    </div>
  );
}
