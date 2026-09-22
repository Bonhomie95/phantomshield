import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { usePhantomStore } from '@/stores/phantom';
import { getAccessToken, getOrCreateDeviceId } from '@/services/api';
import { takeInitialArmHref } from '@/services/shortcuts';
import { ShieldLogo } from '@/components/ShieldLogo';
import { Colors, FontSize, Spacing } from '@/constants/theme';

export default function EntryScreen() {
  useEffect(() => {
    bootstrap();
  }, []);

  const bootstrap = async () => {
    // Wait for the persisted Zustand store to hydrate from AsyncStorage. Prefer
    // the store's own hydration signal; fall back to a short delay.
    const persist = (usePhantomStore as any).persist;
    if (persist?.hasHydrated && !persist.hasHydrated()) {
      await new Promise<void>((resolve) => {
        const unsub = persist.onFinishHydration?.(() => { unsub?.(); resolve(); });
        // Safety timeout so we never hang if the hydration event doesn't fire.
        setTimeout(() => { unsub?.(); resolve(); }, 500);
      });
    } else {
      await new Promise((r) => setTimeout(r, 100));
    }

    // Ensure a stable device ID exists in secure store
    await getOrCreateDeviceId().catch(() => {});

    // Launched from a home-screen quick action: arming needs no unlock.
    const armHref = takeInitialArmHref();
    if (armHref) {
      router.replace(armHref as never);
      return;
    }

    // Read the LIVE store value (not a render-time closure, which is `false` on
    // a cold start before hydration completes and would misroute returning users).
    const st = usePhantomStore.getState();

    // A session whose token is gone (logout elsewhere, expiry) drops back to
    // "on this phone only" — the phone's own protection keeps working.
    if (st.isAuthenticated && !(await getAccessToken().catch(() => null))) {
      st.setAuthenticated(false);
      st.setUser(null);
    }

    const { isAuthenticated, onboarded, lostMode } = usePhantomStore.getState();
    if (lostMode) router.replace('/lost');
    else if (isAuthenticated || onboarded) router.replace('/biometric-gate');
    else router.replace('/(auth)/welcome');
  };

  return (
    <View style={styles.container}>
      <ShieldLogo size={88} />
      <Text style={styles.name}>PhantomShield</Text>
      <Text style={styles.tagline}>Know if anyone takes your phone.</Text>
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, { opacity: 0.3 + i * 0.3 }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  name: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 1,
    marginTop: Spacing.sm,
  },
  tagline: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    position: 'absolute',
    bottom: 60,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
});
