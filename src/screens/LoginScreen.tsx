import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import { useAuthStore } from "../auth/authStore";
import { theme } from "../theme";
import { t } from "../lib/i18n";
import { AppText, Button, ErrorState, Input } from "../ui";

/**
 * Visual-only restyle. The auth state machine, QR payloads, TDLib calls and
 * transitions below are untouched — this screen only changes layout, type,
 * colour and copy presentation.
 */
export function LoginScreen() {
  const { phase, busy, error, qrLinks, boot, clearError } = useAuthStore();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "android" ? undefined : "padding"}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.shell}>
            <View style={styles.header}>
              <View style={styles.logoGlyph} accessible={false} importantForAccessibility="no-hide-descendants">
                <View style={styles.logoRing} />
                <View style={styles.logoInner} />
              </View>
              <AppText variant="display" align="center">
                {t("login.title")}
              </AppText>
              <AppText variant="body" color={theme.colors.onSurfaceVariant} align="center" style={styles.tagline}>
                {t("login.tagline")}
              </AppText>
            </View>

            {error ? (
              <Pressable
                onPress={clearError}
                accessibilityRole="button"
                accessibilityLabel={`${error}. ${t("common.dismiss")}`}
                style={({ pressed }) => [styles.errorCard, pressed && styles.pressed]}
              >
                <AppText variant="body" color={theme.colors.error}>
                  {error}
                </AppText>
                <AppText variant="caption" color={theme.colors.onSurfaceVariant}>
                  {t("common.dismiss")}
                </AppText>
              </Pressable>
            ) : null}

            <Body phase={phase} busy={busy} qrLinks={qrLinks} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Body(props: {
  phase: string;
  busy: boolean;
  qrLinks: ReturnType<typeof useAuthStore.getState>["qrLinks"];
}) {
  const { phase, busy, qrLinks } = props;
  const beginQrLogin = useAuthStore((s) => s.beginQrLogin);
  const usePhoneInstead = useAuthStore((s) => s.usePhoneInstead);
  const submitPhone = useAuthStore((s) => s.submitPhone);
  const submitCode = useAuthStore((s) => s.submitCode);
  const submitPassword = useAuthStore((s) => s.submitPassword);
  const openTelegramHandoff = useAuthStore((s) => s.openTelegramHandoff);
  const boot = useAuthStore((s) => s.boot);

  switch (phase) {
    case "booting":
      return (
        <Card>
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.colors.accent} />
            <AppText variant="body" color={theme.colors.onSurfaceVariant}>
              Connecting to Telegram…
            </AppText>
          </View>
        </Card>
      );
    case "fatal":
      return (
        <Card>
          <ErrorState
            compact
            title="Photogram couldn't start"
            body="The Telegram connection did not open. Your photos and login are untouched."
            retryLabel={t("login.retry")}
            onRetry={() => void boot()}
          />
        </Card>
      );
    case "choose":
      return (
        <Card>
          <AppText variant="title2" accessibilityRole="header">
            Log in with Telegram
          </AppText>
          <AppText variant="body" color={theme.colors.onSurfaceVariant}>
            Use the Telegram account you already have. No password is stored in Photogram.
          </AppText>
          <Button
            label={t("login.continueQr")}
            icon="qr-code-outline"
            onPress={() => void beginQrLogin()}
            disabled={busy}
            loading={busy}
            fullWidth
          />
          <Button
            label={t("login.usePhone")}
            variant="secondary"
            onPress={usePhoneInstead}
            disabled={busy}
            fullWidth
          />
        </Card>
      );
    case "qr":
      return (
        <Card>
          <AppText variant="title2" accessibilityRole="header">
            Confirm on Telegram
          </AppText>
          {qrLinks?.handoffUrl ? (
            <>
              <AppText variant="body" color={theme.colors.onSurfaceVariant}>
                Tap below and confirm in the Telegram app on this phone.
              </AppText>
              <Button
                label={t("login.openTelegram")}
                icon="paper-plane-outline"
                onPress={() => void openTelegramHandoff()}
                disabled={busy}
                fullWidth
              />
            </>
          ) : (
            <AppText variant="body" color={theme.colors.onSurfaceVariant}>
              Open Telegram on another device: Settings → Devices → Link Desktop Device, then scan:
            </AppText>
          )}
          <View
            style={styles.qrBox}
            accessible
            accessibilityRole="image"
            accessibilityLabel="Telegram login QR code"
          >
            {qrLinks ? (
              <QRCode value={qrLinks.qrPayload} size={208} backgroundColor={theme.colors.white} color={theme.colors.black} />
            ) : (
              <ActivityIndicator color={theme.colors.accent} />
            )}
          </View>
          <AppText variant="caption" color={theme.colors.onSurfaceFaint} align="center">
            The code refreshes automatically if it expires.
          </AppText>
          <Button
            label={t("login.usePhone")}
            variant="quiet"
            onPress={usePhoneInstead}
            disabled={busy}
            fullWidth
          />
        </Card>
      );
    case "phone":
      return <PhoneForm busy={busy} onSubmit={(v) => void submitPhone(v)} />;
    case "code":
      return (
        <CodeForm
          busy={busy}
          title="Enter the login code"
          caption="Telegram sent you a code. It arrives inside your existing Telegram app — not by SMS."
          placeholder="5-digit code"
          secure={false}
          onSubmit={(v) => void submitCode(v)}
        />
      );
    case "password":
      return (
        <CodeForm
          busy={busy}
          title="Two-step verification"
          caption="This account has cloud password protection enabled."
          placeholder="Cloud password"
          secure
          onSubmit={(v) => void submitPassword(v)}
        />
      );
    default:
      return null;
  }
}

