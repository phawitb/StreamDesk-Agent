import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useWebSocket } from "./hooks/useWebSocket";
import { usePWAInstall } from "./hooks/usePWAInstall";
import { ChatWindow } from "./components/ChatWindow";
import { MovieBrowser } from "./components/MovieBrowser";
import { MediaControls } from "./components/MediaControls";
import { LoginScreen } from "./components/LoginScreen";
import type { AgentState, DisplayMessage, EpisodeInfo, EpisodeListMessage, MovieRecommendationMessage } from "./types/messages";
import "./App.css";

function App() {
  const { user, loading: authLoading, login, logout } = useAuth();
  const { connected, monitorInConnected, monitorOutConnected, pairedDevice, setPairedDevice, messages, send } = useWebSocket();
  const { canInstall, install } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<"browse" | "chat" | "monitor">("browse");
  const [forceInstall, setForceInstall] = useState(true);
  const [currentPoster, setCurrentPoster] = useState("");
  const [playingUrl, setPlayingUrl] = useState("");
  const [monitorMode, setMonitorMode] = useState<"inapp" | "device" | "url">(() => {
    const stored = localStorage.getItem("monitorMode");
    if (stored === "inapp" || stored === "device" || stored === "url") return stored;
    return "inapp"; // default
  });
  const [monitorFullscreen, setMonitorFullscreen] = useState(false);
  const [desktopMonitorExpanded, setDesktopMonitorExpanded] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [monitorToken, setMonitorToken] = useState<string | null>(null);

  // Persist monitor mode and sync to backend
  useEffect(() => {
    localStorage.setItem("monitorMode", monitorMode);
    const backendMode = monitorMode === "inapp" ? "inapp" : "outapp";
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monitor_mode: backendMode }),
    }).catch(() => {});
  }, [monitorMode]);

  const monitorConnected = monitorMode === "inapp" ? monitorInConnected : monitorOutConnected;

  // Load initial settings (paired device + monitor token)
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.paired_device_key) setPairedDevice(data.paired_device_key);
        if (data.monitor_token) setMonitorToken(data.monitor_token);
      })
      .catch(() => {});
    fetch("/api/app-settings")
      .then((r) => r.json())
      .then((data) => setForceInstall(!!data.force_install))
      .catch(() => {});
  }, [setPairedDevice]);

  const handleForceInstallChange = useCallback(async (enabled: boolean) => {
    setForceInstall(enabled);
    await fetch("/api/app-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force_install: enabled }),
    }).catch(() => {});
  }, []);

  const handlePairDevice = useCallback(async (key: string) => {
    try {
      const resp = await fetch("/api/monitor/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_key: key }),
      });
      if (resp.ok) {
        setPairedDevice(key);
      }
    } catch (e) {
      console.error("Pair failed:", e);
    }
  }, [setPairedDevice]);

  const handleUnpairDevice = useCallback(async () => {
    try {
      await fetch("/api/monitor/unpair", { method: "POST" });
      setPairedDevice(null);
    } catch (e) {
      console.error("Unpair failed:", e);
    }
  }, [setPairedDevice]);

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth > 768);
  const [rightWidth, setRightWidth] = useState(() => {
    const stored = localStorage.getItem("desktopRightWidth");
    return stored ? parseInt(stored) : Math.round(window.innerWidth / 3);
  });
  const rightWidthRef = useRef(rightWidth);
  rightWidthRef.current = rightWidth;
  const [fontScale, setFontScale] = useState(() => {
    const stored = localStorage.getItem("fontScale");
    if (stored) return parseFloat(stored);
    return window.innerWidth > 768 ? 1.2 : 1.0;
  });
  const handleFontScaleChange = useCallback((scale: number) => {
    setFontScale(scale);
    localStorage.setItem("fontScale", String(scale));
  }, []);

  // Detect desktop vs mobile
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Draggable column divider — inline handlers (no ref/useEffect needed)
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidthRef.current;
    const target = e.currentTarget as HTMLElement;
    target.classList.add("dragging");
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const delta = startX - ev.clientX;
      const newW = Math.max(280, Math.min(window.innerWidth * 0.6, startW + delta));
      setRightWidth(newW);
    };
    const onUp = () => {
      target.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      localStorage.setItem("desktopRightWidth", String(rightWidthRef.current));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const handleDividerTouchStart = useCallback((e: React.TouchEvent) => {
    const startX = e.touches[0].clientX;
    const startW = rightWidthRef.current;
    const target = e.currentTarget as HTMLElement;
    target.classList.add("dragging");
    const onMove = (ev: TouchEvent) => {
      const delta = startX - ev.touches[0].clientX;
      const newW = Math.max(280, Math.min(window.innerWidth * 0.6, startW + delta));
      setRightWidth(newW);
    };
    const onUp = () => {
      target.classList.remove("dragging");
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
      localStorage.setItem("desktopRightWidth", String(rightWidthRef.current));
    };
    document.addEventListener("touchmove", onMove);
    document.addEventListener("touchend", onUp);
  }, []);

  // Detect landscape orientation
  useEffect(() => {
    const checkOrientation = () => {
      const landscape = window.innerWidth > window.innerHeight;
      setIsLandscape(landscape);
    };
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    return () => window.removeEventListener("resize", checkOrientation);
  }, []);

  // Save watch progress from media_status events
  const playingUrlRef = useRef(playingUrl);
  playingUrlRef.current = playingUrl;
  useEffect(() => {
    let lastSave = 0;
    const handler = (e: CustomEvent) => {
      const data = e.detail;
      if (data.type === "media_status" && playingUrlRef.current) {
        const ct = data.currentTime || 0;
        const dur = data.duration || 0;
        if (dur > 0 && ct > 5 && Date.now() - lastSave > 3000) {
          lastSave = Date.now();
          try {
            const progress = JSON.parse(localStorage.getItem("streamdesk_progress") || "{}");
            progress[playingUrlRef.current] = { currentTime: ct, duration: dur };
            localStorage.setItem("streamdesk_progress", JSON.stringify(progress));
          } catch {}
        }
      }
    };
    window.addEventListener("media_status" as any, handler as any);
    return () => window.removeEventListener("media_status" as any, handler as any);
  }, []);

  // Detect virtual keyboard via visualViewport height
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fullHeight = window.innerHeight;
    const onResize = () => {
      // keyboard is visible when viewport shrinks by >100px
      setKeyboardVisible(fullHeight - vv.height > 100);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  const monitorIsFullscreen = activeTab === "monitor" && (isLandscape || monitorFullscreen);

  const SHOW_IN_CHAT_STATES = new Set(["playing", "error", "idle"]);

  const displayMessages = useMemo<DisplayMessage[]>(() => {
    return messages
      .filter((m) => {
        if (m.type === "chat" || m.type === "error" || m.type === "movie_recommendations") return true;
        if (m.type === "status") {
          const state = (m as { state: string }).state;
          return SHOW_IN_CHAT_STATES.has(state);
        }
        return false;
      })
      .map((m, i) => {
        if (m.type === "chat") {
          return { id: `msg-${i}`, role: m.role as "user" | "assistant", content: m.content, timestamp: new Date() };
        }
        if (m.type === "status") {
          return { id: `status-${i}`, role: "system" as const, content: m.message, timestamp: new Date(m.timestamp), state: m.state };
        }
        if (m.type === "movie_recommendations") {
          const rec = m as MovieRecommendationMessage;
          return { id: `rec-${i}`, role: "assistant" as const, content: rec.message, timestamp: new Date(), recommendations: rec.movies };
        }
        return { id: `err-${i}`, role: "system" as const, content: `Error: ${m.message}`, timestamp: new Date() };
      });
  }, [messages]);

  const thinkingText = useMemo<string>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "status") {
        const s = messages[i] as { state: string; message: string };
        if (!SHOW_IN_CHAT_STATES.has(s.state)) return s.message;
        return "";
      }
    }
    return "";
  }, [messages]);

  const currentState = useMemo<AgentState>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "status") return (messages[i] as { state: AgentState }).state;
    }
    return "idle";
  }, [messages]);

  const currentTitle = useMemo<string>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "status") {
        const msg = messages[i] as { state: string; message: string; title?: string };
        if (msg.title) return msg.title;
        if (msg.state === "playing" && msg.message) {
          const match = msg.message.match(/กำลังเล่น:\s*(.+)/);
          if (match) return match[1];
          return msg.message;
        }
      }
    }
    return "";
  }, [messages]);

  const episodes = useMemo<EpisodeInfo[] | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "episode_list") return (messages[i] as EpisodeListMessage).episodes;
      if (messages[i].type === "status") {
        const state = (messages[i] as { state: string }).state;
        if (state === "loading_player" || state === "playing") return null;
      }
    }
    return null;
  }, [messages]);

  // Is external mode and no monitor connected?
  const isExternalDisconnected = monitorMode !== "inapp" && !monitorOutConnected;

  const handleSelectEpisode = useCallback(
    (index: number) => {
      send({ type: "select_episode", index });
      const ep = episodes?.find((e) => e.index === index);
      messages.push({ type: "chat", role: "user", content: `เลือก ${ep?.text || `ตอนที่ ${index + 1}`}` });
    },
    [send, messages, episodes]
  );

  const handleMediaControl = useCallback(
    (action: string, value?: number) => {
      send({ type: "media_control", action: action as any, value });
    },
    [send]
  );

  const handleSend = useCallback(
    (text: string) => {
      const isUrl = text.startsWith("http://") || text.startsWith("https://");
      if (isUrl && isExternalDisconnected) {
        messages.push({ type: "chat", role: "user", content: text });
        messages.push({
          type: "chat",
          role: "assistant",
          content: "โปรดเชื่อมต่อจอก่อน หรือปรับเป็นโหมด In-App (Settings > Monitor Mode)",
        });
        setActiveTab("chat");
        return;
      }
      if (isUrl) {
        const progress = JSON.parse(localStorage.getItem("streamdesk_progress") || "{}");
        const saved = progress[text];
        const resumePos = saved?.currentTime && saved?.duration && saved.currentTime < saved.duration - 10 ? saved.currentTime : 0;
        send({ type: "play_request", url: text, resume_position: resumePos });
        setPlayingUrl(text);
      } else {
        send({ type: "play_request", query: text });
      }
      messages.push({ type: "chat", role: "user", content: text });
      // Extract YouTube/Bilibili thumbnail
      if (isUrl) {
        const ytMatch = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
        if (ytMatch) {
          setCurrentPoster(`https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`);
        }
      }
      setActiveTab("chat");
    },
    [send, messages, isExternalDisconnected]
  );

  const handleSelectMovie = useCallback(
    (url: string, poster?: string) => {
      if (isExternalDisconnected) {
        messages.push({
          type: "chat",
          role: "assistant",
          content: "โปรดเชื่อมต่อจอก่อน หรือปรับเป็นโหมด In-App (Settings > Monitor Mode)",
        });
        setActiveTab("chat");
        return;
      }
      const progress = JSON.parse(localStorage.getItem("streamdesk_progress") || "{}");
      const saved = progress[url];
      const resumePos = saved?.currentTime && saved?.duration && saved.currentTime < saved.duration - 10 ? saved.currentTime : 0;
      send({ type: "play_request", url, resume_position: resumePos });
      setPlayingUrl(url);
      messages.push({ type: "chat", role: "user", content: url });
      if (poster) setCurrentPoster(poster);
      setActiveTab("chat");
    },
    [send, messages, isExternalDisconnected]
  );

  const isPlaying = currentState === "playing";
  const showMonitorTab = monitorMode === "inapp";
  const isAdmin = user?.email === "phawit.boo@gmail.com";

  const handleReplay = useCallback(() => {
    if (playingUrl) {
      handleSelectMovie(playingUrl, currentPoster || undefined);
    }
  }, [playingUrl, currentPoster, handleSelectMovie]);

  // Reset poster when state goes idle
  useEffect(() => {
    if (currentState === "idle") {
      setCurrentPoster("");
    }
  }, [currentState]);

  // Auth loading
  if (authLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", background: "var(--bg-base)" }}>
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return <LoginScreen onLogin={login} />;
  }

  // Force install gate — mobile only, admin is exempt
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;
  const isMobileDevice = window.innerWidth <= 768;
  const isAdmin_ = user.email === "phawit.boo@gmail.com";
  if (forceInstall && !isStandalone && isMobileDevice && !isAdmin_) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        height: "100dvh", background: "var(--bg-base)", padding: 32, textAlign: "center",
      }}>
        <img src="/icon-192.png" alt="StreamDesk" style={{ width: 96, height: 96, borderRadius: 20, marginBottom: 24 }} />
        <h2 style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
          Install StreamDesk
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6, maxWidth: 320, marginBottom: 24 }}>
          {isIOS
            ? 'กดปุ่ม Share (กล่องมีลูกศร) แล้วเลือก "Add to Home Screen" เพื่อติดตั้งแอป'
            : "กรุณาติดตั้งแอปลงเครื่องก่อนใช้งาน"}
        </p>
        {canInstall && !isIOS && (
          <button
            onClick={install}
            style={{
              padding: "14px 40px", borderRadius: 8, border: "none",
              background: "var(--accent)", color: "#fff",
              fontSize: 16, fontWeight: 700, cursor: "pointer",
            }}
          >
            Install App
          </button>
        )}
        {isIOS && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            color: "var(--text-muted)", fontSize: 13, marginTop: 8,
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 20, height: 20 }}>
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16,6 12,2 8,6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            Share &gt; Add to Home Screen
          </div>
        )}
      </div>
    );
  }

  const browsePanel = (
    <MovieBrowser
      onSelectMovie={handleSelectMovie}
      connected={monitorConnected}
      currentState={currentState}
      monitorMode={monitorMode}
      onMonitorModeChange={setMonitorMode}
      pairedDeviceKey={pairedDevice}
      onPairDevice={handlePairDevice}
      onUnpairDevice={handleUnpairDevice}
      monitorToken={monitorToken}
      isExternalDisconnected={isExternalDisconnected}
      user={user}
      onLogout={logout}
      isAdmin={isAdmin}
      fontScale={fontScale}
      onFontScaleChange={handleFontScaleChange}
      forceInstall={forceInstall}
      onForceInstallChange={handleForceInstallChange}
    />
  );

  const chatPanel = (
    <ChatWindow
      messages={displayMessages}
      onSend={handleSend}
      isPlaying={isPlaying}
      onDownload={isAdmin ? () => send({ type: "command", action: "download" }) : undefined}
      episodes={episodes}
      onSelectEpisode={handleSelectEpisode}
      onSelectMovie={handleSelectMovie}
      thinkingText={thinkingText}
      disabled={isExternalDisconnected}
    />
  );

  const monitorPanel = showMonitorTab ? (
    <div
      className={`panel-monitor${desktopMonitorExpanded ? " desktop-expanded" : ""}`}
      onClick={() => {
        if (!isDesktop && activeTab === "monitor" && !isLandscape) {
          setMonitorFullscreen((f) => !f);
        }
      }}
      style={{ position: "relative" }}
    >
      <iframe
        src="/monitorin"
        style={{ width: "100%", height: "100%", border: "none", background: "#000", pointerEvents: monitorIsFullscreen ? "none" : "auto" }}
        allow="autoplay; fullscreen"
      />
      {isDesktop && (
        <button
          onClick={(e) => { e.stopPropagation(); setDesktopMonitorExpanded((v) => !v); }}
          style={{
            position: "absolute", top: 8, right: 8, zIndex: 10,
            width: 32, height: 32, borderRadius: 6, border: "none",
            background: "rgba(0,0,0,0.6)", color: "#fff",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(4px)", opacity: 0.7, transition: "opacity 0.2s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
          title={desktopMonitorExpanded ? "Exit fullscreen" : "Fullscreen"}
        >
          {desktopMonitorExpanded ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
              <polyline points="4,14 10,14 10,20" /><polyline points="20,10 14,10 14,4" />
              <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
              <polyline points="15,3 21,3 21,9" /><polyline points="9,21 3,21 3,15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
      )}
    </div>
  ) : null;

  return (
    <div className={`app ${monitorIsFullscreen ? "monitor-fullscreen" : ""}`} style={fontScale !== 1 ? { zoom: fontScale, height: `calc(100dvh / ${fontScale})` } : undefined}>
      <div className="app-body">
        <div className="main-content">
          {isDesktop ? (
            <>
              {/* Left column: Browse */}
              <div className="panel-browse">{browsePanel}</div>

              {/* Draggable divider */}
              <div className="column-divider" onMouseDown={handleDividerMouseDown} onTouchStart={handleDividerTouchStart} />

              {/* Right column: Monitor (small) + Chat */}
              <div className="desktop-right" style={{ width: rightWidth }}>
                {monitorPanel}
                <div className="panel-chat">{chatPanel}</div>
              </div>
            </>
          ) : (
            <>
              <div className={`panel-browse ${activeTab !== "browse" ? "hidden-mobile" : ""}`}>{browsePanel}</div>
              <div className={`panel-chat ${activeTab !== "chat" ? "hidden-mobile" : ""}`}>{chatPanel}</div>
              {monitorPanel && (
                <div style={{
                  flex: activeTab === "monitor" ? 1 : 0,
                  height: activeTab === "monitor" ? undefined : 0,
                  overflow: "hidden",
                  display: "flex", flexDirection: "column",
                }}>
                  {monitorPanel}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {!keyboardVisible && (
        <div className="now-playing-bar">
          <MediaControls onMediaControl={handleMediaControl} title={currentTitle} poster={currentPoster} isPlaying={isPlaying} monitorMode={monitorMode} currentState={currentState} onReplay={playingUrl ? handleReplay : undefined} />
        </div>
      )}

      {!keyboardVisible && !isDesktop && (
        <nav className="bottom-nav">
          <button className={`bottom-nav-item ${activeTab === "browse" ? "active" : ""}`} onClick={() => setActiveTab("browse")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9,22 9,12 15,12 15,22" /></svg>
            Browse
          </button>
          {showMonitorTab && (
            <button className={`bottom-nav-item ${activeTab === "monitor" ? "active" : ""}`} onClick={() => setActiveTab("monitor")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
              Monitor
            </button>
          )}
          <button className={`bottom-nav-item ${activeTab === "chat" ? "active" : ""}`} onClick={() => setActiveTab("chat")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
            Chat
          </button>
        </nav>
      )}
    </div>
  );
}

export default App;
