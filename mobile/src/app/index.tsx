import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { usePhantomStore } from '@/stores/phantom';
import { getAccessToken, getOrCreateDeviceId } from '@/services/api';
import { ShieldLogo } from '@/components/ShieldLogo';
import { Colors, FontSize, Spacing } from '@/constants/theme';

export default function EntryScreen() {
  const { isAuthenticated } = usePhantomStore();

  useEffect(() => {
    bootstrap();
  }, []);

  const bootstrap = async () => {
    // Give the persisted Zustand store a tick to hydrate from AsyncStorage
    await new Promise((r) => setTimeout(r, 100));

    // Ensure a stable device ID exists in secure store
    await getOrCreateDeviceId().catch(() => {});

    // If we have both a persisted auth state AND a valid access token → biometric gate
    // If the token is missing but isAuthenticated is true → session expired → welcome
    if (isAuthenticated) {
      const token = await getAccessToken().catch(() => null);
      if (token) {
        router.replace('/biometric-gate');
      } else {
        // Token cleared (logout, expiry) — reset auth state and go to welcome
        usePhantomStore.getState().setAuthenticated(false);
        usePhantomStore.getState().setUser(null);
        router.replace('/(auth)/welcome');
      }
    } else {
      router.replace('/(auth)/welcome');
    }
  };

  return (
    <View style={styles.container}>
      <ShieldLogo size={88} />
      <Text style={styles.name}>PhantomShield</Text>
      <Text style={styles.tagline}>Your phone. Your eyes. Always.</Text>
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
