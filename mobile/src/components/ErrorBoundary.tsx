import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { captureError } from '@/services/monitoring';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
}

/**
 * Catches render/runtime errors anywhere below it so the app shows a recovery
 * screen instead of a white crash, and reports the error to Sentry.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown): void {
    captureError(error, { componentStack: (info as any)?.componentStack });
  }

  private reset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={s.container}>
        <Text style={s.icon}>🛡️</Text>
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.sub}>
          PhantomShield hit an unexpected error. Your data is safe. Try again.
        </Text>
        <TouchableOpacity style={s.btn} onPress={this.reset} activeOpacity={0.85}>
          <Text style={s.btnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  icon: { fontSize: 56 },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  btn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 16,
    paddingHorizontal: 48,
  },
  btnText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
});
