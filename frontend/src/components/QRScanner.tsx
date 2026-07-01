import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onScan: (deviceKey: string) => void;
  onClose: () => void;
}

export function QRScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let rafId: number;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // play() is triggered by onCanPlay below
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    // Scanning loop
    const scan = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || cancelled) {
        rafId = requestAnimationFrame(scan);
        return;
      }

      // Native BarcodeDetector (Android Chrome)
      if ("BarcodeDetector" in window) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
          const results = await detector.detect(video);
          if (results.length > 0 && !cancelled) {
            cancelled = true;
            stopCamera();
            onScan(results[0].rawValue.trim());
            return;
          }
        } catch { /* ignore */ }
      } else {
        // Fallback: jsQR
        try {
          const { default: jsQR } = await import("jsqr");
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, canvas.width, canvas.height);
          if (code?.data && !cancelled) {
            cancelled = true;
            stopCamera();
            onScan(code.data.trim());
            return;
          }
        } catch { /* ignore */ }
      }

      if (!cancelled) rafId = requestAnimationFrame(scan);
    };

    // Start scanning after a short delay to let video settle
    const scanTimer = setTimeout(() => { rafId = requestAnimationFrame(scan); }, 500);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      clearTimeout(scanTimer);
      stopCamera();
    };
  }, [onScan, stopCamera]);

  const handleCanPlay = () => {
    const video = videoRef.current;
    if (video) {
      video.play().then(() => setReady(true)).catch(() => {});
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#000", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          onCanPlay={handleCanPlay}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />

        {ready && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 220, height: 220, position: "relative" }}>
              {[
                { top: 0, left: 0, borderTop: "3px solid #fff", borderLeft: "3px solid #fff" },
                { top: 0, right: 0, borderTop: "3px solid #fff", borderRight: "3px solid #fff" },
                { bottom: 0, left: 0, borderBottom: "3px solid #fff", borderLeft: "3px solid #fff" },
                { bottom: 0, right: 0, borderBottom: "3px solid #fff", borderRight: "3px solid #fff" },
              ].map((s, i) => (
                <div key={i} style={{ position: "absolute", width: 36, height: 36, borderRadius: 4, ...s }} />
              ))}
              <div style={{
                position: "absolute", left: 8, right: 8, height: 2,
                background: "var(--accent, #e50914)",
                boxShadow: "0 0 8px var(--accent, #e50914)",
                animation: "scanline 2s ease-in-out infinite",
              }} />
            </div>
          </div>
        )}

        {!ready && !error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>Opening camera...</div>
          </div>
        )}

        {ready && (
          <div style={{
            position: "absolute", top: 60, left: 0, right: 0, textAlign: "center",
            color: "#fff", fontSize: 16, fontWeight: 600, textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}>
            Point at QR code on monitor
          </div>
        )}

        {error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)" }}>
            <div style={{ color: "#ff6b6b", fontSize: 14, textAlign: "center", padding: 24, maxWidth: 300, wordBreak: "break-word" }}>
              {error}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "16px 24px 32px", textAlign: "center", background: "#000" }}>
        <button
          onClick={() => { stopCamera(); onClose(); }}
          style={{
            padding: "12px 40px", borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)", background: "transparent",
            color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>

      <style>{`@keyframes scanline { 0%,100% { top: 8px; } 50% { top: calc(100% - 10px); } }`}</style>
    </div>
  );
}
