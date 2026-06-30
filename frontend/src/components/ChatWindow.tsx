import { useEffect, useRef, useState } from "react";
import type { DisplayMessage, EpisodeInfo } from "../types/messages";
import { MessageBubble } from "./MessageBubble";
import { MediaControls } from "./MediaControls";
import { EpisodePicker } from "./EpisodePicker";

interface Props {
  messages: DisplayMessage[];
  onSend: (text: string) => void;
  onDownload?: () => void;
  onMediaControl?: (action: string, value?: number) => void;
  isPlaying?: boolean;
  episodes?: EpisodeInfo[] | null;
  onSelectEpisode?: (index: number) => void;
  onSelectMovie?: (url: string) => void;
}

export function ChatWindow({ messages, onSend, onDownload, onMediaControl, isPlaying, episodes, onSelectEpisode, onSelectMovie }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 0",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "#6c7086",
              marginTop: 60,
              fontSize: 15,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎬</div>
            <div>วาง URL หนัง หรือพิมพ์ชื่อหนังที่ต้องการดู</div>
            <div style={{ fontSize: 13, marginTop: 8, color: "#585b70" }}>
              ตัวอย่าง: https://www.24hd.net/chris-and-martina-the-final-set-2026
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble message={msg} />
            {msg.recommendations && msg.recommendations.length > 0 && (
              <div style={{ padding: "4px 16px 8px" }}>
                {msg.recommendations.map((movie, idx) => (
                  <div
                    key={idx}
                    onClick={() => onSelectMovie?.(movie.url)}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: 10,
                      marginBottom: 6,
                      background: "#313244",
                      borderRadius: 8,
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#45475a")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#313244")}
                  >
                    {movie.poster && (
                      <img
                        src={movie.poster}
                        alt={movie.title}
                        style={{
                          width: 45,
                          height: 65,
                          objectFit: "cover",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#cdd6f4", marginBottom: 3 }}>
                        {movie.title}
                      </div>
                      <div style={{ fontSize: 11, color: "#a6adc8", display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {movie.rating && <span>{"★"} {movie.rating}</span>}
                        {movie.quality && <span>{movie.quality}</span>}
                        {movie.language && <span>{movie.language}</span>}
                      </div>
                      {movie.genres && (
                        <div style={{ fontSize: 11, color: "#6c7086", marginTop: 2 }}>{movie.genres}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {episodes && episodes.length > 0 && onSelectEpisode && (
          <EpisodePicker episodes={episodes} onSelect={onSelectEpisode} />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Media Controls */}
      {isPlaying && onMediaControl && (
        <MediaControls onMediaControl={onMediaControl} />
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 16px",
          borderTop: "1px solid #313244",
          background: "#1e1e2e",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="วาง URL หนัง หรือพิมพ์ชื่อหนัง..."
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #45475a",
            background: "#313244",
            color: "#cdd6f4",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            background: "#89b4fa",
            color: "#1e1e2e",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ส่ง
        </button>
        {isPlaying && onDownload && (
          <button
            type="button"
            onClick={onDownload}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "none",
              background: "#a6e3a1",
              color: "#1e1e2e",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Download
          </button>
        )}
      </form>
    </div>
  );
}
