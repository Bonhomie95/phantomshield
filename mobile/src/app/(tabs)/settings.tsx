import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Alert, Platform, Share } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Camera } from 'expo-camera';
import { usePhantomStore } from '@/stores/phantom';
import { Card, SectionHeader, Badge, Button, Divider } from '@/components/ui/components';
import { Colors, Spacing, FontSize } from '@/constants/theme';
import { signOut, deleteAccount } from '@/services/api';
import { wipeLocalSession } from '@/services/session';
import { ensureLocationPermission } from '@/services/location';
import { LEGAL, SUPPORT_URL, DASHBOARD_URL, SHARE_URL } from '@/constants/config';
import { startLocationTracking, stopLocationTracking } from '@/services/locationTracking';
import * as pinVault from '@/services/pinVault';
import { allowFirstRunSetup } from '@/services/pinVault';
import { track } from '@/services/analytics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ─── Setting row ──────────────────────────────────────────────────────────────

function SettingRow({
  icon, title, subtitle, value, onValueChange, onPress, badge, badgeVariant = 'neutral', danger,
}: {
  icon: IconName; title: string; subtitle?: string;
  value?: boolean; onValueChange?: (v: boolean) => void;
  onPress?: () => void; badge?: string;
  badgeVariant?: 'cyan' | 'red' | 'green' | 'warning' | 'neutral'; danger?: boolean;
}) {
  const body = (
    <>
      <Ionicons name={icon} size={20} color={danger ? Colors.accent : Colors.primary} style={styles.settingIcon} />
      <View style={styles.settingInfo}>
        <Text style={[styles.settingTitle, danger && { color: Colors.accent }]}>{title}</Text>
        {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
      </View>
      {badge && <Badge label={badge} variant={badgeVariant} />}
      {value !== undefined && onValueChange && (
        <Switch
          value={value}
          onValueChange={onValueChange}
          accessibilityLabel={title}
          trackColor={{ false: Colors.bgBorder, true: Colors.primary + '55' }}
          thumbColor={value ? Colors.primary : Colors.textMuted}
        />
      )}
      {onPress && value === undefined && <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />}
    </>
  );
  // A row with a switch is not itself a button: wrapping the Switch in a
  // disabled Touchable swallowed its taps, so every toggle here was dead.
  if (!onPress) return <View style={styles.settingRow}>{body}</View>;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.settingRow}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      {body}
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const {
    user,
    isAuthenticated,
    locationEnabled, setLocationEnabled,
    locationTrackingEnabled, setLocationTrackingEnabled,
    intruderSnapshotEnabled, setIntruderSnapshotEnabled,
    decoyPinSet,
    e2eEnabled,
  } = usePhantomStore();

  const [deleting, setDeleting] = useState(false);
  const [hasDecoy, setHasDecoy] = useState(decoyPinSet);
  useEffect(() => { void pinVault.hasPin('decoy').then(setHasDecoy); }, [decoyPinSet]);

  const isPaid = user?.plan === 'starter' || user?.plan === 'pro';
  const signIn = () => router.push('/(auth)/welcome');

  const handleSignOut = () => {
    Alert.alert(
      isAuthenticated ? 'Sign out?' : 'Erase PhantomShield from this phone?',
      isAuthenticated
        ? 'This removes PhantomShield’s data from this phone — your PIN, photos and Guard Mode records — and turns off Find My Phone. Anything already backed up stays in your account.'
        : 'This deletes your PIN, photos and Guard Mode records from this phone. It can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isAuthenticated ? 'Sign Out' : 'Erase',
          style: 'destructive',
          onPress: async () => {
            // An alert can outlive the lock: never act for whoever holds a locked phone.
            if (!usePhantomStore.getState().isAppUnlocked) return;
            if (isAuthenticated) await signOut();
            await wipeLocalSession();
            router.replace('/(auth)/welcome');
          },
        },
      ],
    );
  };

  const handleDeleteAccount = () =>
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and everything in it — intruder photos, locations, guardians and devices — from our servers and from this phone. It can’t be undone.' +
        (isPaid
          ? '\n\nDeleting your account does not cancel your subscription. Cancel it in your ' +
            (Platform.OS === 'ios' ? 'App Store' : 'Google Play') + ' account to stop being charged.'
          : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            // An alert can outlive the lock: never act for whoever holds a locked phone.
            if (!usePhantomStore.getState().isAppUnlocked) return;
            setDeleting(true);
            const ok = await deleteAccount();
            setDeleting(false);
            if (ok) {
              await wipeLocalSession();
              router.replace('/(auth)/welcome');
              Alert.alert('Account deleted', 'Your account and its data have been deleted.');
            } else {
              Alert.alert('Couldn’t delete your account', 'Check your connection and try again. If it keeps failing, contact support.');
            }
          },
        },
      ],
    );

  /**
   * Continuous tracking is the most invasive thing this app can do, so it gets
   * an explicit, informed confirmation rather than a silent switch — and the
   * OS task is started/stopped to match immediately, so the toggle can never
   * disagree with what is actually running.
   */
  const handleTrackingToggle = (enabled: boolean) => {
    if (!enabled) {
      setLocationTrackingEnabled(false);
      void stopLocationTracking();
      track('location_tracking_disabled');
      return;
    }
    if (!isAuthenticated) {
      Alert.alert('Sign in to use Find My Phone', 'Your phone’s location is sent to your account so you can see it from any browser.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign in', onPress: signIn },
      ]);
      return;
    }

    Alert.alert(
      'Turn on Find My Phone?',
      'PhantomShield will record where this phone is, in the background, until you turn this off. ' +
        'It only ever reports to your own account.\n\n' +
        'Your phone will show the system location indicator while it runs — we deliberately keep ' +
        'that visible so this can never be used to follow someone secretly.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn on',
          onPress: async () => {
            const ok = await startLocationTracking();
            setLocationTrackingEnabled(ok);
            track(ok ? 'location_tracking_enabled' : 'location_tracking_denied');
            if (!ok) {
              Alert.alert(
                'Permission needed',
                'Find My Phone needs “Always” location access. You can grant it in your device Settings.',
              );
            }
          },
        },
      ],
    );
  };

  /** Intruder photos: asking for the camera here, at the moment of opt-in. */
  const handleSnapshotToggle = async (enabled: boolean) => {
    if (!enabled) { setIntruderSnapshotEnabled(false); return; }
    const res = await Camera.requestCameraPermissionsAsync().catch(() => null);
    setIntruderSnapshotEnabled(!!res?.granted);
    if (!res?.granted) {
      Alert.alert('Camera access needed', 'Allow camera access for PhantomShield in your device Settings to use intruder photos.');
    }
  };

  const handleLocationOnEvents = async (enabled: boolean) => {
    if (!enabled) { setLocationEnabled(false); return; }
    const ok = await ensureLocationPermission();
    setLocationEnabled(ok);
    if (!ok) {
      Alert.alert('Location access needed', 'Allow location access for PhantomShield in your device Settings to tag events with a location.');
    }
  };

  const setPin = (layer: 'app' | 'decoy') => {
    allowFirstRunSetup();
    router.push({ pathname: '/setup-pins', params: { layer } });
  };

  const removeDecoy = () =>
    Alert.alert('Remove decoy PIN?', 'Only your real PIN will open PhantomShield.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          // An alert can outlive the lock: never act for whoever holds a locked phone.
          if (!usePhantomStore.getState().isAppUnlocked) return;
          await pinVault.removePin('decoy');
          usePhantomStore.setState({ decoyPinSet: false });
          setHasDecoy(false);
        },
      },
    ]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.title} accessibilityRole="header">Settings</Text>

      {/* Account card */}
      <Card style={styles.accountCard}>
        {isAuthenticated ? (
          <>
            <View style={styles.accountRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(user?.name ?? user?.email ?? 'U')[0].toUpperCase()}</Text>
              </View>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{user?.name ?? 'Your account'}</Text>
                <Text style={styles.accountEmail}>{user?.email ?? '—'}</Text>
              </View>
              <Badge
                label={user?.plan?.toUpperCase() ?? 'FREE'}
                variant={user?.plan === 'pro' ? 'red' : user?.plan === 'starter' ? 'cyan' : 'neutral'}
              />
            </View>
            <Button
              label={isPaid ? 'Manage Plan' : 'Upgrade Plan'}
              onPress={() => router.push({ pathname: '/paywall', params: { source: 'settings' } })}
              variant="secondary"
              style={{ marginTop: Spacing.md }}
            />
          </>
        ) : (
          <>
            <Text style={styles.accountName}>Using PhantomShield without an account</Text>
            <Text style={styles.accountEmail}>
              Everything works on this phone. Sign in to back up evidence, find this phone from any
              browser, and alert your guardians if it’s stolen.
            </Text>
            <Button label="Sign in" onPress={signIn} variant="primary" style={{ marginTop: Spacing.md }} />
          </>
        )}
      </Card>

      {/* Protection */}
      <View style={styles.section}>
        <SectionHeader title="Protection" />
        <Card>
          <SettingRow
            icon="camera-outline"
            title="Intruder photos"
            subtitle="Front-camera photo on a wrong PIN or when Guard Mode is set off"
            value={intruderSnapshotEnabled}
            onValueChange={(v) => { void handleSnapshotToggle(v); }}
          />
          <Divider />
          <SettingRow
            icon="location-outline"
            title="Location on events"
            subtitle="Record where each event happened"
            value={locationEnabled}
            onValueChange={(v) => { void handleLocationOnEvents(v); }}
          />
          <Divider />
          <SettingRow
            icon="navigate-outline"
            title="Find My Phone"
            subtitle={
              locationTrackingEnabled
                ? 'Recording where this phone is, so you can find it from the web'
                : 'Keep a location trail so a lost or stolen phone can be found'
            }
            value={locationTrackingEnabled}
            onValueChange={handleTrackingToggle}
          />
        </Card>
      </View>

      {/* If it's stolen */}
      <View style={styles.section}>
        <SectionHeader title="If it’s stolen" />
        <Card>
          <SettingRow
            icon="people-outline"
            title="Guardians"
            subtitle="People who get a live location link if your phone looks stolen"
            onPress={() => router.push('/guardians')}
          />
          <Divider />
          <SettingRow
            icon="key-outline"
            title="Private photo backup"
            subtitle={e2eEnabled ? 'On — photos are end-to-end encrypted' : 'Encrypt backed-up photos so only you can see them'}
            badge={e2eEnabled ? 'ON' : undefined}
            badgeVariant="green"
            onPress={() => router.push('/encryption')}
          />
          <Divider />
          <SettingRow
            icon="globe-outline"
            title="Lost mode and remote alarm"
            subtitle="From any browser, put a message on this phone’s lock screen or sound an alarm"
            onPress={() => (isAuthenticated ? WebBrowser.openBrowserAsync(DASHBOARD_URL) : signIn())}
          />
        </Card>
      </View>

      {/* Security */}
      <View style={styles.section}>
        <SectionHeader title="PIN" />
        <Card>
          <SettingRow icon="lock-closed-outline" title="Change PIN" subtitle="Opens the app and stops Guard Mode" onPress={() => setPin('app')} />
          <Divider />
          <SettingRow
            icon="eye-off-outline"
            title={hasDecoy ? 'Remove decoy PIN' : 'Add a decoy PIN'}
            subtitle="Advanced: a second PIN that opens a harmless, empty screen if you’re forced to unlock"
            onPress={hasDecoy ? removeDecoy : () => setPin('decoy')}
          />
        </Card>
      </View>

      {/* Devices */}
      {isAuthenticated && (
        <View style={styles.section}>
          <SectionHeader title="Devices" />
          <Card>
            <SettingRow
              icon="phone-portrait-outline"
              title="Manage devices"
              subtitle="See the phones on your account and remove old ones"
              onPress={() => router.push('/devices')}
            />
          </Card>
        </View>
      )}

      {/* Account */}
      <View style={styles.section}>
        <SectionHeader title="Account" />
        <Card>
          {isAuthenticated && (
            <>
              <SettingRow
                icon="person-outline"
                title="Provider"
                subtitle={`Signed in with ${user?.provider === 'apple' ? 'Apple' : 'Google'}`}
              />
              <Divider />
            </>
          )}
          <SettingRow
            icon="log-out-outline"
            title={isAuthenticated ? 'Sign Out' : 'Erase data on this phone'}
            danger
            onPress={handleSignOut}
          />
          {isAuthenticated && (
            <>
              <Divider />
              <SettingRow
                icon="trash-outline"
                title={deleting ? 'Deleting account…' : 'Delete Account'}
                subtitle="Permanently erase your account and all data"
                danger
                onPress={deleting ? undefined : handleDeleteAccount}
              />
            </>
          )}
        </Card>
      </View>

      {/* Legal */}
      <View style={styles.section}>
        <SectionHeader title="Help & legal" />
        <Card>
          <SettingRow
            icon="share-social-outline"
            title="Share PhantomShield"
            onPress={() =>
              void Share.share({ message: `I use PhantomShield to know if anyone takes my phone: ${SHARE_URL}` })
            }
          />
          <Divider />
          <SettingRow icon="help-circle-outline" title="Help & support" onPress={() => WebBrowser.openBrowserAsync(SUPPORT_URL)} />
          <Divider />
          <SettingRow icon="document-text-outline" title="Terms of Service" onPress={() => WebBrowser.openBrowserAsync(LEGAL.terms)} />
          <Divider />
          <SettingRow icon="shield-outline" title="Privacy Policy" onPress={() => WebBrowser.openBrowserAsync(LEGAL.privacy)} />
        </Card>
      </View>

      <Text style={styles.version}>PhantomShield v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll:    { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, paddingBottom: 48, gap: Spacing.md },
  title:     { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary, marginBottom: Spacing.sm },
  accountCard: { padding: Spacing.md },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.primaryGlow, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary + '44',
  },
  avatarText:   { fontSize: FontSize.xl, color: Colors.primary, fontWeight: '700' },
  accountInfo:  { flex: 1 },
  accountName:  { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  accountEmail: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 17 },
  section: { gap: 8 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, minHeight: 48 },
  settingIcon: { width: 26, textAlign: 'center' },
  settingInfo: { flex: 1 },
  settingTitle:{ fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: '500' },
  settingSubtitle: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  version: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.sm },
});
