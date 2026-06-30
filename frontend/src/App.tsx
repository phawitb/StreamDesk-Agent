import { useCallback, useMemo } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { ChatWindow } from "./components/ChatWindow";
import { StatusBar } from "./components/StatusBar";
import { MovieBrowser } from "./components/MovieBrowser";
import type { AgentState, DisplayMessage, EpisodeInfo, EpisodeListMessage, MovieRecommendationMessage, RecommendedMovie } from "./types/messages";

function App() {
  const { connected, messages, send } = useWebSocket();

  const displayMessages = useMemo<DisplayMessage[]>(() => {
    return messages
      .filter((m) => m.type === "chat" || m.type === "status" || m.type === "error" || m.type === "movie_recommendations")
      .map((m, i) => {
        if (m.type === "chat") {
          return {
            id: `msg-${i}`,
            role: m.role as "user" | "assistant",
            content: m.content,
            timestamp: new Date(),
          };
        }
        if (m.type === "status") {
          return {
            id: `status-${i}`,
            role: "system" as const,
            content: m.message,
            timestamp: new Date(m.timestamp),
            state: m.state,
          };
        }
        if (m.type === "movie_recommendations") {
          const rec = m as MovieRecommendationMessage;
          return {
            id: `rec-${i}`,
            role: "assistant" as const,
            content: rec.message,
            timestamp: new Date(),
            recommendations: rec.movies,
          };
        }
        return {
          id: `err-${i}`,
          role: "system" as const,
          content: `Error: ${m.message}`,
          timestamp: new Date(),
        };
      });
  }, [messages]);

  const currentState = useMemo<AgentState>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "status") {
        return (messages[i] as { state: AgentState }).state;
      }
    }
    return "idle";
  }, [messages]);

  const episodes = useMemo<EpisodeInfo[] | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "episode_list") {
        return (messages[i] as EpisodeListMessage).episodes;
      }
      if (messages[i].type === "status") {
        const state = (messages[i] as { state: string }).state;
        if (state === "loading_player" || state === "playing") return null;
      }
    }
    return null;
  }, [messages]);

  const handleSelectEpisode = useCallback(
    (index: number) => {
      send({ type: "select_episode", index });
      const ep = episodes?.find((e) => e.index === index);
      messages.push({
        type: "chat",
        role: "user",
        content: `เลือก ${ep?.text || `ตอนที่ ${index + 1}`}`,
      });
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
      send({
        type: "play_request",
        ...(isUrl ? { url: text } : { query: text }),
      });
      messages.push({ type: "chat", role: "user", content: text });
    },
    [send, messages]
  );

  const handleSelectMovie = useCallback(
    (url: string) => {
      send({ type: "play_request", url });
      messages.push({ type: "chat", role: "user", content: url });
    },
    [send, messages]
  );

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#1e1e2e",
        color: "#cdd6f4",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          background: "#181825",
          borderBottom: "1px solid #313244",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 20 }}>🎬</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>StreamDesk</span>
        <StatusBar state={currentState} connected={connected} />
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={() => send({ type: "command", action: "reset" })}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #f38ba8",
              background: "transparent",
              color: "#f38ba8",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Main: Browse left + Chat right */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Browse panel */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid #313244",
            minWidth: 0,
          }}
        >
          <MovieBrowser onSelectMovie={handleSelectMovie} />
        </div>

        {/* Chat panel */}
        <div
          style={{
            width: 360,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            background: "#1e1e2e",
          }}
        >
          <ChatWindow
            messages={displayMessages}
            onSend={handleSend}
            isPlaying={currentState === "playing"}
            onDownload={() => send({ type: "command", action: "download" })}
            onMediaControl={handleMediaControl}
            episodes={episodes}
            onSelectEpisode={handleSelectEpisode}
            onSelectMovie={handleSelectMovie}
          />
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

export default App;
