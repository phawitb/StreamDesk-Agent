import { useCallback, useEffect, useRef, useState } from "react";
import { QRScanner } from "./QRScanner";
import type { Movie, MoviesResponse } from "../types/movie";
import type { AgentState } from "../types/messages";
import type { User } from "../hooks/useAuth";

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
  user?: User | null;
  onLogout?: () => void;
  isAdmin?: boolean;
  fontScale?: number;
  onFontScaleChange?: (scale: number) => void;
  forceInstall?: boolean;
  onForceInstallChange?: (enabled: boolean) => void;
}

interface WatchHistoryEntry {
  user_email: string;
  user_name: string | null;
  user_picture: string | null;
  url: string;
  title: string;
  started_at: string;
}

interface PopularMovie {
  url: string;
  title: string;
  viewer_count: number;
  play_count: number;
  last_watched: string;
  downloaded: boolean;
  downloading: boolean;
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

function getWatchProgress(): Record<string, { currentTime: number; duration: number }> {
  try {
    return JSON.parse(localStorage.getItem("streamdesk_progress") || "{}");
  } catch {
    return {};
  }
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

export function MovieBrowser({ onSelectMovie, connected, currentState: _currentState, monitorMode = "device", onMonitorModeChange, pairedDeviceKey, onPairDevice, onUnpairDevice, monitorToken, isExternalDisconnected: _isExternalDisconnected, user, onLogout, isAdmin, fontScale = 1, onFontScaleChange, forceInstall, onForceInstallChange }: Props) {
  const isWide = typeof window !== "undefined" && window.innerWidth > 768;
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
  const [showWatchHistory, setShowWatchHistory] = useState(false);
  const [watchHistoryTab, setWatchHistoryTab] = useState<"users" | "movies">("users");
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>([]);
  const [watchHistoryLoading, setWatchHistoryLoading] = useState(false);
  const [popularMovies, setPopularMovies] = useState<PopularMovie[]>([]);
  const [popularMoviesLoading, setPopularMoviesLoading] = useState(false);
  const [autoDownloadThreshold, setAutoDownloadThreshold] = useState(0);
  const [downloadingUrls, setDownloadingUrls] = useState<Set<string>>(new Set());
  const [showVideoStorage, setShowVideoStorage] = useState(false);
  const [videoList, setVideoList] = useState<{ filename: string; size: number; modified: number }[]>([]);
  const [videoTotalSize, setVideoTotalSize] = useState(0);
  const [videoMaxBytes, setVideoMaxBytes] = useState(10 * 1024 * 1024 * 1024);
  const [videoLoading, setVideoLoading] = useState(false);
  const [watchProgress, setWatchProgress] = useState<Record<string, { currentTime: number; duration: number }>>(getWatchProgress);
  const recentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data: Category[]) => setCategories(data))
      .catch(() => {});
  }, []);

  // Refresh watch progress when tab becomes visible or media status updates
  useEffect(() => {
    const refresh = () => setWatchProgress(getWatchProgress());
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    // Throttled refresh on media_status events
    let lastRefresh = 0;
    const onMediaStatus = () => {
      if (Date.now() - lastRefresh > 5000) {
        lastRefresh = Date.now();
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("media_status" as any, onMediaStatus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("media_status" as any, onMediaStatus);
    };
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
      setWatchProgress(getWatchProgress());
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

  const handleOpenWatchHistory = async () => {
    setShowWatchHistory(true);
    setWatchHistoryTab("users");
    setWatchHistoryLoading(true);
    try {
      const resp = await fetch("/api/admin/watch-history?limit=200");
      if (resp.ok) setWatchHistory(await resp.json());
    } catch (e) {
      console.error("Failed to load watch history:", e);
    } finally {
      setWatchHistoryLoading(false);
    }
  };

  const fetchPopularMovies = async () => {
    setPopularMoviesLoading(true);
    try {
      const resp = await fetch("/api/admin/popular-movies");
      if (resp.ok) {
        const data = await resp.json();
        setPopularMovies(data.movies);
        setAutoDownloadThreshold(data.auto_download_threshold);
      }
    } catch (e) {
      console.error("Failed to load popular movies:", e);
    } finally {
      setPopularMoviesLoading(false);
    }
  };

  const handleDownloadMovie = async (url: string) => {
    setDownloadingUrls((prev) => new Set(prev).add(url));
    try {
      await fetch("/api/admin/download-movie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
    } catch (e) {
      console.error("Download failed:", e);
    }
  };

  const handleSaveAutoDownload = async (value: number) => {
    setAutoDownloadThreshold(value);
    try {
      await fetch("/api/app-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_download_threshold: value }),
      });
      // Refresh after a short delay to show new download statuses
      setTimeout(fetchPopularMovies, 1500);
    } catch (e) {
      console.error("Failed to save auto-download threshold:", e);
    }
  };

  const fetchVideos = async () => {
    setVideoLoading(true);
    try {
      const resp = await fetch("/api/admin/videos");
      if (resp.ok) {
        const data = await resp.json();
        setVideoList(data.videos);
        setVideoTotalSize(data.total_size);
        setVideoMaxBytes(data.max_storage_bytes);
      }
    } catch (e) {
      console.error("Failed to load videos:", e);
    } finally {
      setVideoLoading(false);
    }
  };

  const handleOpenVideoStorage = () => {
    setShowVideoStorage(true);
    setShowSettings(false);
    fetchVideos();
  };

  const handleDeleteVideo = async (filename: string) => {
    await fetch(`/api/admin/videos/${encodeURIComponent(filename)}`, { method: "DELETE" });
    fetchVideos();
  };

  const handleDeleteAllVideos = async () => {
    await fetch("/api/admin/videos", { method: "DELETE" });
    fetchVideos();
  };

  const handleMaxStorageChange = async (gb: number) => {
    const clamped = Math.max(1, Math.min(100, gb));
    setVideoMaxBytes(clamped * 1024 * 1024 * 1024);
    await fetch("/api/app-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_storage_gb: clamped }),
    }).catch(() => {});
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

            {/* Settings panel — centered modal */}
            {showSettings && (
              <div style={{ position: "fixed", inset: 0, zIndex: 99, zoom: fontScale !== 1 ? 1 / fontScale : undefined }}>
                <div style={{
                  position: "fixed", inset: 0,
                  background: "rgba(0,0,0,0.6)",
                }} onClick={() => setShowSettings(false)} />
                <div style={{
                  position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                  zIndex: 100, background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  borderRadius: 12, padding: isWide ? 24 : 16,
                  width: isWide ? "min(560px, 60vw)" : "calc(100vw - 32px)",
                  maxHeight: "85vh", overflowY: "auto",
                  boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
                }}>
                  {/* Title + close button */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isWide ? 16 : 12 }}>
                    <h3 style={{ fontSize: isWide ? 20 : 17, fontWeight: 700, color: "var(--text-primary)" }}>Settings</h3>
                    <button
                      onClick={() => setShowSettings(false)}
                      style={{
                        width: 32, height: 32, borderRadius: "50%", border: "none",
                        background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>

                  {/* Monitor mode */}
                  <div style={{ padding: isWide ? "12px 4px" : "8px 12px" }}>
                    <div style={{ fontSize: isWide ? 14 : 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: isWide ? 10 : 6 }}>
                      Monitor Mode
                    </div>
                    <div style={{ display: "flex", gap: isWide ? 6 : 4 }}>
                      {(["inapp", "device", "url"] as const).map((mode) => {
                        const labels = { inapp: "In-App", device: "\u03BB-Device", url: "URL" };
                        const active = monitorMode === mode;
                        return (
                          <button
                            key={mode}
                            onClick={() => onMonitorModeChange?.(mode)}
                            style={{
                              flex: 1, padding: isWide ? "10px 0" : "9px 0", borderRadius: 6, border: "none",
                              background: active ? "var(--accent)" : "rgba(255,255,255,0.08)",
                              color: active ? "#fff" : "var(--text-secondary)",
                              fontSize: isWide ? 14 : 13, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            {labels[mode]}
                          </button>
                        );
                      })}
                    </div>

                    {/* Fixed-height mode detail area */}
                    <div style={{ minHeight: isWide ? 140 : 120, marginTop: isWide ? 12 : 8 }}>
                      <div style={{ fontSize: isWide ? 12 : 11, color: "var(--text-muted)", marginBottom: isWide ? 12 : 8 }}>
                        {monitorMode === "inapp" && "ดูในแอป — แท็บ Monitor"}
                        {monitorMode === "device" && "เชื่อมต่อจอ Monitor ด้วย Device Key"}
                        {monitorMode === "url" && "เปิด URL บนจอใดก็ได้"}
                      </div>

                      {/* λ-Device mode: device key + QR scan */}
                      {monitorMode === "device" && (
                        <>
                          {pairedDeviceKey ? (
                            <div>
                              <div style={{ fontSize: isWide ? 13 : 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: isWide ? 6 : 4 }}>
                                Paired Device
                              </div>
                              <div style={{ display: "flex", gap: isWide ? 8 : 6, alignItems: "center" }}>
                                <div style={{
                                  flex: 1, padding: isWide ? "8px 12px" : "8px 10px", borderRadius: 4,
                                  border: "1px solid var(--border)", background: "var(--bg-base)",
                                  color: "var(--text-primary)", fontSize: isWide ? 14 : 13,
                                  fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis",
                                }}>
                                  {pairedDeviceKey}
                                </div>
                                <button
                                  onClick={() => onUnpairDevice?.()}
                                  style={{
                                    padding: isWide ? "8px 16px" : "8px 14px", borderRadius: 4, border: "none",
                                    background: "var(--accent)", color: "#fff",
                                    fontSize: isWide ? 13 : 12, fontWeight: 600, cursor: "pointer",
                                    whiteSpace: "nowrap", flexShrink: 0,
                                  }}
                                >
                                  Disconnect
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div style={{ fontSize: isWide ? 13 : 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: isWide ? 6 : 4 }}>
                                Device Key
                              </div>
                              <div style={{ display: "flex", gap: isWide ? 8 : 6, alignItems: "center" }}>
                                <input
                                  value={deviceKeyInput}
                                  onChange={(e) => setDeviceKeyInput(e.target.value)}
                                  placeholder="Enter device key..."
                                  style={{
                                    flex: 1, padding: isWide ? "8px 12px" : "8px 10px", borderRadius: 4,
                                    border: "1px solid var(--border)", background: "var(--bg-base)",
                                    color: "var(--text-primary)", fontSize: isWide ? 14 : 13, outline: "none",
                                    minWidth: 0,
                                  }}
                                  onKeyDown={(e) => e.key === "Enter" && handlePair()}
                                />
                                <button
                                  onClick={handlePair}
                                  disabled={!deviceKeyInput.trim() || pairing}
                                  style={{
                                    padding: isWide ? "8px 16px" : "8px 14px", borderRadius: 4, border: "none",
                                    background: deviceKeyInput.trim() ? "var(--accent)" : "rgba(255,255,255,0.08)",
                                    color: "#fff", fontSize: isWide ? 13 : 12, fontWeight: 600,
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
                                  width: "100%", marginTop: isWide ? 10 : 8, padding: isWide ? "10px 0" : "9px 0",
                                  borderRadius: 4, border: "1px solid var(--border)",
                                  background: "transparent", color: "var(--text-secondary)",
                                  fontSize: isWide ? 13 : 12, fontWeight: 600, cursor: "pointer",
                                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                                }}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: isWide ? 18 : 16, height: isWide ? 18 : 16 }}>
                                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                                  <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                                </svg>
                                Scan QR Code
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {/* URL mode: show monitor URL */}
                      {monitorMode === "url" && monitorToken && (
                        <div>
                          <div style={{ fontSize: isWide ? 13 : 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: isWide ? 6 : 4 }}>
                            Monitor URL
                          </div>
                          <div style={{ display: "flex", gap: isWide ? 8 : 6, alignItems: "center" }}>
                            <input
                              readOnly
                              value={`${window.location.origin}/m/${monitorToken}`}
                              style={{
                                flex: 1, padding: isWide ? "8px 12px" : "8px 10px", borderRadius: 4,
                                border: "1px solid var(--border)", background: "var(--bg-base)",
                                color: "var(--text-primary)", fontSize: isWide ? 14 : 13, outline: "none",
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
                                padding: isWide ? "8px 16px" : "8px 14px", borderRadius: 4, border: "none",
                                background: copied ? "#46D369" : "var(--accent)",
                                color: "#fff", fontSize: isWide ? 13 : 12, fontWeight: 600,
                                cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                              }}
                            >
                              {copied ? "Copied!" : "Copy"}
                            </button>
                          </div>
                          <div style={{ fontSize: isWide ? 12 : 11, color: "var(--text-muted)", marginTop: isWide ? 6 : 4 }}>
                            เปิด URL นี้บนจอ Monitor ใดก็ได้
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Font Size */}
                  <div style={{ height: 1, background: "var(--border)", margin: isWide ? "8px 0" : "4px 0" }} />
                  <div style={{ padding: isWide ? "12px 4px" : "8px 12px" }}>
                    <div style={{ fontSize: isWide ? 14 : 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: isWide ? 10 : 6 }}>
                      Font Size
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: isWide ? 10 : 8 }}>
                      <button
                        onClick={() => onFontScaleChange?.(Math.max(0.8, Math.round((fontScale - 0.1) * 100) / 100))}
                        disabled={fontScale <= 0.8}
                        style={{
                          width: isWide ? 36 : 32, height: isWide ? 36 : 32, borderRadius: 6, border: "1px solid var(--border)",
                          background: fontScale <= 0.8 ? "transparent" : "rgba(255,255,255,0.08)",
                          color: fontScale <= 0.8 ? "var(--text-muted)" : "var(--text-primary)",
                          fontSize: isWide ? 16 : 14, fontWeight: 700, cursor: fontScale <= 0.8 ? "default" : "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        A-
                      </button>
                      <div style={{
                        flex: 1, textAlign: "center",
                        fontSize: isWide ? 14 : 13, fontWeight: 600, color: "var(--text-primary)",
                      }}>
                        {Math.round(fontScale * 100)}%
                      </div>
                      <button
                        onClick={() => onFontScaleChange?.(Math.min(1.5, Math.round((fontScale + 0.1) * 100) / 100))}
                        disabled={fontScale >= 1.5}
                        style={{
                          width: isWide ? 36 : 32, height: isWide ? 36 : 32, borderRadius: 6, border: "1px solid var(--border)",
                          background: fontScale >= 1.5 ? "transparent" : "rgba(255,255,255,0.08)",
                          color: fontScale >= 1.5 ? "var(--text-muted)" : "var(--text-primary)",
                          fontSize: isWide ? 16 : 14, fontWeight: 700, cursor: fontScale >= 1.5 ? "default" : "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        A+
                      </button>
                    </div>
                  </div>

                  {/* Profile + Logout */}
                  {user && (
                    <>
                      <div style={{ height: 1, background: "var(--border)", margin: isWide ? "8px 0" : "4px 0" }} />
                      <div style={{ display: "flex", alignItems: "center", gap: isWide ? 12 : 10, padding: isWide ? "12px 4px" : "10px 12px" }}>
                        {user.picture && (
                          <img src={user.picture} alt="" referrerPolicy="no-referrer" style={{
                            width: isWide ? 40 : 36, height: isWide ? 40 : 36, borderRadius: "50%", flexShrink: 0,
                          }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: isWide ? 14 : 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {user.name || user.email}
                          </div>
                          {user.name && (
                            <div style={{ fontSize: isWide ? 12 : 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {user.email}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={onLogout}
                          style={{
                            padding: isWide ? "8px 16px" : "8px 14px", borderRadius: 6, border: "1px solid var(--border)",
                            background: "transparent", color: "var(--text-secondary)",
                            fontSize: isWide ? 13 : 12, fontWeight: 600, cursor: "pointer",
                            whiteSpace: "nowrap", flexShrink: 0,
                          }}
                        >
                          Logout
                        </button>
                      </div>

                      {/* Admin section */}
                      {isAdmin && (
                        <>
                          <div style={{ height: 1, background: "var(--border)", margin: isWide ? "8px 0" : "4px 0" }} />
                          <div style={{ fontSize: isWide ? 14 : 13, fontWeight: 600, color: "var(--text-secondary)", padding: isWide ? "8px 4px 4px" : "6px 12px 2px" }}>
                            Admin
                          </div>
                          <button
                            onClick={handleSync}
                            disabled={syncing}
                            style={menuItemStyle(syncing, isWide)}
                            onMouseEnter={(e) => !syncing && (e.currentTarget.style.background = "var(--bg-highlight)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: isWide ? 20 : 16, height: isWide ? 20 : 16, flexShrink: 0 }}>
                              <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                            </svg>
                            {syncing ? "Syncing..." : "Sync Movies"}
                          </button>
                          <button
                            onClick={handleOpenWatchHistory}
                            style={menuItemStyle(false, isWide)}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-highlight)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: isWide ? 20 : 16, height: isWide ? 20 : 16, flexShrink: 0 }}>
                              <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
                            </svg>
                            Watch History
                          </button>
                          <button
                            onClick={handleOpenVideoStorage}
                            style={menuItemStyle(false, isWide)}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-highlight)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: isWide ? 20 : 16, height: isWide ? 20 : 16, flexShrink: 0 }}>
                              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                            </svg>
                            Video Storage
                          </button>
                          <div
                            onClick={() => onForceInstallChange?.(!forceInstall)}
                            style={{
                              ...menuItemStyle(false, isWide),
                              cursor: "pointer", justifyContent: "space-between",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-highlight)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: isWide ? 12 : 10 }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: isWide ? 20 : 16, height: isWide ? 20 : 16, flexShrink: 0 }}>
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                <polyline points="7,10 12,15 17,10" /><line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              Force Install
                            </div>
                            <div style={{
                              width: 40, height: 22, borderRadius: 11,
                              background: forceInstall ? "var(--accent)" : "rgba(255,255,255,0.15)",
                              position: "relative", transition: "background 0.2s", flexShrink: 0,
                            }}>
                              <div style={{
                                width: 18, height: 18, borderRadius: "50%", background: "#fff",
                                position: "absolute", top: 2,
                                left: forceInstall ? 20 : 2,
                                transition: "left 0.2s",
                              }} />
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
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
                    {/* Watch progress bar */}
                    {watchProgress[item.url] && watchProgress[item.url].duration > 0 && (
                      <div style={{
                        position: "absolute", bottom: 0, left: 0, right: 0, height: 3,
                        background: "rgba(0,0,0,0.5)",
                      }}>
                        <div style={{
                          width: `${Math.min(100, (watchProgress[item.url].currentTime / watchProgress[item.url].duration) * 100)}%`,
                          height: "100%",
                          background: "var(--accent, #e50914)",
                          borderRadius: "0 1px 1px 0",
                        }} />
                      </div>
                    )}
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

      {/* Watch History modal (admin) */}
      {showWatchHistory && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99, zoom: fontScale !== 1 ? 1 / fontScale : undefined }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)" }} onClick={() => setShowWatchHistory(false)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            zIndex: 100, background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: 12, padding: isWide ? 24 : 16,
            width: isWide ? "min(700px, 70vw)" : "calc(100vw - 24px)",
            maxHeight: "85vh", display: "flex", flexDirection: "column",
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexShrink: 0 }}>
              <h3 style={{ fontSize: isWide ? 20 : 17, fontWeight: 700, color: "var(--text-primary)" }}>Watch History</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  onClick={() => {
                    if (watchHistoryTab === "users") handleOpenWatchHistory();
                    else fetchPopularMovies();
                  }}
                  style={{
                    width: 32, height: 32, borderRadius: "50%", border: "none",
                    background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                    <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowWatchHistory(false)}
                  style={{
                    width: 32, height: 32, borderRadius: "50%", border: "none",
                    background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Subtabs */}
            <div style={{ display: "flex", gap: 0, marginBottom: isWide ? 12 : 8, flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
              {(["users", "movies"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setWatchHistoryTab(tab);
                    if (tab === "movies" && popularMovies.length === 0) fetchPopularMovies();
                  }}
                  style={{
                    flex: 1, padding: isWide ? "8px 12px" : "6px 8px", border: "none", background: "transparent",
                    color: watchHistoryTab === tab ? "var(--text-primary)" : "var(--text-muted)",
                    fontSize: isWide ? 13 : 12, fontWeight: 600, cursor: "pointer",
                    borderBottom: watchHistoryTab === tab ? "2px solid var(--accent, #e50914)" : "2px solid transparent",
                    marginBottom: -1,
                  }}
                >
                  {tab === "users" ? "Users" : "Movies"}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {watchHistoryTab === "users" ? (
                /* Users tab */
                watchHistoryLoading ? (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40, fontSize: 14 }}>Loading...</div>
                ) : watchHistory.length === 0 ? (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40, fontSize: 14 }}>No watch history</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {watchHistory.map((entry, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: isWide ? 12 : 8,
                        padding: isWide ? "10px 8px" : "8px 4px", borderRadius: 6,
                        borderBottom: "1px solid var(--border)",
                      }}>
                        {entry.user_picture ? (
                          <img src={entry.user_picture} alt="" referrerPolicy="no-referrer" style={{
                            width: isWide ? 32 : 28, height: isWide ? 32 : 28, borderRadius: "50%", flexShrink: 0,
                          }} />
                        ) : (
                          <div style={{
                            width: isWide ? 32 : 28, height: isWide ? 32 : 28, borderRadius: "50%", flexShrink: 0,
                            background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: isWide ? 14 : 12, fontWeight: 700, color: "var(--text-muted)",
                          }}>
                            {(entry.user_name || entry.user_email || "?")[0].toUpperCase()}
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: isWide ? 13 : 12, fontWeight: 600, color: "var(--text-primary)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {entry.title || entry.url}
                          </div>
                          <div style={{ fontSize: isWide ? 11 : 10, color: "var(--text-muted)", marginTop: 2 }}>
                            {entry.user_name || entry.user_email}
                            <span style={{ margin: "0 6px" }}>&middot;</span>
                            {new Date(entry.started_at + "Z").toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                /* Movies tab */
                popularMoviesLoading ? (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40, fontSize: 14 }}>Loading...</div>
                ) : popularMovies.length === 0 ? (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40, fontSize: 14 }}>No movies</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {/* Auto-download setting */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: isWide ? "10px 8px" : "8px 4px",
                      borderBottom: "1px solid var(--border)",
                      background: "rgba(255,255,255,0.03)", borderRadius: 6,
                      marginBottom: 4,
                    }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, flexShrink: 0, color: "var(--text-muted)" }}>
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7,10 12,15 17,10" /><line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      <span style={{ fontSize: isWide ? 12 : 11, color: "var(--text-secondary)", flex: 1 }}>
                        Auto download when viewers &ge;
                      </span>
                      <select
                        value={autoDownloadThreshold}
                        onChange={(e) => handleSaveAutoDownload(parseInt(e.target.value))}
                        style={{
                          background: "var(--bg-base)", color: "var(--text-primary)", border: "1px solid var(--border)",
                          borderRadius: 4, padding: "4px 8px", fontSize: isWide ? 12 : 11, cursor: "pointer",
                        }}
                      >
                        <option value={0}>Off</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                      </select>
                    </div>

                    {/* Movie list */}
                    {popularMovies.map((movie) => (
                      <div key={movie.url} style={{
                        display: "flex", alignItems: "center", gap: isWide ? 12 : 8,
                        padding: isWide ? "10px 8px" : "8px 4px", borderRadius: 6,
                        borderBottom: "1px solid var(--border)",
                      }}>
                        {/* Viewer count badge */}
                        <div style={{
                          width: isWide ? 36 : 30, height: isWide ? 36 : 30, borderRadius: 6, flexShrink: 0,
                          background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center",
                          flexDirection: "column",
                        }}>
                          <div style={{ fontSize: isWide ? 16 : 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1 }}>
                            {movie.viewer_count}
                          </div>
                          <div style={{ fontSize: 7, color: "var(--text-muted)", lineHeight: 1, marginTop: 1 }}>
                            {movie.viewer_count === 1 ? "user" : "users"}
                          </div>
                        </div>

                        {/* Title + info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: isWide ? 13 : 12, fontWeight: 600, color: "var(--text-primary)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {movie.title || movie.url}
                          </div>
                          <div style={{ fontSize: isWide ? 11 : 10, color: "var(--text-muted)", marginTop: 2 }}>
                            {movie.play_count} plays
                            <span style={{ margin: "0 6px" }}>&middot;</span>
                            {new Date(movie.last_watched + "Z").toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                          </div>
                        </div>

                        {/* Download button */}
                        {(() => {
                          const isDownloading = movie.downloading || downloadingUrls.has(movie.url);
                          return (
                            <button
                              onClick={() => !movie.downloaded && !isDownloading && handleDownloadMovie(movie.url)}
                              disabled={movie.downloaded || isDownloading}
                              style={{
                                padding: isWide ? "6px 12px" : "4px 10px", borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: movie.downloaded ? "rgba(34,197,94,0.15)" : isDownloading ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.08)",
                                color: movie.downloaded ? "#22c55e" : isDownloading ? "#3b82f6" : "var(--text-secondary)",
                                fontSize: isWide ? 11 : 10, fontWeight: 600,
                                cursor: movie.downloaded || isDownloading ? "default" : "pointer",
                                whiteSpace: "nowrap", flexShrink: 0,
                              }}
                            >
                              {movie.downloaded ? "Downloaded" : isDownloading ? "Downloading..." : "Download"}
                            </button>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Video Storage modal (admin) */}
      {showVideoStorage && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99, zoom: fontScale !== 1 ? 1 / fontScale : undefined }}>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)" }} onClick={() => setShowVideoStorage(false)} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            zIndex: 100, background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: 12, padding: isWide ? 24 : 16,
            width: isWide ? "min(700px, 70vw)" : "calc(100vw - 24px)",
            maxHeight: "85vh", display: "flex", flexDirection: "column",
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isWide ? 16 : 12, flexShrink: 0 }}>
              <h3 style={{ fontSize: isWide ? 20 : 17, fontWeight: 700, color: "var(--text-primary)" }}>Video Storage</h3>
              <button
                onClick={() => setShowVideoStorage(false)}
                style={{
                  width: 32, height: 32, borderRadius: "50%", border: "none",
                  background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Storage bar + max setting */}
            <div style={{ flexShrink: 0, marginBottom: isWide ? 16 : 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: isWide ? 13 : 12, color: "var(--text-secondary)" }}>
                  {(videoTotalSize / 1024 / 1024 / 1024).toFixed(2)} GB / {(videoMaxBytes / 1024 / 1024 / 1024).toFixed(0)} GB
                  <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>({videoList.length} files)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: isWide ? 12 : 11, color: "var(--text-muted)" }}>Max:</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={Math.round(videoMaxBytes / 1024 / 1024 / 1024)}
                    onChange={(e) => handleMaxStorageChange(Number(e.target.value))}
                    style={{
                      width: 52, padding: "4px 6px", borderRadius: 4,
                      border: "1px solid var(--border)", background: "var(--bg-base)",
                      color: "var(--text-primary)", fontSize: isWide ? 13 : 12, textAlign: "center",
                      outline: "none",
                    }}
                  />
                  <span style={{ fontSize: isWide ? 12 : 11, color: "var(--text-muted)" }}>GB</span>
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 3, transition: "width 0.3s",
                  width: `${Math.min(100, (videoTotalSize / videoMaxBytes) * 100)}%`,
                  background: videoTotalSize / videoMaxBytes > 0.9 ? "var(--accent)" : "var(--success)",
                }} />
              </div>
            </div>

            {/* Delete All button */}
            {videoList.length > 0 && (
              <div style={{ flexShrink: 0, marginBottom: isWide ? 12 : 8 }}>
                <button
                  onClick={handleDeleteAllVideos}
                  style={{
                    padding: isWide ? "8px 16px" : "7px 14px", borderRadius: 6, border: "1px solid var(--accent)",
                    background: "transparent", color: "var(--accent)",
                    fontSize: isWide ? 13 : 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Delete All ({(videoTotalSize / 1024 / 1024).toFixed(0)} MB)
                </button>
              </div>
            )}

            {/* Video list */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {videoLoading ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40, fontSize: 14 }}>Loading...</div>
              ) : videoList.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 40, fontSize: 14 }}>No videos on server</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {videoList.map((v) => (
                    <div key={v.filename} style={{
                      display: "flex", alignItems: "center", gap: isWide ? 12 : 8,
                      padding: isWide ? "10px 8px" : "8px 4px", borderRadius: 6,
                      borderBottom: "1px solid var(--border)",
                    }}>
                      <div style={{
                        width: isWide ? 36 : 30, height: isWide ? 36 : 30, borderRadius: 6, flexShrink: 0,
                        background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ width: isWide ? 18 : 14, height: isWide ? 18 : 14 }}>
                          <polygon points="5,3 19,12 5,21" />
                        </svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: isWide ? 13 : 12, fontWeight: 600, color: "var(--text-primary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {v.filename}
                        </div>
                        <div style={{ fontSize: isWide ? 11 : 10, color: "var(--text-muted)", marginTop: 2 }}>
                          {v.size >= 1024 * 1024 * 1024
                            ? `${(v.size / 1024 / 1024 / 1024).toFixed(2)} GB`
                            : `${(v.size / 1024 / 1024).toFixed(1)} MB`}
                          <span style={{ margin: "0 6px" }}>&middot;</span>
                          {new Date(v.modified * 1000).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteVideo(v.filename)}
                        style={{
                          width: isWide ? 32 : 28, height: isWide ? 32 : 28, borderRadius: 6, border: "none",
                          background: "rgba(255,255,255,0.06)", color: "var(--text-muted)",
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: isWide ? 16 : 14, height: isWide ? 16 : 14 }}>
                          <polyline points="3,6 5,6 21,6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
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

function menuItemStyle(disabled: boolean, wide = false): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: wide ? 12 : 10, width: "100%",
    padding: wide ? "12px 8px" : "10px 12px", border: "none", borderRadius: 6,
    background: "transparent", color: disabled ? "var(--text-muted)" : "var(--text-primary)",
    fontSize: wide ? 15 : 13, fontWeight: 500, cursor: disabled ? "default" : "pointer",
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
