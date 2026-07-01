import { useCallback, useEffect, useState } from "react";

export interface User {
  id: number;
  email: string;
  name: string;
  picture: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(() => {
    window.location.href = "/auth/login";
  }, []);

  const logout = useCallback(async () => {
    await fetch("/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}
