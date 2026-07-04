import { useEffect, useRef } from "react";
import type { EpisodeInfo } from "../types/messages";

const STORAGE_KEY = "streamdesk_last_episode";

function getLastEpisode(url: string): number | null {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return data[url] ?? null;
  } catch { return null; }
}

export function saveLastEpisode(url: string, index: number) {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    data[url] = index;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

interface Props {
  episodes: EpisodeInfo[];
  onSelect: (index: number) => void;
  seriesUrl?: string;
}

export function EpisodePicker({ episodes, onSelect, seriesUrl }: Props) {
  const lastIndex = seriesUrl ? getLastEpisode(seriesUrl) : null;
  // Default to last watched episode
  const suggestedIndex = lastIndex !== null
    ? Math.min(lastIndex, episodes.length - 1)
    : null;

  const suggestedRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to suggested episode
  useEffect(() => {
    suggestedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [suggestedIndex]);

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
        {lastIndex !== null && (
          <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8, fontSize: 11 }}>
            ดูล่าสุด: {episodes[lastIndex]?.text || `ตอนที่ ${lastIndex + 1}`}
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 200, overflowY: "auto" }}>
        {episodes.map((ep) => {
          const isSuggested = ep.index === suggestedIndex;
          const isLastWatched = ep.index === lastIndex;
          return (
            <button
              key={ep.index}
              ref={isSuggested ? suggestedRef : undefined}
              onClick={() => onSelect(ep.index)}
              style={{
                padding: "6px 14px",
                borderRadius: 4,
                border: isSuggested ? "2px solid var(--accent)" : isLastWatched ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: isSuggested ? "var(--accent)" : "transparent",
                color: isSuggested ? "#fff" : isLastWatched ? "var(--accent)" : "var(--text-primary)",
                fontSize: 12,
                fontWeight: isSuggested || isLastWatched ? 700 : 500,
                cursor: "pointer",
                minWidth: 50,
                textAlign: "center",
              }}
            >
              {ep.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
