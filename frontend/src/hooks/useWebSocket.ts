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
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

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
        setMessages((prev) => [...prev, msg]);
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

  return { connected, monitorInConnected, monitorOutConnected, pairedDevice, setPairedDevice, messages, send };
}
