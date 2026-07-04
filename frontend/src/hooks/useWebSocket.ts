import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "../types/messages";

const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${wsProto}//${window.location.host}/ws`;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [monitorInConnected, setMonitorInConnected] = useState(false);
  const [monitorOutConnected, setMonitorOutConnected] = useState(false);
  const [pairedDevice, setPairedDevice] = useState<string | null>(null);
  const [messages, setMessages] = useState<ServerMessage[]>(() => {
    try {
      const saved = sessionStorage.getItem("ws_messages");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnected(true);
      console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WS received:", data.type, data);
        if (data.type === "media_status") {
          window.dispatchEvent(new CustomEvent("media_status", { detail: data }));
          return;
        }
        if (data.type === "monitor_status") {
          setMonitorInConnected(!!data.in_connected);
          setMonitorOutConnected(!!data.out_connected);
          if (data.paired_device !== undefined) {
            setPairedDevice(data.paired_device || null);
          }
          return;
        }
        const msg: ServerMessage = data;
        setMessages((prev) => {
          const next = [...prev, msg];
          try { sessionStorage.setItem("ws_messages", JSON.stringify(next.slice(-50))); } catch {}
          return next;
        });
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.log("WebSocket disconnected, reconnecting in 3s...");
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const addMessage = useCallback((msg: ServerMessage) => {
    setMessages((prev) => {
      const next = [...prev, msg];
      try { sessionStorage.setItem("ws_messages", JSON.stringify(next.slice(-50))); } catch {}
      return next;
    });
  }, []);

  return { connected, monitorInConnected, monitorOutConnected, pairedDevice, setPairedDevice, messages, addMessage, send };
}
