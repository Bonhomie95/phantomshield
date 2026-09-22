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
import { Ionicons } from "@expo/vector-icons";
import {
  GoogleSignin,
  GoogleSigninButton,
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

// Configure Google Sign-In once at module level. The webClientId is the
// audience the backend verifies the ID token against.
GoogleSignin.configure({
  webClientId: GOOGLE.webClientId,
  iosClientId: GOOGLE.iosClientId,
  scopes: ["profile", "email"],
});

/** Model / OS shown in the device list, so owners can tell their phones apart. */
const deviceMeta = () => ({
  model:
    Platform.OS === "android"
      ? String((Platform.constants as { Model?: string }).Model ?? "Android phone").slice(0, 64)
      : "iPhone",
  osVersion: String(Platform.Version).slice(0, 32),
});

const FEATURES: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; desc: string }[] = [
  {
    icon: "shield-half-outline",
    title: "Guard Mode",
    desc: "On a table, charging, or in your pocket — know the moment someone takes your phone, with a photo, time and place.",
  },
  {
    icon: "people-outline",
    title: "Guardians",
    desc: "If your SIM is swapped or Guard Mode goes off, someone you trust gets a live location link.",
  },
  {
    icon: "help-buoy-outline",
    title: "Lost mode",
    desc: "Put “call me” on your lost phone’s lock screen, find it on a map, or sound an alarm from any browser.",
  },
  {
    icon: "document-text-outline",
    title: "Evidence report",
    desc: "A PDF with photos, times and places, ready for the police or your insurer.",
  },
];

export default function WelcomeScreen() {
  const { setUser, setAuthenticated } = usePhantomStore();
  // Opened from inside the app to add an account to a phone already set up.
  const linking = usePhantomStore((st) => st.onboarded);
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
  }, [fadeAnim, slideAnim]);

  // ── Shared post-verification flow ──────────────────────────────────────────
  const handleOAuthSuccess = async (
    provider: "google" | "apple",
    idToken: string,
    appleUserData?: { email?: string; name?: string },
    authorizationCode?: string,
  ) => {
    try {
      const deviceId = await getOrCreateDeviceId();
      const result = await oauthSignIn({
        provider,
        idToken,
        appleUserData,
        authorizationCode,
        device: {
          deviceId,
          platform: Platform.OS as "ios" | "android",
          appVersion: Constants.expoConfig?.version ?? "1.0.0",
          ...deviceMeta(),
        },
      });
      await storeTokens(result.accessToken, result.refreshToken);
      setUser(result.user);
      setAuthenticated(true);
      const isNew =
        result.isNewUser ??
        Date.now() - new Date(result.user.createdAt).getTime() < 10_000;
      track(isNew ? "sign_up" : "sign_in", { provider });
      // A phone already set up goes back into the app; otherwise set it up.
      const st = usePhantomStore.getState();
      if (st.onboarded) router.replace(st.isAppUnlocked ? "/(tabs)" : "/biometric-gate");
      else router.replace("/permissions-intro");
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
      Alert.alert("Google sign-in unavailable", "Please try again later.");
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

      await handleOAuthSuccess(
        "apple",
        credential.identityToken,
        { email: credential.email ?? undefined, name },
        credential.authorizationCode ?? undefined,
      );
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
        <Text style={styles.tagline}>
          {linking ? "Sign in to back up evidence and find this phone from anywhere." : "Know if anyone takes your phone."}
        </Text>
      </Animated.View>

      {/* ── Auth buttons — above the fold so nobody has to hunt for them ── */}
      <View style={styles.authSection}>
        {/* Apple first on iOS (HIG), then Google — both official buttons. */}
        {Platform.OS === "ios" && (
          <View pointerEvents={disabled ? "none" : "auto"} style={disabled && styles.oauthBtnDisabled}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={Radius.md}
              style={styles.appleBtn}
              onPress={handleAppleSignIn}
            />
          </View>
        )}

        <GoogleSigninButton
          size={GoogleSigninButton.Size.Wide}
          color={GoogleSigninButton.Color.Dark}
          onPress={handleGoogleSignIn}
          disabled={disabled}
          style={[styles.googleBtn, disabled && styles.oauthBtnDisabled]}
        />

        {loading && (
          <View style={styles.loadingRow} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.loadingText}>Signing you in…</Text>
          </View>
        )}

        {linking ? (
          <TouchableOpacity style={styles.tryBtn} onPress={() => router.back()} disabled={disabled} activeOpacity={0.8}>
            <Text style={styles.tryText}>Not now</Text>
          </TouchableOpacity>
        ) : (
          <>
            {/* An account is optional: everything on the phone works without one. */}
            <TouchableOpacity
              style={styles.tryBtn}
              onPress={() => router.push("/permissions-intro")}
              disabled={disabled}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={styles.tryText}>Continue without an account</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => router.push("/guard-mode")}
              disabled={disabled}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>Just try Guard Mode</Text>
            </TouchableOpacity>
          </>
        )}
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
            <Ionicons name={f.icon} size={22} color={Colors.primary} style={styles.featureIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureDesc}>{f.desc}</Text>
            </View>
          </Animated.View>
        ))}
      </View>

      {/* Transparency notice */}
      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
        <Text style={styles.noticeText}>
          PhantomShield protects{" "}
          <Text style={{ color: Colors.primary }}>this phone, for its owner</Text>.
          Nothing is recorded until you switch it on, and you can see and delete
          everything it keeps.
        </Text>
      </View>

      <Text style={styles.legal}>
        By continuing you agree to our{" "}
        <Text
          style={{ color: Colors.primary }}
          accessibilityRole="link"
          onPress={() => WebBrowser.openBrowserAsync(LEGAL.terms)}
        >
          Terms of Service
        </Text>{" "}
        and{" "}
        <Text
          style={{ color: Colors.primary }}
          accessibilityRole="link"
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
  featureIcon: { marginTop: 2 },
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

  oauthBtnDisabled: { opacity: 0.5 },
  appleBtn: { width: "100%", height: 52 },
  googleBtn: { width: "100%", height: 52 },
  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: FontSize.sm, color: Colors.textSecondary },

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
  linkBtn: { alignItems: "center", paddingVertical: 6 },
  linkText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  legal: {
    textAlign: "center",
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 18,
  },
});
