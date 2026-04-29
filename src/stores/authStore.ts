import { create } from 'zustand';

interface User {
  id: string;
  phone: string;
  name?: string;
  businessName?: string;
  // businessDesc / industry / language are populated on first agent
  // creation and re-used as established context for subsequent agents.
  // Optional + nullable so partial profile responses don't break the type.
  businessDesc?: string | null;
  industry?: string | null;
  language?: string | null;
  onboardingDone: boolean;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  /** True until we've finished reading tokens from secure store on app boot. */
  isHydrating: boolean;
  /** Ephemeral — the Firebase verificationId from signInWithPhoneNumber, used by the OTP screen. Not persisted. */
  pendingVerificationId: string | null;

  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setAccessToken: (token: string) => void;
  setUser: (user: Partial<User>) => void;
  setPendingVerificationId: (id: string | null) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  /** Read persisted tokens + user on app boot. Call once from the root layout. */
  hydrate: () => Promise<void>;
}

// SecureStore is a native module — if the dev client wasn't rebuilt after
// installing it, the JS-side import resolves but every call throws. We load
// it lazily and treat any failure as "no persistence available", so the app
// keeps working (it just won't survive reloads, same as before).
type SecureStoreLike = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

let _store: SecureStoreLike | null | undefined; // undefined = not tried, null = unavailable

async function getStore(): Promise<SecureStoreLike | null> {
  if (_store !== undefined) return _store;
  try {
    const mod = await import('expo-secure-store');
    // Smoke-test the native bridge — getItemAsync against a probe key.
    // If the native side is missing this throws synchronously-ish.
    await mod.getItemAsync('mmc_probe');
    _store = mod as unknown as SecureStoreLike;
  } catch (err) {
    console.warn('[authStore] SecureStore unavailable — running without persistence:', err);
    _store = null;
  }
  return _store;
}

const KEY_ACCESS = 'mmc_access_token_v1';
const KEY_REFRESH = 'mmc_refresh_token_v1';
const KEY_USER = 'mmc_user_v1';

async function persist(state: {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
}) {
  const store = await getStore();
  if (!store) return;
  try {
    if (state.accessToken && state.refreshToken && state.user) {
      await Promise.all([
        store.setItemAsync(KEY_ACCESS, state.accessToken),
        store.setItemAsync(KEY_REFRESH, state.refreshToken),
        store.setItemAsync(KEY_USER, JSON.stringify(state.user)),
      ]);
    } else {
      await Promise.all([
        store.deleteItemAsync(KEY_ACCESS),
        store.deleteItemAsync(KEY_REFRESH),
        store.deleteItemAsync(KEY_USER),
      ]);
    }
  } catch (err) {
    console.warn('[authStore] persist failed:', err);
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoggedIn: false,
  isLoading: false,
  isHydrating: true,
  pendingVerificationId: null,

  setAuth: (user, accessToken, refreshToken) => {
    set({ user, accessToken, refreshToken, isLoggedIn: true });
    void persist({ user, accessToken, refreshToken });
  },

  setAccessToken: (accessToken) => {
    set({ accessToken });
    const { refreshToken, user } = get();
    void persist({ accessToken, refreshToken, user });
  },

  setUser: (updates) => {
    const current = get().user;
    const next = current ? { ...current, ...updates } : null;
    set({ user: next });
    if (next) {
      const { accessToken, refreshToken } = get();
      void persist({ user: next, accessToken, refreshToken });
    }
  },

  logout: () => {
    set({ user: null, accessToken: null, refreshToken: null, isLoggedIn: false });
    void persist({ user: null, accessToken: null, refreshToken: null });
  },

  setPendingVerificationId: (id) => set({ pendingVerificationId: id }),

  setLoading: (isLoading) => set({ isLoading }),

  hydrate: async () => {
    try {
      const store = await getStore();
      if (!store) {
        set({ isHydrating: false });
        return;
      }
      const [access, refresh, userStr] = await Promise.all([
        store.getItemAsync(KEY_ACCESS),
        store.getItemAsync(KEY_REFRESH),
        store.getItemAsync(KEY_USER),
      ]);
      if (access && refresh && userStr) {
        try {
          const user: User = JSON.parse(userStr);
          set({
            user,
            accessToken: access,
            refreshToken: refresh,
            isLoggedIn: true,
            isHydrating: false,
          });
          return;
        } catch {
          // Corrupted user blob — clear and fall through to logged-out.
          await persist({ user: null, accessToken: null, refreshToken: null });
        }
      }
    } catch (err) {
      console.warn('[authStore] hydrate failed:', err);
    }
    set({ isHydrating: false });
  },
}));
