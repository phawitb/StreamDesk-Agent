import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useWebSocket } from "./hooks/useWebSocket";
import { ChatWindow } from "./components/ChatWindow";
import { StatusBar } from "./components/StatusBar";
import { MovieBrowser } from "./components/MovieBrowser";
import { MediaControls } from "./components/MediaControls";
import { LoginScreen } from "./components/LoginScreen";
import type { AgentState, DisplayMessage, EpisodeInfo, EpisodeListMessage, MovieRecommendationMessage } from "./types/messages";
import "./App.css";

function App() {
  const { user, loading: authLoading, login, logout } = useAuth();
  const { connected, monitorInConnected, monitorOutConnected, pairedDevice, setPairedDevice, messages, send } = useWebSocket();
  const [activeTab, setActiveTab] = useState<"browse" | "chat" | "monitor">("browse");
  const [currentPoster, setCurrentPoster] = useState("");
  const [monitorMode, setMonitorMode] = useState<"inapp" | "device" | "url">(() => {
    const stored = localStorage.getItem("monitorMode");
    if (stored === "inapp" || stored === "device" || stored === "url") return stored;
    return "device"; // default (also handles old "outapp" value)
  });
  const [monitorFullscreen, setMonitorFullscreen] = useState(false);
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
  }, [setPairedDevice]);

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
      send({ type: "play_request", ...(isUrl ? { url: text } : { query: text }) });
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
      send({ type: "play_request", url });
      messages.push({ type: "chat", role: "user", content: url });
      if (poster) setCurrentPoster(poster);
      setActiveTab("chat");
    },
    [send, messages, isExternalDisconnected]
  );

  const isPlaying = currentState === "playing";
  const showMonitorTab = monitorMode === "inapp";

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

  return (
    <div className={`app ${monitorIsFullscreen ? "monitor-fullscreen" : ""}`}>
      <div className="app-body">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
              <rect x="2" y="3" width="20" height="18" rx="2" fill="var(--accent)" />
              <path d="M10 8v8l6-4-6-4z" fill="#fff" />
            </svg>
            StreamDesk
          </div>
          <nav className="sidebar-nav">
            <button className={`sidebar-nav-item ${activeTab === "browse" ? "active" : ""}`} onClick={() => setActiveTab("browse")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9,22 9,12 15,12 15,22" /></svg>
              Browse
            </button>
            <button className={`sidebar-nav-item ${activeTab === "chat" ? "active" : ""}`} onClick={() => setActiveTab("chat")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
              Chat
            </button>
            {showMonitorTab && (
              <button className={`sidebar-nav-item ${activeTab === "monitor" ? "active" : ""}`} onClick={() => setActiveTab("monitor")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                Monitor
                {!monitorConnected && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", marginLeft: "auto" }} />}
              </button>
            )}
          </nav>
          <div className="sidebar-footer">
            {user.picture && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px" }}>
                <img src={user.picture} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }} referrerPolicy="no-referrer" />
                <span style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.name || user.email}
                </span>
              </div>
            )}
            <StatusBar state={currentState} connected={connected} />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn-reset" onClick={() => send({ type: "command", action: "reset" })} style={{ flex: 1 }}>Reset</button>
              <button className="btn-reset" onClick={logout}>Logout</button>
            </div>
          </div>
        </aside>

        <div className="main-content">
          <div className={`panel-browse ${activeTab !== "browse" ? "hidden-mobile" : ""}`}>
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
            />
          </div>
          <div className={`panel-chat ${activeTab !== "chat" ? "hidden-mobile" : ""}`}>
            <ChatWindow
              messages={displayMessages}
              onSend={handleSend}
              isPlaying={isPlaying}
              onDownload={() => send({ type: "command", action: "download" })}
              episodes={episodes}
              onSelectEpisode={handleSelectEpisode}
              onSelectMovie={handleSelectMovie}
              thinkingText={thinkingText}
              disabled={isExternalDisconnected}
            />
          </div>
          {showMonitorTab && (
            <div
              className={`panel-monitor ${activeTab !== "monitor" ? "hidden-mobile" : ""}`}
              onClick={() => {
                if (activeTab === "monitor" && !isLandscape) {
                  setMonitorFullscreen((f) => !f);
                }
              }}
            >
              <iframe
                src="/monitorin"
                style={{ width: "100%", height: "100%", border: "none", background: "#000", pointerEvents: monitorIsFullscreen ? "none" : "auto" }}
                allow="autoplay; fullscreen"
              />
            </div>
          )}
        </div>
      </div>

      <div className="now-playing-bar">
        <MediaControls onMediaControl={handleMediaControl} title={currentTitle} poster={currentPoster} isPlaying={isPlaying} monitorMode={monitorMode} currentState={currentState} />
      </div>

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
    </div>
  );
}

export default App;