function PhoneForm({ busy, onSubmit }: { busy: boolean; onSubmit: (v: string) => void }) {
  const [value, setValue] = useState("");
  const [canOpenTg, setCanOpenTg] = useState(false);

  useEffect(() => {
    Linking.canOpenURL("https://telegram.org").then(setCanOpenTg).catch(() => setCanOpenTg(false));
  }, []);

  return (
    <Card>
      <AppText variant="title2" accessibilityRole="header">
        Your phone number
      </AppText>
      <AppText variant="body" color={theme.colors.onSurfaceVariant}>
        Include the country code. The login code arrives inside your Telegram app.
      </AppText>
      <Input
        value={value}
        onChangeText={setValue}
        label="Phone number"
        placeholder="+1 555 123 4567"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
      />
      <Button
        label="Next"
        onPress={() => onSubmit(value)}
        disabled={busy || value.length < 6}
        loading={busy}
        fullWidth
      />
      {canOpenTg ? (
        <Button
          label="Install Telegram first"
          variant="quiet"
          onPress={() =>
            void Linking.openURL(
              "https://play.google.com/store/apps/details?id=org.telegram.messenger"
            )
          }
          fullWidth
        />
      ) : null}
    </Card>
  );
}

function CodeForm(props: {
  busy: boolean;
  title: string;
  caption: string;
  placeholder: string;
  secure: boolean;
  onSubmit: (v: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Card>
      <AppText variant="title2" accessibilityRole="header">
        {props.title}
      </AppText>
      <AppText variant="body" color={theme.colors.onSurfaceVariant}>
        {props.caption}
      </AppText>
      <Input
        value={value}
        onChangeText={setValue}
        label={props.placeholder}
        placeholder={props.placeholder}
        secureTextEntry={props.secure}
        keyboardType={props.secure ? "default" : "number-pad"}
        autoFocus
      />
      <Button
        label="Verify"
        onPress={() => props.onSubmit(value)}
        disabled={props.busy || value.length === 0}
        loading={props.busy}
        fullWidth
      />
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flexGrow: 1, justifyContent: "center", padding: theme.spacing.lg },
  shell: { width: "100%", maxWidth: 440, alignSelf: "center", gap: theme.spacing.lg },
  header: { alignItems: "center", gap: theme.spacing.sm },
  logoGlyph: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.sm,
  },
  logoRing: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    opacity: 0.55,
  },
  logoInner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.colors.accent,
  },
  tagline: { maxWidth: 320 },
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
    gap: theme.spacing.compact,
  },
  errorCard: {
    backgroundColor: theme.colors.errorSoft,
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  pressed: { opacity: 0.85 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.compact },
  qrBox: {
    alignSelf: "center",
    backgroundColor: theme.colors.white,
    padding: theme.spacing.md,
    borderRadius: theme.radius.control,
  },
});
