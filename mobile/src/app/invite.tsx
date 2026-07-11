import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { getReferralInfo, redeemReferral, ReferralInfo } from '@/services/api';
import { track } from '@/services/analytics';

export default function InviteScreen() {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    track('invite_viewed');
    getReferralInfo().then(setInfo).finally(() => setLoading(false));
  }, []);

  const shareInvite = async () => {
    if (!info) return;
    track('invite_shared');
    const message = `I'm using PhantomShield to protect my phone 🛡 — it alarms and snaps a photo if anyone touches it. Use my code ${info.code} and we both get 30 days of Guard free: ${info.shareUrl}`;
    if (await Sharing.isAvailableAsync()) {
      // Sharing needs a file; fall back to clipboard for plain text.
      await Clipboard.setStringAsync(message);
      Alert.alert('Invite copied', 'Your invite message was copied — paste it anywhere.');
    } else {
      await Clipboard.setStringAsync(message);
      Alert.alert('Invite copied', 'Your invite message was copied to the clipboard.');
    }
  };

  const copyCode = async () => {
    if (!info) return;
    await Clipboard.setStringAsync(info.code);
    Alert.alert('Copied', `Code ${info.code} copied.`);
  };

  const handleRedeem = async () => {
    if (redeemCode.trim().length < 4) return;
    setRedeeming(true);
    const res = await redeemReferral(redeemCode.trim().toUpperCase());
    setRedeeming(false);
    Alert.alert(res.ok ? 'Success 🎉' : 'Couldn’t redeem', res.message);
    if (res.ok) { track('referral_redeemed'); router.back(); }
  };

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container}>
      <TouchableOpacity style={s.close} onPress={() => router.back()}>
        <Text style={s.closeText}>✕</Text>
      </TouchableOpacity>

      <Text style={s.title}>Invite friends, get Guard free</Text>
      <Text style={s.sub}>You and your friend each get 30 days of Phantom Guard when they use your code.</Text>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : info ? (
        <>
          <View style={s.codeCard}>
            <Text style={s.codeLabel}>YOUR CODE</Text>
            <Text style={s.code}>{info.code}</Text>
            <TouchableOpacity onPress={copyCode}><Text style={s.copy}>Tap to copy</Text></TouchableOpacity>
          </View>

          <TouchableOpacity style={s.shareBtn} onPress={shareInvite} activeOpacity={0.85}>
            <Text style={s.shareText}>Share invite</Text>
          </TouchableOpacity>

          {info.referralCount > 0 && (
            <Text style={s.count}>🎉 {info.referralCount} friend{info.referralCount > 1 ? 's' : ''} joined with your code</Text>
          )}

          {!info.alreadyReferred && (
            <View style={s.redeemBox}>
              <Text style={s.redeemLabel}>Have a friend's code?</Text>
              <View style={s.redeemRow}>
                <TextInput
                  value={redeemCode}
                  onChangeText={setRedeemCode}
                  placeholder="ENTER CODE"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="characters"
                  style={s.input}
                  maxLength={12}
                />
                <TouchableOpacity style={s.redeemBtn} onPress={handleRedeem} disabled={redeeming}>
                  {redeeming ? <ActivityIndicator color={Colors.bg} /> : <Text style={s.redeemBtnText}>Redeem</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      ) : (
        <Text style={s.sub}>Sign in to get your invite code.</Text>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, gap: Spacing.md },
  close: { position: 'absolute', top: 52, right: 20, zIndex: 2 },
  closeText: { fontSize: 22, color: Colors.textSecondary },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.md },
  codeCard: { backgroundColor: Colors.primaryGlow, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.primary + '55', padding: Spacing.lg, alignItems: 'center', gap: 4 },
  codeLabel: { fontSize: 10, letterSpacing: 1.5, color: Colors.textSecondary, fontWeight: '700' },
  code: { fontSize: 40, fontWeight: '900', color: Colors.primary, letterSpacing: 6 },
  copy: { fontSize: FontSize.xs, color: Colors.textSecondary },
  shareBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 16, alignItems: 'center' },
  shareText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
  count: { fontSize: FontSize.sm, color: Colors.success, textAlign: 'center' },
  redeemBox: { marginTop: Spacing.lg, gap: 8 },
  redeemLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  redeemRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.bgBorder, paddingHorizontal: Spacing.md, color: Colors.textPrimary, fontSize: FontSize.md, letterSpacing: 2 },
  redeemBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center' },
  redeemBtnText: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.bg },
});
