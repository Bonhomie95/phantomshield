import { create } from 'zustand';
import { api, UserProfile } from '@/lib/api';
import { getDeviceId } from '@/lib/deviceId';
import { identifyWeb, trackWeb } from '@/lib/analytics';

interface AuthStore {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Exchange a Google or Apple ID token for our session. */
  loginWithGoogle: (idToken: string, provider?: 'google' | 'apple') => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

// Tokens are now httpOnly cookies set by the BFF route handlers — never touched
// by client JS. The store only tracks the user profile + auth flag.
export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  loginWithGoogle: async (idToken, provider = 'google') => {
    const data = await api.auth.oauth(idToken, provider); // BFF sets the httpOnly cookies
    if (data.user?._id) {
      identifyWeb(data.user._id, { plan: data.user.plan, provider: data.user.provider });
      trackWeb('dashboard_signed_in', { plan: data.user.plan });
    }
    set({ user: data.user, isAuthenticated: true, isLoading: false });
  },

  logout: async () => {
    await api.auth.logout().catch(() => {});
    set({ user: null, isAuthenticated: false });
    window.location.href = '/auth/login';
  },

  loadUser: async () => {
    // Silent session check — a 401 just means "not signed in" (no redirect).
    try {
      const res = await fetch('/api/backend/dashboard/me', {
        credentials: 'include',
        headers: { 'X-Device-Id': getDeviceId() },
      });
      if (!res.ok) {
        set({ isLoading: false });
        return;
      }
      const { user } = await res.json();
      // Same distinct_id as the mobile client (the backend user id), so one
      // person's web and mobile behaviour resolve to a single identity.
      if (user?._id) {
        identifyWeb(user._id, { plan: user.plan, provider: user.provider });
        trackWeb('dashboard_session', { plan: user.plan });
      }
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));
