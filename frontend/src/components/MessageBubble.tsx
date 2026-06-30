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
        marginBottom: 8,
        padding: "0 16px",
      }}
    >
      <div
        style={{
          maxWidth: "75%",
          padding: "10px 14px",
          borderRadius: 12,
          background: isUser
            ? "#89b4fa"
            : isSystem
            ? "#313244"
            : "#45475a",
          color: isUser ? "#1e1e2e" : "#cdd6f4",
          fontSize: 14,
          lineHeight: 1.5,
          ...(isSystem && {
            fontStyle: "italic",
            fontSize: 13,
          }),
        }}
      >
        {message.content}
      </div>
    </div>
  );
}
