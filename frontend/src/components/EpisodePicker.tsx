import type { EpisodeInfo } from "../types/messages";

interface Props {
  episodes: EpisodeInfo[];
  onSelect: (index: number) => void;
}

export function EpisodePicker({ episodes, onSelect }: Props) {
  return (
    <div
      style={{
        margin: "8px 12px",
        padding: 12,
        background: "var(--bg-elevated)",
        borderRadius: 6,
      }}
    >
      <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
        Select Episode
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 200, overflowY: "auto" }}>
        {episodes.map((ep) => (
          <button
            key={ep.index}
            onClick={() => onSelect(ep.index)}
            style={{
              padding: "6px 14px",
              borderRadius: 4,
              border: ep.active ? "none" : "1px solid var(--border)",
              background: ep.active ? "var(--accent)" : "transparent",
              color: ep.active ? "#fff" : "var(--text-primary)",
              fontSize: 12,
              fontWeight: ep.active ? 700 : 500,
              cursor: "pointer",
              minWidth: 50,
              textAlign: "center",
            }}
          >
            {ep.text}
          </button>
        ))}
      </div>
    </div>
  );
}
