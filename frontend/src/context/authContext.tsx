import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import authenticationService from "../pages/Authentication/services/authenticationService";

type User = {
  id?: string;
  user_id?: string;
  username: string;
  displayName?: string;
  email: string;
  isAdmin: boolean;
};

type AuthContextType = {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>(null!);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const response = await authenticationService.me();
      setUser(response.user ? { ...response.user, isAdmin: response.isAdmin ?? response.user.isAdmin ?? false } : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshUser(); }, [refreshUser]);

  const logout = useCallback(async () => {
    try { await authenticationService.logout(); } finally { setUser(null); }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAdmin: Boolean(user?.isAdmin), loading, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

/** Shared dashboard links intentionally render in public mode, even in an admin's browser. */
export const useAuth = () => {
  const context = useContext(AuthContext);
  const location = useLocation();
  const isPublicDashboard =
    location.pathname.replace(/\/+$/, "") === "/account" &&
    new URLSearchParams(location.search).get("view") === "public";

  if (!isPublicDashboard) return context;

  return {
    ...context,
    user: context.user ? { ...context.user, isAdmin: false } : null,
    isAdmin: false,
  };
};
