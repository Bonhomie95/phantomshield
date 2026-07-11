import { create } from 'zustand';
import Cookies from 'js-cookie';
import { api, UserProfile } from '@/lib/api';

interface AuthStore {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Exchange a Google ID token (from Google Identity Services) for our session. */
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

// Access token lives ~15 min, refresh token 7 days. Not httpOnly because they
// are set from client JS; see the security notes in the README for the planned
// migration to httpOnly cookies set by a Next.js route handler.
const COOKIE_OPTS = {
  secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
  sameSite: 'strict' as const,
};

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  loginWithGoogle: async (idToken) => {
    const data = await api.auth.oauth(idToken);
    Cookies.set('ps_access_token',  data.accessToken,  { ...COOKIE_OPTS, expires: 1 / 96 }); // 15 min
    Cookies.set('ps_refresh_token', data.refreshToken, { ...COOKIE_OPTS, expires: 7 });       // 7 days
    set({ user: data.user, isAuthenticated: true, isLoading: false });
  },

  logout: async () => {
    const refresh = Cookies.get('ps_refresh_token');
    if (refresh) await api.auth.logout(refresh).catch(() => {});
    Cookies.remove('ps_access_token');
    Cookies.remove('ps_refresh_token');
    set({ user: null, isAuthenticated: false });
    window.location.href = '/auth/login';
  },

  loadUser: async () => {
    const token = Cookies.get('ps_access_token');
    if (!token) { set({ isLoading: false }); return; }
    try {
      const { user } = await api.dashboard.me();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      Cookies.remove('ps_access_token');
      set({ isLoading: false });
    }
  },
}));
