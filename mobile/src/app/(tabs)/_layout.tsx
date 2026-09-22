import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { usePhantomStore } from '@/stores/phantom';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const tabIcon = (on: IconName, off: IconName) =>
  function TabIcon({ focused, color }: { focused: boolean; color: string }) {
    return <Ionicons name={focused ? on : off} size={24} color={color} />;
  };

export default function TabLayout() {
  // Android is edge-to-edge in SDK 54+, so the system navigation bar (buttons
  // or gesture pill) overlays the bottom of the screen. Pad the tab bar by the
  // bottom inset or the tabs render underneath it and can't be tapped.
  const insets = useSafeAreaInsets();
  const hasAccess = usePhantomStore((s) => s.isAuthenticated || s.onboarded);
  const isAppUnlocked = usePhantomStore((s) => s.isAppUnlocked);

  // The app is only ever entered through the identity gate. Without this, a
  // deep link (phantomshield://settings) or a restored navigation state would
  // mount the tabs directly and skip biometric/PIN verification.
  if (!hasAccess) return <Redirect href="/(auth)/welcome" />;
  if (!isAppUnlocked) return <Redirect href="/biometric-gate" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.bgCard,
          borderTopColor: Colors.bgBorder,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Protect', tabBarIcon: tabIcon('shield-checkmark', 'shield-checkmark-outline') }}
      />
      <Tabs.Screen
        name="vault"
        options={{ title: 'Evidence', tabBarIcon: tabIcon('images', 'images-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: tabIcon('settings', 'settings-outline') }}
      />
    </Tabs>
  );
}
