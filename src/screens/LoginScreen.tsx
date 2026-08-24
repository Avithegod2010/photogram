import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import QRCode from "react-native-qrcode-svg";
import { useAuthStore } from "../auth/authStore";
import { theme } from "../theme";

export function LoginScreen() {
  const {
    phase,
    busy,
    error,
    qrLinks,
    boot,
    beginQrLogin,
    usePhoneInstead,
    submitPhone,
    submitCode,
    submitPassword,
    openTelegramHandoff,
    clearError,
  } = useAuthStore();

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "android" ? undefined : "padding"}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.logoGlyph}>
              <View style={styles.logoInner} />
            </View>
            <Text style={styles.title}>Photogram</Text>
            <Text style={styles.subtitle}>Your photos, backed up to your own Telegram.</Text>
          </View>

          {error ? (
            <Pressable onPress={clearError} style={[styles.card, styles.errorCard]}>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.errorDismiss}>Tap to dismiss</Text>
            </Pressable>
          ) : null}

          <Body phase={phase} busy={busy} qrLinks={qrLinks} />
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
          <ActivityIndicator color={theme.colors.primary} size="large" />
          <Text style={styles.center}>Connecting to Telegram…</Text>
        </Card>
      );
    case "fatal":
      return (
        <Card>
          <Text style={styles.center}>Something went wrong starting Photogram.</Text>
          <PrimaryButton label="Retry" onPress={() => void boot()} />
        </Card>
      );
    case "choose":
      return (
        <Card>
          <Text style={styles.headline}>Log in with Telegram</Text>
          <Text style={styles.body}>
            Use the Telegram account you already have. No passwords are stored in Photogram.
          </Text>
          <PrimaryButton label="Continue with QR" disabled={busy} onPress={() => void beginQrLogin()} />
          <SecondaryButton label="Use phone number instead" disabled={busy} onPress={usePhoneInstead} />
        </Card>
      );
    case "qr":
      return (
        <Card>
          <Text style={styles.headline}>Confirm on Telegram</Text>
          {qrLinks?.handoffUrl ? (
            <>
              <Text style={styles.body}>
                Tap below and confirm in the Telegram app on this phone.
              </Text>
              <PrimaryButton label="Open Telegram" disabled={busy} onPress={() => void openTelegramHandoff()} />
            </>
          ) : (
            <Text style={styles.body}>
              Open Telegram on another device: Settings → Devices → Link Desktop Device, then scan:
            </Text>
          )}
          <View style={styles.qrBox}>
            {qrLinks ? (
              <QRCode value={qrLinks.qrPayload} size={208} backgroundColor="#FFFFFF" color="#101014" />
            ) : (
              <ActivityIndicator color={theme.colors.primary} />
            )}
          </View>
          <Text style={styles.hint}>
            The code refreshes automatically if it expires.
          </Text>
          <SecondaryButton label="Use phone number instead" disabled={busy} onPress={usePhoneInstead} />
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
      <Text style={styles.headline}>Your phone number</Text>
      <Text style={styles.body}>Include the country code. The login code arrives inside your Telegram app.</Text>
      <OutlinedInput
        value={value}
        onChangeText={setValue}
        placeholder="+1 555 123 4567"
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <PrimaryButton label="Next" disabled={busy || value.length < 6} onPress={() => onSubmit(value)} />
      {canOpenTg ? (
        <SecondaryButton label="Install Telegram first" onPress={() => void Linking.openURL("https://play.google.com/store/apps/details?id=org.telegram.messenger")} />
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
      <Text style={styles.headline}>{props.title}</Text>
      <Text style={styles.body}>{props.caption}</Text>
      <OutlinedInput
        value={value}
        onChangeText={setValue}
        placeholder={props.placeholder}
        secureTextEntry={props.secure}
        keyboardType={props.secure ? "default" : "number-pad"}
        autoFocus
      />
      <PrimaryButton label="Verify" disabled={props.busy || value.length === 0} onPress={() => props.onSubmit(value)} />
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function PrimaryButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btnPrimary,
        (disabled || pressed) && styles.btnDisabled,
      ]}
      android_ripple={{ color: theme.colors.onPrimary + "22" }}
    >
      <Text style={[styles.btnPrimaryText, disabled && { opacity: 0.5 }]}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.btnSecondary, pressed && styles.btnPressed]}
      android_ripple={{ color: theme.colors.onSurface + "18" }}
    >
      <Text style={styles.btnSecondaryText}>{label}</Text>
    </Pressable>
  );
}

function OutlinedInput(props: React.ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      {...props}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      placeholderTextColor={theme.colors.onSurfaceVariant + "88"}
      style={[
        styles.input,
        focused && styles.inputFocused,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flexGrow: 1, justifyContent: "center", padding: theme.spacing.lg },
  header: { alignItems: "center", marginBottom: theme.spacing.xl },
  logoGlyph: {
    width: 76,
    height: 76,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primaryContainer,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.md,
  },
  logoInner: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
  },
  title: {
    color: theme.colors.onSurface,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  subtitle: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 14,
    marginTop: theme.spacing.sm,
    textAlign: "center",
  },
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
  },
  errorCard: {
    backgroundColor: theme.colors.errorContainer,
    borderColor: "transparent",
    marginBottom: theme.spacing.md,
  },
  errorText: { color: theme.colors.error, fontSize: 14, lineHeight: 20 },
  errorDismiss: { color: theme.colors.onSurfaceVariant, fontSize: 12, marginTop: 4 },
  headline: { color: theme.colors.onSurface, fontSize: 22, fontWeight: "600" },
  body: { color: theme.colors.onSurfaceVariant, fontSize: 14, lineHeight: 21 },
  hint: { color: theme.colors.onSurfaceVariant, fontSize: 12 },
  center: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: theme.spacing.sm },
  qrBox: {
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
  },
  input: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.outline,
    color: theme.colors.onSurface,
    fontSize: 16,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 14,
  },
  inputFocused: { borderColor: theme.colors.primary, borderWidth: 2 },
  btnPrimary: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnPrimaryText: { color: theme.colors.onPrimary, fontWeight: "700", fontSize: 15 },
  btnDisabled: { opacity: 0.6 },
  btnSecondary: {
    borderRadius: theme.radius.full,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.outline,
  },
  btnSecondaryText: { color: theme.colors.primary, fontWeight: "600", fontSize: 14 },
  btnPressed: { opacity: 0.85 },
});
