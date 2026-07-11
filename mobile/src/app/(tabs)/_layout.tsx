import React from 'react';
import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';

function TabIcon({ emoji, active }: { emoji: string; active: boolean }) {
  return <Text style={{ fontSize: 22, opacity: active ? 1 : 0.4 }}>{emoji}</Text>;
}

export default function TabLayout() {
  // Android is edge-to-edge in SDK 54+, so the system navigation bar (buttons
  // or gesture pill) overlays the bottom of the screen. Pad the tab bar by the
  // bottom inset or the tabs render underneath it and can't be tapped.
  const insets = useSafeAreaInsets();

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
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🛡️" active={focused} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📊" active={focused} />,
        }}
      />
      <Tabs.Screen
        name="vault"
        options={{
          title: 'Vault',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🔒" active={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" active={focused} />,
        }}
      />
      {/* explore.tsx must exist as a file but we hide it from the tab bar */}
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}
