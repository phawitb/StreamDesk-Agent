import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useWebSocket } from "./hooks/useWebSocket";
import { usePWAInstall } from "./hooks/usePWAInstall";
import { ChatWindow } from "./components/ChatWindow";
import { MovieBrowser } from "./components/MovieBrowser";
import { MediaControls } from "./components/MediaControls";
import { RemoteControl } from "./components/RemoteControl";
import { saveLastEpisode } from "./components/EpisodePicker";
import { LoginScreen } from "./components/LoginScreen";
import type { AgentState, DisplayMessage, EpisodeInfo, EpisodeListMessage, MovieRecommendationMessage, MusicResultsMessage } from "./types/messages";
import "./App.css";

/** Progress key: "url" for movies, "url::ep0" for series episodes */
function progressKey(url: string, epIndex: number): string {
  return epIndex >= 0 ? `${url}::ep${epIndex}` : url;
}

function getResumePos(url: string, epIndex: number): number {
  try {
    const progress = JSON.parse(localStorage.getItem("streamdesk_progress") || "{}");
    const saved = progress[progressKey(url, epIndex)];
    return saved?.currentTime && saved?.duration && saved.currentTime < saved.duration - 10 ? saved.currentTime : 0;
  } catch { return 0; }
}

function App() {
  const { user, loading: authLoading, login, logout } = useAuth();
  const { connected, monitorInConnected, monitorOutConnected, pairedDevice, setPairedDevice, messages, addMessage, send } = useWebSocket();
  const { canInstall, install } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<"browse" | "chat" | "monitor">(() => {
    const s = sessionStorage.getItem("activeTab");
    return (s === "browse" || s === "chat" || s === "monitor") ? s : "browse";
  });
  const [forceInstall, setForceInstall] = useState(true);
  const [currentPoster, setCurrentPoster] = useState(() => localStorage.getItem("streamdesk_poster") || "");
  const [playingUrl, setPlayingUrl] = useState(() => localStorage.getItem("streamdesk_playingUrl") || "");
  const [monitorMode, setMonitorMode] = useState<"inapp" | "device" | "url">(() => {
    const stored = localStorage.getItem("monitorMode");
    if (stored === "inapp" || stored === "device" || stored === "url") return stored;
    return "inapp"; // default
  });
  const [currentQuality, setCurrentQuality] = useState(0);
  const [monitorFullscreen, setMonitorFullscreen] = useState(false);
  const [orientationLock, setOrientationLock] = useState<"auto" | "landscape" | "portrait">("auto");
  const [desktopMonitorExpanded, setDesktopMonitorExpanded] = useState(false);
  const [autoSelectEpisode, setAutoSelectEpisode] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [monitorToken, setMonitorToken] = useState<string | null>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const playingEpisodeRef = useRef(-1); // -1 = no episode (movie), 0+ = episode index

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
  const [isDesktop, setIsDesktop] = useState(() => {
    // iPad portrait = mobile, iPad landscape = desktop
    return window.innerWidth > 768 && window.innerWidth > window.innerHeight;
  });
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

  // Persist UI state
  useEffect(() => { sessionStorage.setItem("activeTab", activeTab); }, [activeTab]);
  useEffect(() => { localStorage.setItem("streamdesk_playingUrl", playingUrl); }, [playingUrl]);
  useEffect(() => { localStorage.setItem("streamdesk_poster", currentPoster); }, [currentPoster]);



  // Trap back button / edge swipe — fake-click current tab so app never exits
  useEffect(() => {
    history.replaceState({ guard: true }, "");
    for (let i = 0; i < 3; i++) history.pushState({ guard: true }, "");
    const onPopState = () => {
      const tab = activeTabRef.current;
      setActiveTab(tab === "browse" ? "chat" : "browse");
      requestAnimationFrame(() => {
        setActiveTab(tab);
        history.pushState({ guard: true }, "");
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Detect desktop vs mobile
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth > 768 && window.innerWidth > window.innerHeight);
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

  // Orientation lock via button only (no sensor)
  useEffect(() => {
    setIsLandscape(orientationLock === "landscape");
    if (orientationLock === "auto" || orientationLock === "portrait") {
      setMonitorFullscreen(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } else if (orientationLock === "landscape") {
      // Enter fullscreen for landscape
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    }
  }, [orientationLock]);

  // Save watch progress from media_status events
  const playingUrlRef = useRef(playingUrl);
  playingUrlRef.current = playingUrl;
  useEffect(() => {
    let lastSave = 0;
    let lastServerSave = 0;
    const handler = (e: CustomEvent) => {
      const data = e.detail;
      if (data.type === "media_status" && playingUrlRef.current) {
        const ct = data.currentTime || 0;
        const dur = data.duration || 0;
        if (dur > 0 && ct > 5 && Date.now() - lastSave > 3000) {
          lastSave = Date.now();
          try {
            const key = progressKey(playingUrlRef.current, playingEpisodeRef.current);
            const progress = JSON.parse(localStorage.getItem("streamdesk_progress") || "{}");
            progress[key] = { currentTime: ct, duration: dur };
            localStorage.setItem("streamdesk_progress", JSON.stringify(progress));
          } catch {}
          // Also save to server (throttled: every 30s)
          if (Date.now() - lastServerSave > 30000) {
            lastServerSave = Date.now();
            fetch("/api/history/progress", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: playingUrlRef.current, current_time: ct, duration: dur, episode_index: playingEpisodeRef.current }),
            }).catch(() => {});
          }
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

  const effectiveLandscape = orientationLock === "auto" ? isLandscape : orientationLock === "landscape";
  const monitorIsFullscreen = !isDesktop && activeTab === "monitor" && (effectiveLandscape || monitorFullscreen);

  const SHOW_IN_CHAT_STATES = new Set(["playing", "error", "idle"]);

  const displayMessages = useMemo<DisplayMessage[]>(() => {
    return messages
      .filter((m) => {
        if (m.type === "chat" || m.type === "error" || m.type === "movie_recommendations" || m.type === "music_results") return true;
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
        if (m.type === "music_results") {
          const mus = m as MusicResultsMessage;
          return { id: `music-${i}`, role: "assistant" as const, content: mus.message, timestamp: new Date(), musicResults: mus.results };
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

  // Track quality changes from server
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && (last as any).type === "quality_changed") {
      setCurrentQuality((last as any).quality);
    }
  }, [messages]);

  const isYouTube = playingUrl.includes("youtube.com") || playingUrl.includes("youtu.be");

  const handleQualityChange = useCallback((quality: number) => {
    setCurrentQuality(quality);
    send({ type: "media_control", action: "set_quality", value: quality } as any);
  }, [send]);

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
    // Fallback: restore from sessionStorage (app restart)
    return localStorage.getItem("streamdesk_title") || "";
  }, [messages]);

  // Persist title to sessionStorage
  useEffect(() => {
    if (currentTitle) localStorage.setItem("streamdesk_title", currentTitle);
  }, [currentTitle]);

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
      const ep = episodes?.find((e) => e.index === index);
      const epText = ep?.text || `ตอนที่ ${index + 1}`;
      playingEpisodeRef.current = index;
      const resumePos = playingUrl ? getResumePos(playingUrl, index) : 0;
      send({ type: "select_episode", index, episode_text: epText, resume_position: resumePos } as any);
      addMessage({ type: "chat", role: "user", content: `เลือก ${epText}` });
      addMessage({ type: "status", state: "loading_player", message: "กำลังโหลด...", timestamp: new Date().toISOString() } as any);
      // Save last episode for this series
      if (playingUrl) saveLastEpisode(playingUrl, index);
    },
    [send, addMessage, episodes, playingUrl]
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
        addMessage({ type: "chat", role: "user", content: text });
        addMessage({
          type: "chat",
          role: "assistant",
          content: "โปรดเชื่อมต่อจอก่อน หรือปรับเป็นโหมด In-App (Settings > Monitor Mode)",
        });
        setActiveTab("chat");
        return;
      }
      if (isUrl) {
        playingEpisodeRef.current = -1; // reset episode on new URL
        const resumePos = getResumePos(text, -1);
        send({ type: "play_request", url: text, resume_position: resumePos, poster: currentPoster } as any);
        setPlayingUrl(text);
      } else {
        send({ type: "play_request", query: text });
      }
      addMessage({ type: "chat", role: "user", content: text });
      if (isUrl) {
        const ytMatch = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
        if (ytMatch) {
          setCurrentPoster(`https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`);
        }
      }
      setActiveTab("chat");
    },
    [send, addMessage, isExternalDisconnected]
  );

  const handlePlayMusic = useCallback(
    (url: string, thumbnail: string, title: string) => {
      if (isExternalDisconnected) {
        addMessage({
          type: "chat",
          role: "assistant",
          content: "โปรดเชื่อมต่อจอก่อน หรือปรับเป็นโหมด In-App (Settings > Monitor Mode)",
        });
        setActiveTab("chat");
        return;
      }
      playingEpisodeRef.current = -1;
      const resumePos = getResumePos(url, -1);
      send({ type: "play_request", url, resume_position: resumePos, poster: thumbnail, title } as any);
      setPlayingUrl(url);
      setCurrentPoster(thumbnail);
      addMessage({ type: "chat", role: "user", content: title });
      setActiveTab("chat");
    },
    [send, addMessage, isExternalDisconnected]
  );

  const handleSelectMovie = useCallback(
    (url: string, poster?: string, title?: string) => {
      if (isExternalDisconnected) {
        addMessage({
          type: "chat",
          role: "assistant",
          content: "โปรดเชื่อมต่อจอก่อน หรือปรับเป็นโหมด In-App (Settings > Monitor Mode)",
        });
        setActiveTab("chat");
        return;
      }
      playingEpisodeRef.current = -1; // reset episode on new URL
      const resumePos = getResumePos(url, -1);
      send({ type: "play_request", url, resume_position: resumePos, poster: poster || currentPoster } as any);
      setPlayingUrl(url);
      addMessage({ type: "chat", role: "user", content: url });
      if (poster) setCurrentPoster(poster);
      setActiveTab("chat");
    },
    [send, addMessage, isExternalDisconnected, currentPoster]
  );

  const isPlaying = currentState === "playing";
  const showMonitorTab = true; // Always show monitor tab
  const isAdmin = user?.email === "phawit.boo@gmail.com";

  const handleReplay = useCallback(() => {
    if (playingUrl) {
      setAutoSelectEpisode(true);
      const resumePos = getResumePos(playingUrl, playingEpisodeRef.current);
      send({ type: "play_request", url: playingUrl, resume_position: resumePos, poster: currentPoster } as any);
      // Stay on current tab — don't switch to chat
    }
  }, [playingUrl, send, currentPoster]);

  // Reset poster and orientation lock when state goes idle (keep if playingUrl still set)
  useEffect(() => {
    if (currentState === "idle" && !playingUrl) {
      setCurrentPoster("");
      setOrientationLock("auto");
      localStorage.removeItem("streamdesk_title");
    }
  }, [currentState, playingUrl]);

  // Auto-switch to chat when episodes appear, auto-select if replay/stuck
  useEffect(() => {
    if (episodes && episodes.length > 0) {
      if (autoSelectEpisode && playingUrl) {
        // Auto-select last watched episode
        try {
          const data = JSON.parse(localStorage.getItem("streamdesk_last_episode") || "{}");
          const lastIndex = data[playingUrl];
          if (lastIndex !== undefined) {
            const idx = Math.min(lastIndex, episodes.length - 1);
            setTimeout(() => handleSelectEpisode(idx), 300);
            setAutoSelectEpisode(false);
            return;
          }
        } catch {}
        setAutoSelectEpisode(false);
        return; // Don't switch tab during auto-replay
      }
      setActiveTab("chat");
    }
  }, [episodes, autoSelectEpisode, playingUrl, handleSelectEpisode]);

  // Auto-switch tabs based on state (skip during auto-replay)
  useEffect(() => {
    if (currentState === "launching" || currentState === "navigating" || currentState === "loading_player") {
      if (!autoSelectEpisode) setActiveTab("chat");
    } else if (currentState === "playing") {
      // Ready — add to history + switch to monitor
      if (playingUrl) {
        window.dispatchEvent(new CustomEvent("streamdesk_history", {
          detail: { url: playingUrl, poster: currentPoster, title: currentTitle },
        }));
      }
      if (monitorMode === "inapp") {
        setActiveTab("monitor");
      }
    }
  }, [currentState, monitorMode, playingUrl, currentPoster, currentTitle]);

  // Auth loading
  if (authLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg-base)" }}>
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
        height: "100vh", background: "var(--bg-base)", padding: 32, textAlign: "center",
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
      onPlayMusic={handlePlayMusic}
      seriesUrl={playingUrl}
      thinkingText={thinkingText}
      disabled={isExternalDisconnected}
    />
  );

  const monitorPanel = showMonitorTab ? (
    monitorMode === "inapp" ? (
      <div
        className={`panel-monitor${desktopMonitorExpanded ? " desktop-expanded" : ""}`}
        onClick={() => {
          if (!isDesktop && activeTab === "monitor" && !effectiveLandscape) {
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
        {isDesktop ? (
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
        ) : activeTab === "monitor" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOrientationLock((prev) => {
                if (prev === "auto") return "landscape";
                if (prev === "landscape") return "portrait";
                return "auto";
              });
            }}
            style={{
              position: "absolute", top: 8, right: 8, zIndex: 210,
              width: 36, height: 36, borderRadius: 8, border: "none",
              background: "rgba(0,0,0,0.6)", color: orientationLock === "auto" ? "rgba(255,255,255,0.7)" : "#fff",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              backdropFilter: "blur(4px)", transition: "opacity 0.2s",
            }}
            title={orientationLock === "auto" ? "Auto rotation" : orientationLock === "landscape" ? "Landscape (locked)" : "Portrait (locked)"}
          >
            {orientationLock === "landscape" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                <rect x="1" y="5" width="22" height="14" rx="2" />
                <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
              </svg>
            ) : orientationLock === "portrait" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                <rect x="5" y="1" width="14" height="22" rx="2" />
                <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                <path d="M21 12a9 9 0 01-9 9m-9-9a9 9 0 019-9" />
                <polyline points="21,3 21,9 15,9" />
                <polyline points="3,21 3,15 9,15" />
              </svg>
            )}
          </button>
        )}
      </div>
    ) : (
      /* External monitor mode — show remote control with big buttons */
      <div className="panel-monitor" style={{ position: "relative" }}>
        <RemoteControl
          onMediaControl={handleMediaControl}
          title={currentTitle}
          poster={currentPoster}
          isPlaying={isPlaying}
          isYouTube={isYouTube}
          currentQuality={currentQuality}
          onQualityChange={handleQualityChange}
        />
      </div>
    )
  ) : null;

  return (
    <div className={`app ${monitorIsFullscreen ? "monitor-fullscreen" : ""}`} style={fontScale !== 1 ? { zoom: fontScale, height: `calc(100vh / ${fontScale})` } : undefined}>
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
          <MediaControls onMediaControl={handleMediaControl} title={currentTitle} poster={currentPoster} isPlaying={isPlaying} monitorMode={monitorMode} currentState={currentState} statusText={thinkingText} onReplay={playingUrl ? handleReplay : undefined} onReload={playingUrl ? handleReplay : undefined} isYouTube={isYouTube} currentQuality={currentQuality} onQualityChange={handleQualityChange} />
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
