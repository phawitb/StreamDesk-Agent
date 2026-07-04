import { useEffect, useRef, useState } from "react";
import type { DisplayMessage, EpisodeInfo } from "../types/messages";
import type { Movie } from "../types/movie";
import { MessageBubble } from "./MessageBubble";
import { EpisodePicker } from "./EpisodePicker";

interface Props {
  messages: DisplayMessage[];
  onSend: (text: string) => void;
  onDownload?: () => void;
  isPlaying?: boolean;
  episodes?: EpisodeInfo[] | null;
  onSelectEpisode?: (index: number) => void;
  onSelectMovie?: (url: string, poster?: string, title?: string) => void;
  seriesUrl?: string;
  thinkingText?: string;
  disabled?: boolean;
}

export function ChatWindow({ messages, onSend, onDownload, isPlaying, episodes, onSelectEpisode, onSelectMovie, seriesUrl, thinkingText, disabled }: Props) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<Movie[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Scroll to bottom when virtual keyboard opens on mobile
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    };
    vv.addEventListener("resize", handleResize);
    return () => vv.removeEventListener("resize", handleResize);
  }, []);

  // Real-time search as user types
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = input.trim();
    // Don't search URLs
    if (!query || query.length < 2 || query.startsWith("http://") || query.startsWith("https://")) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=6`);
        if (resp.ok) {
          const data: Movie[] = await resp.json();
          setSuggestions(data);
          setShowSuggestions(data.length > 0);
        }
      } catch {
        // ignore
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleSelectSuggestion = (movie: Movie) => {
    setInput("");
    setSuggestions([]);
    setShowSuggestions(false);
    onSelectMovie?.(movie.url, movie.poster, movie.title);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Chat</h2>
        {isPlaying && onDownload && (
          <button
            onClick={onDownload}
            style={{
              marginLeft: "auto",
              padding: "5px 14px",
              borderRadius: 4,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Download
          </button>
        )}
      </div>

      {/* Messages — flex:1 + minHeight:0 allows proper shrinking */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 0",
          minHeight: 0,
          overscrollBehavior: "contain",
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: 60, padding: "0 20px" }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 40, height: 40, color: "var(--text-muted)", marginBottom: 12, opacity: 0.3 }}>
              <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 8v8l6-4-6-4z" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: "var(--text-secondary)" }}>
              What do you want to watch?
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Paste a URL or type a movie title
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble message={msg} />
            {msg.recommendations && msg.recommendations.length > 0 && (
              <div style={{ padding: "4px 12px 8px" }}>
                {msg.recommendations.map((movie, idx) => (
                  <div
                    key={idx}
                    onClick={() => onSelectMovie?.(movie.url, movie.poster, movie.title)}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: 8,
                      marginBottom: 4,
                      background: "var(--bg-elevated)",
                      borderRadius: 4,
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-highlight)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
                  >
                    {movie.poster && (
                      <img
                        src={movie.poster}
                        alt={movie.title}
                        style={{ width: 36, height: 52, objectFit: "cover", borderRadius: 3, flexShrink: 0 }}
                      />
                    )}
                    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>
                        {movie.title}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", gap: 6 }}>
                        {movie.rating && <span style={{ color: "#46D369" }}>{movie.rating}</span>}
                        {movie.quality && <span>{movie.quality}</span>}
                        {movie.language && <span>{movie.language}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {episodes && episodes.length > 0 && onSelectEpisode && (
          <EpisodePicker episodes={episodes} onSelect={onSelectEpisode} seriesUrl={seriesUrl} />
        )}
        {thinkingText && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            animation: "fadeIn 0.2s ease",
          }}>
            <div className="thinking-dots">
              <span /><span /><span />
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              {thinkingText}
            </span>
            <style>{`
              .thinking-dots {
                display: flex;
                gap: 3px;
                align-items: center;
              }
              .thinking-dots span {
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: var(--text-muted);
                animation: dotPulse 1.4s infinite ease-in-out;
              }
              .thinking-dots span:nth-child(1) { animation-delay: 0s; }
              .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
              .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
              @keyframes dotPulse {
                0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
                40% { opacity: 1; transform: scale(1); }
              }
            `}</style>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Autocomplete suggestions — float above input */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            maxHeight: 280,
            overflowY: "auto",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ padding: "6px 12px 2px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Results
          </div>
          {suggestions.map((movie) => (
            <div
              key={movie.url}
              onClick={() => handleSelectSuggestion(movie)}
              style={{
                display: "flex",
                gap: 10,
                padding: "8px 12px",
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {movie.poster && (
                <img
                  src={movie.poster}
                  alt={movie.title}
                  style={{ width: 32, height: 46, objectFit: "cover", borderRadius: 3, flexShrink: 0 }}
                />
              )}
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {movie.title}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", display: "flex", gap: 6 }}>
                  {movie.rating && <span style={{ color: "#46D369" }}>{movie.rating}</span>}
                  {movie.quality && <span>{movie.quality}</span>}
                  {movie.language && <span>{movie.language}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Disconnected warning */}
      {disabled && (
        <div style={{
          padding: "8px 12px",
          background: "rgba(134,59,255,0.08)",
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-secondary)",
          textAlign: "center",
          flexShrink: 0,
        }}>
          โปรดเชื่อมต่อจอก่อน หรือปรับเป็นโหมด In-App (Settings &gt; Monitor Mode)
        </div>
      )}

      {/* Input — always at the very bottom */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: 8,
          padding: "10px 12px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-surface)",
          flexShrink: 0,
          paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
          opacity: disabled ? 0.5 : 1,
          pointerEvents: disabled ? "none" : "auto",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => {
            setTimeout(() => setShowSuggestions(false), 200);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true);
          }}
          placeholder={disabled ? "Connect a monitor first..." : "Paste URL or search..."}
          enterKeyHint="send"
          disabled={disabled}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: "var(--bg-base)",
            color: "var(--text-primary)",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={disabled}
          style={{
            padding: "10px 16px",
            borderRadius: 4,
            border: "none",
            background: disabled ? "var(--text-muted)" : "var(--accent)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: disabled ? "default" : "pointer",
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
