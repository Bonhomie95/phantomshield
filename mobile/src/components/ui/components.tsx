import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';

// ─── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  glow?: 'cyan' | 'red' | 'green';
}

export function Card({ children, style, glow }: CardProps) {
  const glowColor =
    glow === 'cyan'  ? Colors.primary :
    glow === 'red'   ? Colors.accent  :
    glow === 'green' ? Colors.success : undefined;

  return (
    <View
      style={[
        s.card,
        glow && { borderColor: glowColor + '55', backgroundColor: glowColor + '0A' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant = 'cyan' | 'red' | 'green' | 'warning' | 'neutral';

const BADGE_COLORS: Record<BadgeVariant, { bg: string; text: string }> = {
  cyan:    { bg: Colors.primaryGlow, text: Colors.primary },
  red:     { bg: Colors.accentGlow,  text: Colors.accent  },
  green:   { bg: Colors.successGlow, text: Colors.success },
  warning: { bg: 'rgba(255,170,0,0.1)', text: Colors.warning },
  neutral: { bg: Colors.bgElevated,  text: Colors.textSecondary },
};

export function Badge({ label, variant = 'neutral' }: { label: string; variant?: BadgeVariant }) {
  const { bg, text } = BADGE_COLORS[variant];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: text }]}>{label}</Text>
    </View>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  style?: ViewStyle;
  disabled?: boolean;
}

export function Button({ label, onPress, variant = 'primary', style, disabled }: ButtonProps) {
  const variantStyle: ViewStyle =
    variant === 'primary'   ? { backgroundColor: Colors.primary } :
    variant === 'secondary' ? { backgroundColor: Colors.bgElevated, borderWidth: 1, borderColor: Colors.bgBorder } :
    variant === 'danger'    ? { backgroundColor: Colors.accentGlow, borderWidth: 1, borderColor: Colors.accent + '55' } :
    /* ghost */               { borderWidth: 1, borderColor: Colors.bgBorder };

  const textColor: TextStyle =
    variant === 'primary'   ? { color: Colors.bg } :
    variant === 'danger'    ? { color: Colors.accent } :
    { color: Colors.textSecondary };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      style={[s.btn, variantStyle, disabled && s.btnDisabled, style]}
    >
      <Text style={[s.btnText, textColor]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <View style={s.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={s.sectionTitle}>{title}</Text>
        {subtitle && <Text style={s.sectionSub}>{subtitle}</Text>}
      </View>
      {action && (
        <TouchableOpacity onPress={action.onPress}>
          <Text style={s.sectionAction}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────

export function Divider() {
  return <View style={s.divider} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.bgBorder,
  },
  badge: {
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { fontSize: FontSize.xs, fontWeight: '700', letterSpacing: 0.5 },
  btn: {
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText:     { fontSize: FontSize.md, fontWeight: '700' },
  sectionHeader:{
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionTitle: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  sectionSub:   { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  sectionAction:{ fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  divider:      { height: 1, backgroundColor: Colors.bgBorder, marginVertical: 2 },
});
