import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AppUsageEvent } from '@/constants/types';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';

function formatDuration(sec: number): string {
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface Props { event: AppUsageEvent }

export function ActivityCard({ event }: Props) {
  return (
    <View style={[s.card, event.isAnomaly && s.cardAnomaly]}>
      <View style={s.left}>
        <View style={[s.dot, { backgroundColor: event.isAnomaly ? Colors.accent : Colors.success }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.appName}>{event.appName}</Text>
          {event.isAnomaly && event.anomalyReason && (
            <Text style={s.reason}>{event.anomalyReason}</Text>
          )}
        </View>
      </View>
      <View style={s.right}>
        <Text style={s.duration}>{formatDuration(event.durationSec)}</Text>
        <Text style={s.time}>{formatTime(event.openedAt)}</Text>
      </View>
    </View>
  );
}
export default ActivityCard;

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.bgBorder,
  },
  cardAnomaly: { borderColor: Colors.accent + '55', backgroundColor: Colors.accentGlow },
  left:    { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  dot:     { width: 8, height: 8, borderRadius: 4 },
  appName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  reason:  { fontSize: FontSize.xs, color: Colors.accent, marginTop: 2 },
  right:   { alignItems: 'flex-end', gap: 2 },
  duration:{ fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  time:    { fontSize: FontSize.xs, color: Colors.textMuted },
});
