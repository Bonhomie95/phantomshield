import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import * as pinVault from '@/services/pinVault';

interface PinPadProps {
  title: string;
  subtitle?: string;
  /** 'verify' — checks the entered PIN via `verify`. 'set' — accepts any 4-digit input */
  mode?: 'verify' | 'set';
  /**
   * Verify callback for 'verify' mode. Returns true if the PIN is accepted.
   * When omitted, any 4-digit PIN passes (e.g. a layer with no PIN configured).
   */
  verify?: (pin: string) => boolean | Promise<boolean>;
  maxAttempts?: number;
  onSuccess: (pin: string) => void;
  onFail?: (attempts: number) => void;
}

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export function PinPad({
  title,
  subtitle,
  mode = 'verify',
  verify,
  maxAttempts = 10,
  onSuccess,
  onFail,
}: PinPadProps) {
  const [pin, setPin]         = useState('');
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked]   = useState(false);
  const [lockSecs, setLockSecs] = useState(0);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const lockTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Verify mode: restore any persisted lockout so a relaunch can't bypass it.
  useEffect(() => {
    if (mode !== 'verify') return;
    (async () => {
      const st = await pinVault.getLockState();
      setAttempts(st.attempts);
      const remaining = Math.ceil((st.lockedUntil - Date.now()) / 1000);
      if (remaining > 0) startLockoutUntil(st.lockedUntil);
    })();
    return () => { if (lockTimer.current) clearInterval(lockTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,   duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6,  duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 40, useNativeDriver: true }),
    ]).start();
    Vibration.vibrate(200);
  };

  const startLockoutUntil = (untilMs: number) => {
    if (lockTimer.current) clearInterval(lockTimer.current);
    setLocked(true);
    setLockSecs(Math.max(0, Math.ceil((untilMs - Date.now()) / 1000)));
    lockTimer.current = setInterval(() => {
      const remaining = Math.ceil((untilMs - Date.now()) / 1000);
      if (remaining <= 0) {
        if (lockTimer.current) clearInterval(lockTimer.current);
        setLocked(false);
        setLockSecs(0);
      } else {
        setLockSecs(remaining);
      }
    }, 1000);
  };

  const handleKey = (key: string) => {
    if (locked) return;

    if (key === '⌫') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (key === '') return;

    const next = pin + key;
    if (next.length > 4) return;

    setPin(next);

    if (next.length === 4) {
      setTimeout(async () => {
        if (mode === 'set') {
          // In 'set' mode any 4-digit PIN is accepted
          onSuccess(next);
          setPin('');
          return;
        }

        // In 'verify' mode delegate to the async verify callback.
        // No callback → treat as "no PIN configured" and pass through.
        const accepted = verify ? await Promise.resolve(verify(next)) : true;

        if (accepted) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await pinVault.resetAttempts();
          onSuccess(next);
          setPin('');
        } else {
          shake();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setPin('');
          // Persist the failure so the lockout survives an app relaunch.
          const st = await pinVault.registerFailedAttempt();
          setAttempts(st.attempts);
          onFail?.(st.attempts);
          if (st.lockedUntil > Date.now()) startLockoutUntil(st.lockedUntil);
        }
      }, 80);
    }
  };

  const dots = Array.from({ length: 4 }, (_, i) => ({
    filled: i < pin.length,
  }));

  return (
    <View style={s.container}>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}

      {/* PIN dots */}
      <Animated.View style={[s.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
        {dots.map((d, i) => (
          <View key={i} style={[s.pinDot, d.filled && s.pinDotFilled]} />
        ))}
      </Animated.View>

      {locked && (
        <View style={s.lockBanner}>
          <Text style={s.lockText}>Too many attempts — wait {lockSecs}s</Text>
        </View>
      )}

      {/* Keypad */}
      <View style={s.keypad}>
        {KEYS.map((key, i) => (
          <TouchableOpacity
            key={i}
            style={[s.key, key === '' && s.keyEmpty]}
            onPress={() => handleKey(key)}
            disabled={key === '' || locked}
            activeOpacity={key ? 0.6 : 1}
          >
            <Text style={[s.keyText, key === '⌫' && s.backspace]}>{key}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {attempts > 0 && !locked && (
        <Text style={s.attemptsText}>
          {attempts} failed attempt{attempts > 1 ? 's' : ''}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { alignItems: 'center', paddingHorizontal: Spacing.xl },
  title:     { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginBottom: 6 },
  subtitle:  { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.lg },
  dotsRow:   { flexDirection: 'row', gap: 20, marginBottom: Spacing.xl },
  pinDot:    {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.pinDot, borderWidth: 2, borderColor: Colors.bgBorder,
  },
  pinDotFilled: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  keypad:    { flexDirection: 'row', flexWrap: 'wrap', width: 280, justifyContent: 'center', gap: 12 },
  key: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.pinKey, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.bgBorder,
  },
  keyEmpty:  { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText:   { fontSize: FontSize.xl, fontWeight: '600', color: Colors.textPrimary },
  backspace: { fontSize: FontSize.xl, color: Colors.textSecondary },
  lockBanner:{
    backgroundColor: Colors.accentGlow, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, marginBottom: Spacing.md,
  },
  lockText:     { fontSize: FontSize.sm, color: Colors.accent, fontWeight: '600' },
  attemptsText: { fontSize: FontSize.xs, color: Colors.accent, marginTop: Spacing.md },
});
