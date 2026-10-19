import { createContext, useCallback, useContext, useEffect, useState } from "react";
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

export const useAuth = () => useContext(AuthContext);
