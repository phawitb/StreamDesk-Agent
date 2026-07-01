import { usePWAInstall } from "../hooks/usePWAInstall";

interface Props {
  onLogin: () => void;
}

export function LoginScreen({ onLogin }: Props) {
  const { canInstall, install } = usePWAInstall();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        background: "linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 50%, #0a0a1a 100%)",
        padding: 24,
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: "rgba(134,59,255,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" style={{ width: 40, height: 40 }}>
          <rect x="2" y="3" width="20" height="18" rx="2" fill="var(--accent)" />
          <path d="M10 8v8l6-4-6-4z" fill="#fff" />
        </svg>
      </div>

      <h1 style={{ fontSize: 32, fontWeight: 800, color: "#e2e8f0", marginBottom: 8 }}>StreamDesk</h1>
      <p style={{ fontSize: 16, color: "#64748b", marginBottom: 48 }}>Sign in to start streaming</p>

      <button
        onClick={onLogin}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 32px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.05)",
          color: "#e2e8f0",
          fontSize: 16,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.1)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
        }}
      >
        <svg viewBox="0 0 24 24" style={{ width: 22, height: 22 }}>
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Sign in with Google
      </button>

      {canInstall && (
        <button
          onClick={install}
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 28px",
            borderRadius: 12,
            border: "1px solid rgba(134,59,255,0.4)",
            background: "rgba(134,59,255,0.15)",
            color: "#c4b5fd",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7,10 12,15 17,10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Install App
        </button>
      )}
    </div>
  );
}
