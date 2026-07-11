import React, { useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Animated,
  Platform,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { ShieldLogo } from "@/components/ShieldLogo";
import { Colors, Spacing, FontSize, Radius } from "@/constants/theme";
import { GOOGLE, LEGAL } from "@/constants/config";
import { oauthSignIn, storeTokens, getOrCreateDeviceId } from "@/services/api";
import { usePhantomStore } from "@/stores/phantom";
import { track } from "@/services/analytics";

// Configure Google Sign-In once at module level.
// Only the webClientId is required — it tells Google which server to issue tokens for.
GoogleSignin.configure({
  webClientId: GOOGLE.webClientId,
  iosClientId: GOOGLE.iosClientId,

  offlineAccess: true, // gets a serverAuthCode your backend can exchange for tokens
  scopes: ["profile", "email"],
});

const FEATURES = [
  {
    icon: "🕵️",
    title: "Silent Monitoring",
    desc: "Tracks app usage and anomalies — only when you enable it.",
  },
  {
    icon: "🔐",
    title: "Multi-Layer PINs",
    desc: "Separate PINs for logs, vault, and settings. Plus a decoy PIN.",
  },
  {
    icon: "📸",
    title: "Intruder Snapshots",
    desc: "Wrong PIN attempts silently capture the front camera.",
  },
  {
    icon: "🌐",
    title: "Remote Dashboard",
    desc: "View activity and lock tracking from any browser.",
  },
];

export default function WelcomeScreen() {
  const { setUser, setAuthenticated } = usePhantomStore();
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // ── Shared post-verification flow ──────────────────────────────────────────
  const handleOAuthSuccess = async (
    provider: "google" | "apple",
    idToken: string,
    appleUserData?: { email?: string; name?: string },
  ) => {
    try {
      const deviceId = await getOrCreateDeviceId();
      const result = await oauthSignIn({
        provider,
        idToken,
        appleUserData,
        device: {
          deviceId,
          platform: Platform.OS as "ios" | "android",
          appVersion: Constants.expoConfig?.version ?? "1.0.0",
        },
      });
      await storeTokens(result.accessToken, result.refreshToken);
      setUser(result.user);
      setAuthenticated(true);
      const isNew =
        result.isNewUser ??
        Date.now() - new Date(result.user.createdAt).getTime() < 10_000;
      track(isNew ? "sign_up" : "sign_in", { provider });
      // New users see the permission explainer (which leads to PIN setup);
      // returning users go straight to the biometric gate.
      router.replace(isNew ? "/permissions-intro" : "/biometric-gate");
    } catch (err: any) {
      Alert.alert(
        "Sign-In Failed",
        err.message ?? "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(null);
    }
  };

  // ── Google Sign-In ─────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    if (!GOOGLE.webClientId) {
      Alert.alert(
        "Not Configured",
        "Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to your .env file.\nSee src/constants/config.ts for instructions.",
      );
      return;
    }

    setLoading("google");
    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
      const userInfo = await GoogleSignin.signIn();

      // SDK v13+ shape: userInfo.data.idToken
      // SDK v12 shape:  userInfo.idToken
      const idToken =
        (userInfo as any).data?.idToken ?? (userInfo as any).idToken ?? null;

      if (!idToken) throw new Error("No ID token returned by Google.");

      await handleOAuthSuccess("google", idToken);
    } catch (err: any) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        // User dismissed — not an error
      } else if (err.code === statusCodes.IN_PROGRESS) {
        // Another sign-in already in progress — ignore
      } else if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert(
          "Google Sign-In",
          "Google Play Services not available on this device.",
        );
      } else {
        Alert.alert(
          "Google Sign-In Failed",
          err.message ?? "Please try again.",
        );
      }
      setLoading(null);
    }
  };

  // ── Apple Sign-In ──────────────────────────────────────────────────────────
  const handleAppleSignIn = async () => {
    setLoading("apple");
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken)
        throw new Error("No identity token from Apple.");

      const name =
        [credential.fullName?.givenName, credential.fullName?.familyName]
          .filter(Boolean)
          .join(" ") || undefined;

      await handleOAuthSuccess("apple", credential.identityToken, {
        email: credential.email ?? undefined,
        name,
      });
    } catch (err: any) {
      if (err.code !== "ERR_REQUEST_CANCELED") {
        Alert.alert("Apple Sign-In Failed", err.message ?? "Please try again.");
        setLoading(null);
      } else {
        setLoading(null);
      }
    }
  };

  const disabled = loading !== null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero */}
      <Animated.View
        style={[
          styles.hero,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <ShieldLogo size={72} />
        <Text style={styles.brand}>PhantomShield</Text>
        <Text style={styles.tagline}>Your phone. Your eyes. Always.</Text>
      </Animated.View>

      {/* ── Auth buttons — above the fold so nobody has to hunt for them ── */}
      <View style={styles.authSection}>
        {/* Google */}
        <TouchableOpacity
          style={[styles.oauthBtn, disabled && styles.oauthBtnDisabled]}
          onPress={handleGoogleSignIn}
          disabled={disabled}
          activeOpacity={0.75}
        >
          <View style={[styles.oauthIconBox, { backgroundColor: "#fff" }]}>
            {loading === "google" ? (
              <ActivityIndicator size="small" color="#4285F4" />
            ) : (
              <Text style={[styles.oauthIconLetter, { color: "#4285F4" }]}>
                G
              </Text>
            )}
          </View>
          <Text style={styles.oauthLabel}>
            {loading === "google" ? "Signing in…" : "Continue with Google"}
          </Text>
        </TouchableOpacity>

        {/* Apple — iOS only */}
        {Platform.OS === "ios" && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={
              AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
            }
            buttonStyle={
              AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={Radius.md}
            style={[styles.appleBtn, disabled && styles.oauthBtnDisabled]}
            onPress={handleAppleSignIn}
          />
        )}

        {/* Value moment — let people feel the product before signing up. */}
        <TouchableOpacity
          style={styles.tryBtn}
          onPress={() => router.push("/guard-mode")}
          disabled={disabled}
          activeOpacity={0.8}
        >
          <Text style={styles.tryText}>🛡  Try Guard Mode — no account needed</Text>
        </TouchableOpacity>
      </View>

      {/* Feature cards — informational, fine below the fold */}
      <View style={styles.features}>
        {FEATURES.map((f, i) => (
          <Animated.View
            key={i}
            style={[
              styles.featureCard,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <Text style={styles.featureIcon}>{f.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureDesc}>{f.desc}</Text>
            </View>
          </Animated.View>
        ))}
      </View>

      {/* Transparency notice */}
      <View style={styles.notice}>
        <Text style={{ fontSize: 16, marginTop: 1 }}>ℹ️</Text>
        <Text style={styles.noticeText}>
          PhantomShield only monitors{" "}
          <Text style={{ color: Colors.primary }}>your own device</Text>. You
          are always aware and in control. Nothing runs without your activation.
        </Text>
      </View>

      <Text style={styles.legal}>
        By continuing you agree to our{" "}
        <Text
          style={{ color: Colors.primary }}
          onPress={() => WebBrowser.openBrowserAsync(LEGAL.terms)}
        >
          Terms of Service
        </Text>{" "}
        and{" "}
        <Text
          style={{ color: Colors.primary }}
          onPress={() => WebBrowser.openBrowserAsync(LEGAL.privacy)}
        >
          Privacy Policy
        </Text>
        .
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingBottom: 48 },

  hero: {
    alignItems: "center",
    paddingTop: 36,
    paddingBottom: Spacing.lg,
    gap: 6,
  },
  brand: {
    fontSize: FontSize.xxl,
    fontWeight: "700",
    color: Colors.textPrimary,
    letterSpacing: 1,
    marginTop: Spacing.md,
  },
  tagline: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    letterSpacing: 0.4,
  },

  features: { gap: 10, marginBottom: Spacing.lg },
  featureCard: {
    flexDirection: "row",
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.bgBorder,
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  featureIcon: { fontSize: 22, marginTop: 2 },
  featureTitle: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  notice: {
    flexDirection: "row",
    backgroundColor: Colors.primaryGlow,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.primary + "33",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
    alignItems: "flex-start",
  },
  noticeText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },

  authSection: { gap: 12, marginBottom: Spacing.lg },

  oauthBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.bgBorder,
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    gap: 12,
  },
  oauthBtnDisabled: { opacity: 0.5 },
  oauthIconBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  oauthIconLetter: { fontSize: 16, fontWeight: "800" },
  oauthLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.textPrimary,
  },

  appleBtn: { width: "100%", height: 52 },

  tryBtn: {
    borderWidth: 1,
    borderColor: Colors.primary + "55",
    backgroundColor: Colors.primaryGlow,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  tryText: {
    fontSize: FontSize.sm,
    fontWeight: "700",
    color: Colors.primary,
  },
  legal: {
    textAlign: "center",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 18,
  },
});
