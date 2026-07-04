import { useEffect, useRef, useCallback } from "react";

const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";

interface Props {
  style?: React.CSSProperties;
  contentMode?: "movie" | "music";
  onNextTrack?: () => void;
  onPrevTrack?: () => void;
}

export function InAppPlayer({ style, onNextTrack, onPrevTrack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const volumeRef = useRef(50);
  const mutedRef = useRef(false);
  const titleRef = useRef("");
  const urlRef = useRef("");
  const onNextRef = useRef(onNextTrack);
  const onPrevRef = useRef(onPrevTrack);
  onNextRef.current = onNextTrack;
  onPrevRef.current = onPrevTrack;

  const reportStatus = useCallback(() => {
    const ws = wsRef.current;
    const video = videoRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    let playing = false, duration = 0, position = 0;
    if (video && video.src) {
      playing = !video.paused;
      duration = video.duration || 0;
      position = video.currentTime || 0;
    }

    ws.send(JSON.stringify({
      type: "status",
      playing,
      title: titleRef.current,
      url: urlRef.current,
      volume: volumeRef.current,
      muted: mutedRef.current,
      duration,
      position,
    }));

    // Update lock screen progress
    if ("mediaSession" in navigator && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: video?.playbackRate || 1,
          position: Math.min(position, duration),
        });
      } catch {}
    }
  }, []);

  const updateMediaSession = useCallback(() => {
    if (!("mediaSession" in navigator)) return;
    const video = videoRef.current;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleRef.current || "StreamDesk",
      artist: "",
      album: "StreamDesk",
    });
    navigator.mediaSession.setActionHandler("play", () => {
      video?.play().catch(() => {});
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      video?.pause();
    });
    navigator.mediaSession.setActionHandler("seekbackward", () => {
      if (video) video.currentTime = Math.max(0, video.currentTime - 10);
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      if (video) video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (video && details.seekTime != null) video.currentTime = details.seekTime;
    });
    navigator.mediaSession.setActionHandler("nexttrack", onNextRef.current || null);
    navigator.mediaSession.setActionHandler("previoustrack", onPrevRef.current || null);
  }, []);

  const doPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = mutedRef.current;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });
  }, []);

  const openVideo = useCallback((url: string, startTime: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = volumeRef.current / 100;
    video.muted = mutedRef.current;
    video.src = url;

    if (startTime > 0) {
      const resumeTime = startTime;
      video.addEventListener("loadeddata", () => {
        if (resumeTime < video.duration) {
          video.currentTime = resumeTime;
        }
      }, { once: true });
    }

    video.play().then(() => {
      updateMediaSession();
    }).catch(() => {
      video.muted = true;
      video.play().then(() => {
        updateMediaSession();
      }).catch(() => {});
    });
  }, [updateMediaSession]);

  const handleCommand = useCallback((cmd: any) => {
    const video = videoRef.current;
    if (!video) return;

    switch (cmd.action) {
      case "SET_MODE":
        if (cmd.mode === "out") {
          // inactive for in-app
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
        break;
      case "OPEN_URL":
        urlRef.current = cmd.url || "";
        titleRef.current = cmd.title || "";
        openVideo(cmd.url, cmd.start_time || 0);
        break;
      case "PLAY":
        doPlay();
        break;
      case "PAUSE":
        video.pause();
        break;
      case "STOP":
        video.pause();
        video.removeAttribute("src");
        video.load();
        urlRef.current = "";
        titleRef.current = "";
        break;
      case "SEEK_FORWARD":
        video.currentTime = Math.min(video.duration || 0, video.currentTime + (cmd.value || 10));
        break;
      case "SEEK_BACKWARD":
        video.currentTime = Math.max(0, video.currentTime - (cmd.value || 10));
        break;
      case "SEEK_TO":
        if (video.duration) video.currentTime = cmd.value || 0;
        break;
      case "VOLUME_UP":
        volumeRef.current = Math.min(100, volumeRef.current + (cmd.value || 10));
        video.volume = volumeRef.current / 100;
        break;
      case "VOLUME_DOWN":
        volumeRef.current = Math.max(0, volumeRef.current - (cmd.value || 10));
        video.volume = volumeRef.current / 100;
        break;
      case "SET_VOLUME":
        volumeRef.current = Math.max(0, Math.min(100, cmd.value ?? 50));
        video.volume = volumeRef.current / 100;
        video.muted = volumeRef.current === 0;
        mutedRef.current = volumeRef.current === 0;
        break;
      case "MUTE":
        mutedRef.current = true;
        video.muted = true;
        break;
      case "UNMUTE":
        mutedRef.current = false;
        video.muted = false;
        break;
    }
    reportStatus();
  }, [openVideo, doPlay, reportStatus]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws/monitorin`);

    ws.onopen = () => {
      console.log("[InAppPlayer] WS connected");
    };

    ws.onmessage = (e) => {
      try {
        handleCommand(JSON.parse(e.data));
      } catch (err) {
        console.error("[InAppPlayer] Bad msg:", err);
      }
    };

    ws.onclose = () => {
      console.log("[InAppPlayer] WS disconnected, reconnecting...");
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, [handleCommand]);

  useEffect(() => {
    connect();
    statusIntervalRef.current = setInterval(reportStatus, 1000);

    return () => {
      clearTimeout(reconnectRef.current);
      clearInterval(statusIntervalRef.current);
      wsRef.current?.close();
    };
  }, [connect, reportStatus]);

  return (
    <video
      ref={videoRef}
      playsInline
      preload="auto"
      style={{
        width: "100%",
        height: "100%",
        background: "#000",
        objectFit: "contain",
        ...style,
      }}
    />
  );
}
