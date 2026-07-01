import { useCallback, useEffect, useRef, useState } from "react";
import { QRScanner } from "./QRScanner";
import type { Movie, MoviesResponse } from "../types/movie";
import type { AgentState } from "../types/messages";

interface Category {
  name: string;
  slug: string;
}

interface HistoryItem {
  title: string;
  url: string;
  poster: string;
  timestamp: number;
}

interface Props {
  onSelectMovie: (url: string, poster?: string) => void;
  connected?: boolean;
  currentState?: AgentState;
  monitorMode?: "inapp" | "device" | "url";
  onMonitorModeChange?: (mode: "inapp" | "device" | "url") => void;
  pairedDeviceKey?: string | null;
  onPairDevice?: (key: string) => void;
  onUnpairDevice?: () => void;
  monitorToken?: string | null;
  isExternalDisconnected?: boolean;
}

const HISTORY_KEY = "streamdesk_history";
const MAX_HISTORY = 30;

function getHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function addToHistory(movie: { title?: string; url: string; poster?: string }) {
  const history = getHistory().filter((h) => h.url !== movie.url);
  history.unshift({
    title: movie.title || "",
    url: movie.url,
    poster: movie.poster || "",
    timestamp: Date.now(),
  });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  return history;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function MovieBrowser({ onSelectMovie, connected, currentState: _currentState, monitorMode = "device", onMonitorModeChange, pairedDeviceKey, onPairDevice, onUnpairDevice, monitorToken, isExternalDisconnected: _isExternalDisconnected }: Props) {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [recentMovies, setRecentMovies] = useState<Movie[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(getHistory);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [deviceKeyInput, setDeviceKeyInput] = useState("");
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [copied, setCopied] = useState(false);
  const recentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data: Category[]) => setCategories(data))
      .catch(() => {});
  }, []);

  // Fetch recent movies
  useEffect(() => {
    fetch("/api/recent?limit=20")
      .then((r) => r.json())
      .then((data: Movie[]) => setRecentMovies(data))
      .catch(() => {});
  }, []);

  const fetchMovies = useCallback(async (p: number, cat: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (cat) params.set("category", cat);
      const resp = await fetch(`/api/movies?${params}`);
      const data: MoviesResponse = await resp.json();
      setMovies(data.movies);
      setTotalPages(data.total_pages);
      setPage(data.page);
    } catch (e) {
      console.error("Failed to fetch movies:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMovies(1, activeCategory);
  }, [fetchMovies, activeCategory]);

  const handleCategoryClick = (slug: string) => {
    setActiveCategory(slug === activeCategory ? "" : slug);
  };

  const handleSelectMovieWithHistory = useCallback(
    (url: string, poster?: string, title?: string) => {
      const updated = addToHistory({ title, url, poster });
      setHistory(updated);
      onSelectMovie(url, poster);
    },
    [onSelectMovie]
  );

  const handleSync = async () => {
    setSyncing(true);
    setShowSettings(false);
    try {
      await fetch("/api/sync", { method: "POST" });
    } catch (e) {
      console.error("Sync failed:", e);
    }
    setTimeout(() => setSyncing(false), 3000);
  };

  const handlePair = async () => {
    const key = deviceKeyInput.trim();
    if (!key) return;
    setPairing(true);
    try {
      onPairDevice?.(key);
      setDeviceKeyInput("");
    } finally {
      setPairing(false);
    }
  };

  const handleQRScan = (scannedKey: string) => {
    setShowQRScanner(false);
    setDeviceKeyInput(scannedKey);
    onPairDevice?.(scannedKey);
  };

  // Connection status helpers
  const isConnected = !!connected;
  const statusColor = isConnected ? "#46D369" : "#E50914";
  const modeLabels = { inapp: "In-App", device: "λ-Device", url: "URL" };
  const statusLabel = modeLabels[monitorMode] || "Monitor";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "20px 24px 0", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.3, color: "var(--text-primary)" }}>
          Browse
        </h1>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Connection status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, background: "var(--bg-elevated)" }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%", background: statusColor, flexShrink: 0,
              boxShadow: isConnected ? `0 0 6px ${statusColor}` : "none",
            }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
              {statusLabel}
            </span>
          </div>

          {/* Settings gear */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                width: 34, height: 34, borderRadius: "50%", border: "1px solid var(--border)",
                background: showSettings ? "var(--bg-elevated)" : "transparent",
                color: "var(--text-secondary)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>

            {/* Settings dropdown */}
            {showSettings && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowSettings(false)} />
                <div style={{
                  position: "absolute", right: 0, top: 42, zIndex: 100,
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: 6, minWidth: 200,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}>
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    style={menuItemStyle(syncing)}
                    onMouseEnter={(e) => !syncing && (e.currentTarget.style.background = "var(--bg-highlight)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0 }}>
                      <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                    </svg>
                    {syncing ? "Syncing..." : "Sync Movies"}
                  </button>

                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

                  {/* Monitor mode */}
                  <div style={{ padding: "8px 12px" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                      Monitor Mode
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(["inapp", "device", "url"] as const).map((mode) => {
                        const labels = { inapp: "In-App", device: "\u03BB-Device", url: "URL" };
                        const active = monitorMode === mode;
                        return (
                          <button
                            key={mode}
                            onClick={() => onMonitorModeChange?.(mode)}
                            style={{
                              flex: 1, padding: "7px 0", borderRadius: 6, border: "none",
                              background: active ? "var(--accent)" : "rgba(255,255,255,0.08)",
                              color: active ? "#fff" : "var(--text-secondary)",
                              fontSize: 11, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            {labels[mode]}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                      {monitorMode === "inapp" && "ดูในแอป — แท็บ Monitor"}
                      {monitorMode === "device" && "เชื่อมต่อจอ Monitor ด้วย Device Key"}
                      {monitorMode === "url" && "เปิด URL บนจอใดก็ได้"}
                    </div>

                    {/* λ-Device mode: device key + QR scan */}
                    {monitorMode === "device" && (
                      <div style={{ marginTop: 8 }}>
                        {pairedDeviceKey ? (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                              Paired Device
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <div style={{
                                flex: 1, padding: "6px 8px", borderRadius: 4,
                                border: "1px solid var(--border)", background: "var(--bg-base)",
                                color: "var(--text-primary)", fontSize: 11,
                                fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis",
                              }}>
                                {pairedDeviceKey}
                              </div>
                              <button
                                onClick={() => onUnpairDevice?.()}
                                style={{
                                  padding: "6px 10px", borderRadius: 4, border: "none",
                                  background: "var(--accent)", color: "#fff",
                                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                                  whiteSpace: "nowrap", flexShrink: 0,
                                }}
                              >
                                Disconnect
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                              Device Key
                            </div>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input
                                value={deviceKeyInput}
                                onChange={(e) => setDeviceKeyInput(e.target.value)}
                                placeholder="Enter device key..."
                                style={{
                                  flex: 1, padding: "6px 8px", borderRadius: 4,
                                  border: "1px solid var(--border)", background: "var(--bg-base)",
                                  color: "var(--text-primary)", fontSize: 11, outline: "none",
                                  minWidth: 0,
                                }}
                                onKeyDown={(e) => e.key === "Enter" && handlePair()}
                              />
                              <button
                                onClick={handlePair}
                                disabled={!deviceKeyInput.trim() || pairing}
                                style={{
                                  padding: "6px 10px", borderRadius: 4, border: "none",
                                  background: deviceKeyInput.trim() ? "var(--accent)" : "rgba(255,255,255,0.08)",
                                  color: "#fff", fontSize: 11, fontWeight: 600,
                                  cursor: deviceKeyInput.trim() ? "pointer" : "default",
                                  whiteSpace: "nowrap", flexShrink: 0,
                                }}
                              >
                                Connect
                              </button>
                            </div>
                            <button
                              onClick={() => setShowQRScanner(true)}
                              style={{
                                width: "100%", marginTop: 6, padding: "7px 0",
                                borderRadius: 4, border: "1px solid var(--border)",
                                background: "transparent", color: "var(--text-secondary)",
                                fontSize: 11, fontWeight: 600, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                                <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                              </svg>
                              Scan QR Code
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* URL mode: show monitor URL */}
                    {monitorMode === "url" && monitorToken && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                          Monitor URL
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            readOnly
                            value={`${window.location.origin}/m/${monitorToken}`}
                            style={{
                              flex: 1, padding: "6px 8px", borderRadius: 4,
                              border: "1px solid var(--border)", background: "var(--bg-base)",
                              color: "var(--text-primary)", fontSize: 11, outline: "none",
                              minWidth: 0,
                            }}
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                          />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/m/${monitorToken}`).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              });
                            }}
                            style={{
                              padding: "6px 10px", borderRadius: 4, border: "none",
                              background: copied ? "#46D369" : "var(--accent)",
                              color: "#fff", fontSize: 11, fontWeight: 600,
                              cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                            }}
                          >
                            {copied ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                          เปิด URL นี้บนจอ Monitor ใดก็ได้
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Scroll wrapper */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>

        {/* History — horizontal slider like Recently Added */}
        {history.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ padding: "16px 24px 8px", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
              History
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                padding: "0 24px 12px",
                overflowX: "auto",
                scrollSnapType: "x mandatory",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {history.map((item) => (
                <div
                  key={item.url}
                  onClick={() => handleSelectMovieWithHistory(item.url, item.poster, item.title)}
                  style={{
                    flexShrink: 0,
                    width: 110,
                    cursor: "pointer",
                    scrollSnapAlign: "start",
                    transition: "transform 0.2s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                >
                  <div style={{
                    width: "100%", aspectRatio: "2 / 3", borderRadius: 6,
                    overflow: "hidden", background: "#2A2A2A", position: "relative",
                  }}>
                    {item.poster && (
                      <img src={item.poster} alt={item.title} loading="lazy"
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    )}
                    {/* Time ago badge */}
                    <span style={{
                      position: "absolute", bottom: 4, left: 4,
                      background: "rgba(0,0,0,0.75)", color: "rgba(255,255,255,0.8)",
                      fontSize: 8, fontWeight: 600, padding: "2px 5px",
                      borderRadius: 3, backdropFilter: "blur(4px)",
                    }}>
                      {formatTimeAgo(item.timestamp)}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: "var(--text-primary)",
                    marginTop: 6, lineHeight: 1.3,
                    overflow: "hidden", textOverflow: "ellipsis",
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  }}>
                    {item.title || "Untitled"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recently Added — horizontal slider */}
        {recentMovies.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ padding: "16px 24px 8px", fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
              Recently Added
            </div>
            <div
              ref={recentRef}
              style={{
                display: "flex",
                gap: 10,
                padding: "0 24px 12px",
                overflowX: "auto",
                scrollSnapType: "x mandatory",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {recentMovies.map((movie) => (
                <div
                  key={movie.url}
                  onClick={() => handleSelectMovieWithHistory(movie.url, movie.poster, movie.title)}
                  style={{
                    flexShrink: 0,
                    width: 110,
                    cursor: "pointer",
                    scrollSnapAlign: "start",
                    transition: "transform 0.2s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                >
                  <div style={{
                    width: "100%", aspectRatio: "2 / 3", borderRadius: 6,
                    overflow: "hidden", background: "#2A2A2A", position: "relative",
                  }}>
                    {movie.poster && (
                      <img src={movie.poster} alt={movie.title} loading="lazy"
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    )}
                    {movie.quality && (
                      <span style={{
                        position: "absolute", top: 4, left: 4,
                        background: "var(--accent)", color: "#fff",
                        fontSize: 8, fontWeight: 700, padding: "1px 5px",
                        borderRadius: 3, textTransform: "uppercase",
                      }}>
                        {movie.quality}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: "var(--text-primary)",
                    marginTop: 6, lineHeight: 1.3,
                    overflow: "hidden", textOverflow: "ellipsis",
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  }}>
                    {movie.title}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Category chips — sticky on scroll */}
        <div
          className="category-bar"
          style={{
            display: "flex",
            gap: 8,
            padding: "6px 24px 14px",
            overflowX: "auto",
            flexShrink: 0,
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "var(--bg-base)",
          }}
        >
          {[{ name: "All", slug: "" }, ...categories].map((cat) => {
            const active = activeCategory === cat.slug;
            return (
              <button
                key={cat.slug}
                style={{
                  padding: "6px 16px",
                  borderRadius: 20,
                  border: active ? "1px solid var(--text-primary)" : "1px solid var(--text-muted)",
                  background: active ? "var(--text-primary)" : "transparent",
                  color: active ? "var(--bg-base)" : "var(--text-primary)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                }}
                onClick={() => handleCategoryClick(cat.slug)}
              >
                {cat.name}
              </button>
            );
          })}
        </div>

        {/* Movie grid */}
        <div className="movie-grid" style={{ padding: "0 24px 24px" }}>
          {loading && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-muted)", padding: 60, fontSize: 14 }}>
              Loading...
            </div>
          )}
          {!loading && movies.length === 0 && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--text-muted)", padding: 60, fontSize: 14 }}>
              No movies found
            </div>
          )}
          {!loading &&
            movies.map((movie) => (
              <div
                key={movie.url}
                onClick={() => handleSelectMovieWithHistory(movie.url, movie.poster, movie.title)}
                style={{
                  cursor: "pointer",
                  borderRadius: 4,
                  overflow: "hidden",
                  transition: "transform 0.2s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
              >
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "2 / 3",
                    position: "relative",
                    background: "#2A2A2A",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  {movie.poster && (
                    <img
                      src={movie.poster}
                      alt={movie.title}
                      loading="lazy"
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                  <div style={{ position: "absolute", top: 6, left: 6, display: "flex", gap: 4 }}>
                    {movie.quality && (
                      <span style={{
                        background: "var(--accent)",
                        color: "#fff",
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 3,
                        textTransform: "uppercase",
                      }}>
                        {movie.quality}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      padding: "32px 8px 8px",
                      background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
                    }}
                  >
                    <div style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#fff",
                      lineHeight: 1.3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}>
                      {movie.title}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                      {movie.rating && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#46D369" }}>{movie.rating}</span>
                      )}
                      {movie.language && (
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{movie.language}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 16,
              padding: "10px 24px 20px",
            }}
          >
            <NavBtn disabled={page <= 1 || loading} onClick={() => fetchMovies(page - 1, activeCategory)} dir="prev" />
            <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>{page} / {totalPages}</span>
            <NavBtn disabled={page >= totalPages || loading} onClick={() => fetchMovies(page + 1, activeCategory)} dir="next" />
          </div>
        )}
      </div>

      {/* QR Scanner modal */}
      {showQRScanner && (
        <QRScanner onScan={handleQRScan} onClose={() => setShowQRScanner(false)} />
      )}

      {/* Grid + scrollbar styling */}
      <style>{`
        div::-webkit-scrollbar { height: 0; width: 0; }
        .movie-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 170px));
          justify-content: start;
          gap: 12px;
        }
        @media (max-width: 768px) {
          .movie-grid {
            grid-template-columns: repeat(3, 1fr) !important;
            gap: 6px !important;
            padding-left: 6px !important;
            padding-right: 6px !important;
          }
        }
      `}</style>
    </div>
  );
}

function menuItemStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 10, width: "100%",
    padding: "10px 12px", border: "none", borderRadius: 6,
    background: "transparent", color: disabled ? "var(--text-muted)" : "var(--text-primary)",
    fontSize: 13, fontWeight: 500, cursor: disabled ? "default" : "pointer",
    textAlign: "left" as const,
  };
}

function NavBtn({ disabled, onClick, dir }: { disabled: boolean; onClick: () => void; dir: "prev" | "next" }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        border: "1px solid var(--border)",
        background: disabled ? "transparent" : "var(--bg-elevated)",
        color: disabled ? "var(--text-muted)" : "var(--text-primary)",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
        {dir === "prev" ? <polyline points="15,18 9,12 15,6" /> : <polyline points="9,6 15,12 9,18" />}
      </svg>
    </button>
  );
}
