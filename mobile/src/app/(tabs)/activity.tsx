import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import { usePhantomStore } from "@/stores/phantom";
import { ActivityCard } from "@/components/ActivityCard";
import {
  Card,
  SectionHeader,
  Badge,
  Button,
  Divider,
} from "@/components/ui/components";
import { Colors, Spacing, FontSize, Radius } from "@/constants/theme";

type FilterTab = "all" | "anomalies" | "today";
type ViewMode = "apps" | "unlocks";

export default function ActivityScreen() {
  const { recentActivity, unlockEvents, unlockedLayers, trackingEnabled } =
    usePhantomStore();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("apps");

  const isUnlocked = unlockedLayers.includes("logs");

  if (!isUnlocked) {
    return (
      <View style={styles.locked}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.lockTitle}>Activity Logs</Text>
        <Text style={styles.lockSub}>
          Enter your Logs PIN to view full activity history.
        </Text>
        <Button
          label="Unlock Logs"
          onPress={() =>
            router.push({
              pathname: "/pin-gate",
              params: { layer: "logs", redirect: "/(tabs)/activity" },
            })
          }
          variant="primary"
          style={styles.unlockBtn}
        />
      </View>
    );
  }

  const today = new Date().toDateString();

  // ── App events ─────────────────────────────────────────────────────────────
  const filteredApps = recentActivity.filter((e) => {
    if (filter === "anomalies" && !e.isAnomaly) return false;
    if (filter === "today" && new Date(e.openedAt).toDateString() !== today)
      return false;
    if (search && !e.appName.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const groupedApps: Record<string, typeof filteredApps> = {};
  filteredApps.forEach((e) => {
    const day = new Date(e.openedAt).toDateString();
    if (!groupedApps[day]) groupedApps[day] = [];
    groupedApps[day].push(e);
  });

  // ── Unlock events ──────────────────────────────────────────────────────────
  const filteredUnlocks = unlockEvents.filter((e) => {
    if (filter === "anomalies" && !e.isAnomaly) return false;
    if (filter === "today" && new Date(e.timestamp).toDateString() !== today)
      return false;
    return true;
  });

  const groupedUnlocks: Record<string, typeof filteredUnlocks> = {};
  filteredUnlocks.forEach((e) => {
    const day = new Date(e.timestamp).toDateString();
    if (!groupedUnlocks[day]) groupedUnlocks[day] = [];
    groupedUnlocks[day].push(e);
  });

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalSec = recentActivity.reduce((s, e) => s + e.durationSec, 0);
  const appAnomalies = recentActivity.filter((e) => e.isAnomaly).length;
  const lockAnomalies = unlockEvents.filter((e) => e.isAnomaly).length;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Activity Logs</Text>
        <Badge
          label={trackingEnabled ? "LIVE" : "PAUSED"}
          variant={trackingEnabled ? "cyan" : "neutral"}
        />
      </View>

      {/* Summary */}
      <Card style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <SummaryItem value={recentActivity.length} label="App Opens" />
          <View style={styles.sep} />
          <SummaryItem value={unlockEvents.length} label="Unlocks" />
          <View style={styles.sep} />
          <SummaryItem
            value={appAnomalies + lockAnomalies}
            label="Anomalies"
            accent
          />
          <View style={styles.sep} />
          <SummaryItem value={Math.round(totalSec / 60)} label="Mins" />
        </View>
      </Card>

      {/* Empty state */}
      {recentActivity.length === 0 && unlockEvents.length === 0 && (
        <Card style={styles.emptyCard}>
          <Text style={{ fontSize: 32 }}>{trackingEnabled ? "⏳" : "📋"}</Text>
          <Text style={styles.emptyTitle}>
            {trackingEnabled ? "Collecting data…" : "Tracking is off"}
          </Text>
          <Text style={styles.emptyText}>
            {trackingEnabled
              ? "Events appear here as you use your phone. Come back in a few minutes."
              : "Enable tracking from the Dashboard to start recording activity."}
          </Text>
        </Card>
      )}

      {(recentActivity.length > 0 || unlockEvents.length > 0) && (
        <>
          {/* View mode toggle */}
          <View style={styles.viewToggle}>
            {(["apps", "unlocks"] as ViewMode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.viewTab, viewMode === m && styles.viewTabActive]}
                onPress={() => setViewMode(m)}
              >
                <Text
                  style={[
                    styles.viewLabel,
                    viewMode === m && styles.viewLabelActive,
                  ]}
                >
                  {m === "apps"
                    ? `📱 App Opens (${recentActivity.length})`
                    : `🔓 Unlocks (${unlockEvents.length})`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Search — apps only */}
          {viewMode === "apps" && (
            <View style={styles.searchWrap}>
              <Text style={{ fontSize: 14 }}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search apps…"
                placeholderTextColor={Colors.textMuted}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <Text style={{ fontSize: 14, color: Colors.textMuted }}>
                    ✕
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Filter row */}
          <View style={styles.filterRow}>
            {(["all", "anomalies", "today"] as FilterTab[]).map((f) => (
              <TouchableOpacity
                key={f}
                onPress={() => setFilter(f)}
                style={[
                  styles.filterTab,
                  filter === f && styles.filterTabActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterLabel,
                    filter === f && styles.filterLabelActive,
                  ]}
                >
                  {f === "all"
                    ? "All"
                    : f === "anomalies"
                      ? "⚠️ Anomalies"
                      : "Today"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* App opens */}
          {viewMode === "apps" && (
            <>
              {Object.entries(groupedApps).map(([day, events]) => (
                <View key={day} style={styles.dayGroup}>
                  <Text style={styles.dayLabel}>
                    {new Date(day).toDateString() === today ? "Today" : day}
                  </Text>
                  {events.map((e) => (
                    <ActivityCard key={e.id} event={e} />
                  ))}
                </View>
              ))}
              {filteredApps.length === 0 && (
                <Text style={styles.noResults}>
                  No app events match this filter.
                </Text>
              )}
            </>
          )}

          {/* Unlock events */}
          {viewMode === "unlocks" && (
            <>
              {Object.entries(groupedUnlocks).map(([day, events]) => (
                <View key={day} style={styles.dayGroup}>
                  <Text style={styles.dayLabel}>
                    {new Date(day).toDateString() === today ? "Today" : day}
                  </Text>
                  <Card>
                    {events.map((ev, i) => (
                      <React.Fragment key={ev.id}>
                        {i > 0 && <Divider />}
                        <View style={styles.unlockRow}>
                          <View
                            style={[
                              styles.unlockDot,
                              {
                                backgroundColor: ev.isAnomaly
                                  ? Colors.accent
                                  : Colors.success,
                              },
                            ]}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.unlockTime}>
                              {new Date(ev.timestamp).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </Text>
                            {ev.isAnomaly && ev.anomalyReason && (
                              <Text style={styles.unlockReason}>
                                {ev.anomalyReason}
                              </Text>
                            )}
                          </View>
                          {ev.isAnomaly && (
                            <Text style={{ fontSize: 14 }}>⚠️</Text>
                          )}
                        </View>
                      </React.Fragment>
                    ))}
                  </Card>
                </View>
              ))}
              {filteredUnlocks.length === 0 && (
                <Text style={styles.noResults}>
                  No unlock events match this filter.
                </Text>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function SummaryItem({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.summaryItem}>
      <Text
        style={[
          styles.summaryValue,
          accent && value > 0 ? { color: Colors.accent } : {},
        ]}
      >
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: {
    padding: Spacing.lg,
    paddingTop: 60,
    paddingBottom: 32,
    gap: Spacing.md,
  },
  locked: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  lockIcon: { fontSize: 52 },
  lockTitle: {
    fontSize: FontSize.xxl,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  lockSub: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  unlockBtn: { width: "80%", marginTop: Spacing.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  summaryCard: { padding: Spacing.md },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryValue: {
    fontSize: FontSize.xl,
    fontWeight: "700",
    color: Colors.primary,
  },
  summaryLabel: { fontSize: 10, color: Colors.textSecondary, marginTop: 2 },
  sep: { width: 1, height: 32, backgroundColor: Colors.bgBorder },
  emptyCard: { alignItems: "center", padding: Spacing.xl, gap: 6 },
  emptyTitle: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  emptyText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  viewToggle: { flexDirection: "row", gap: 8 },
  viewTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgCard,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.bgBorder,
  },
  viewTabActive: {
    backgroundColor: Colors.primaryGlow,
    borderColor: Colors.primary + "44",
  },
  viewLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  viewLabelActive: { color: Colors.primary },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.bgBorder,
    paddingHorizontal: Spacing.md,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  filterRow: { flexDirection: "row", gap: 8 },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgCard,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.bgBorder,
  },
  filterTabActive: {
    backgroundColor: Colors.primaryGlow,
    borderColor: Colors.primary + "44",
  },
  filterLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  filterLabelActive: { color: Colors.primary },
  dayGroup: { gap: 6 },
  dayLabel: {
    fontSize: FontSize.xs,
    fontWeight: "700",
    color: Colors.textMuted,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  unlockRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 10,
  },
  unlockDot: { width: 8, height: 8, borderRadius: 4 },
  unlockTime: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    fontWeight: "500",
  },
  unlockReason: { fontSize: FontSize.xs, color: Colors.accent, marginTop: 2 },
  noResults: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: Spacing.xl,
  },
});
