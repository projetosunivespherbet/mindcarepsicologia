import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, tokenStore, UNAUTHORIZED_EVENT } from "@/lib/api";
import type { Me } from "@/lib/types";

interface AuthState {
  user: Me | null;
  loading: boolean;
  /** psicólogo, ou administrador que também atende */
  canProduceDocuments: boolean;
  login: (email: string, password: string) => Promise<void>;
  acceptInvite: (token: string, password: string, email?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());
  const queryClient = useQueryClient();

  const loadMe = useCallback(async () => {
    try {
      setUser(await api<Me>("/me"));
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tokenStore.get()) void loadMe();
    const onUnauthorized = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [loadMe, queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api<{ token: string }>("/auth/login", { auth: false, body: { email, password } });
      tokenStore.set(r.token);
      await loadMe();
    },
    [loadMe],
  );

  const acceptInvite = useCallback(
    async (token: string, password: string, email?: string) => {
      const r = await api<{ token: string }>("/invites/accept", { auth: false, body: { token, password, email } });
      tokenStore.set(r.token);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      canProduceDocuments: !!user && (user.role === "psicologo" || (user.role === "admin" && user.atende)),
      login,
      acceptInvite,
      logout,
    }),
    [user, loading, login, acceptInvite, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
