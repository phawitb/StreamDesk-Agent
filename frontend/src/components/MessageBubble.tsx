import type { DisplayMessage } from "../types/messages";

interface Props {
  message: DisplayMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 4,
        padding: "0 12px",
        animation: "fadeIn 0.15s ease",
      }}
    >
      <div
        style={{
          maxWidth: "82%",
          padding: "8px 12px",
          borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
          background: isUser ? "var(--accent)" : isSystem ? "var(--bg-elevated)" : "var(--bg-highlight)",
          color: isUser ? "#fff" : "var(--text-primary)",
          fontSize: 13,
          lineHeight: 1.5,
          wordBreak: "break-all",
          overflowWrap: "anywhere",
          ...(isSystem && { fontSize: 12, color: "var(--text-muted)" }),
        }}
      >
        {message.content}
      </div>
    </div>
  );
}
