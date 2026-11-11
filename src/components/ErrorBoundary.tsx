import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { theme } from "../theme";
import { AppText } from "../ui/AppText";

// v0.55 error boundary: a render crash must show an honest, recoverable screen
// instead of a white void (which is indistinguishable from "still loading").
// The message is shown because this is a personal app - no stack traces, no
// file paths, nothing that would leak library contents into a screenshot.
//
// This fallback deliberately avoids Screen/AppBar/Button/Reanimated: it renders
// outside the navigator (no safe-area provider above it) and must still work if
// the crash came from the animation layer itself. Plain Pressable + AppText only.

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Goes to logcat / Metro; the UI stays plain.
    console.warn("[error-boundary]", error?.message ?? "unknown error");
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <View style={styles.iconCircle}>
          <AppText variant="title2" color={theme.colors.error}>
            !
          </AppText>
        </View>
        <AppText variant="title2" align="center" accessibilityRole="header">
          Something went wrong
        </AppText>
        <AppText variant="body" color={theme.colors.onSurfaceVariant} align="center" style={styles.body}>
          {this.state.error.message || "The screen failed to render."}
        </AppText>
        <Pressable
          onPress={() => this.setState({ error: null })}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <AppText variant="body" weight="semibold" color={theme.colors.onAccent}>
            Try again
          </AppText>
        </Pressable>
        <AppText
          variant="captionRegular"
          color={theme.colors.onSurfaceVariant}
          align="center"
          style={styles.hint}
        >
          Your photos and backups are untouched. If this keeps happening, open Settings → Self-check
          and send me what it says.
        </AppText>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.errorSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { maxWidth: 340, marginTop: theme.spacing.xs },
  retry: {
    minHeight: theme.layout.touch,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.accent,
    marginTop: theme.spacing.compact,
  },
  pressed: { opacity: 0.85 },
  hint: { paddingHorizontal: theme.spacing.md, marginTop: theme.spacing.xs },
});
