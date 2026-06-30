import type { EpisodeInfo } from "../types/messages";

interface Props {
  episodes: EpisodeInfo[];
  onSelect: (index: number) => void;
}

export function EpisodePicker({ episodes, onSelect }: Props) {
  return (
    <div
      style={{
        margin: "8px 16px",
        padding: 16,
        background: "#313244",
        borderRadius: 12,
        border: "1px solid #45475a",
      }}
    >
      <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600, color: "#cdd6f4" }}>
        เลือกตอนที่ต้องการดู:
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          maxHeight: 240,
          overflowY: "auto",
        }}
      >
        {episodes.map((ep) => (
          <button
            key={ep.index}
            onClick={() => onSelect(ep.index)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: ep.active ? "2px solid #89b4fa" : "1px solid #585b70",
              background: ep.active ? "#89b4fa" : "#45475a",
              color: ep.active ? "#1e1e2e" : "#cdd6f4",
              fontSize: 13,
              fontWeight: ep.active ? 700 : 400,
              cursor: "pointer",
              minWidth: 56,
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
