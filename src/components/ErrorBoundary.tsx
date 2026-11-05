import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

// v0.55 error boundary: a render crash must show an honest, recoverable screen
// instead of a white void (which is indistinguishable from "still loading").
// The message is shown because this is a personal app - no stack traces, no
// file paths, nothing that would leak library contents into a screenshot.

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
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          {this.state.error.message || "The screen failed to render."}
        </Text>
        <Text style={styles.hint}>
          Your photos and backups are untouched. Try again; if it keeps happening, open
          Settings → Self-check and send me what it says.
        </Text>
        <Pressable
          style={styles.button}
          android_ripple={{ color: theme.colors.outlineVariant }}
          onPress={() => this.setState({ error: null })}
          accessibilityRole="button"
          accessibilityLabel="Try rendering the screen again"
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  title: { color: theme.colors.onSurface, fontSize: 20, fontWeight: "700" },
  body: { color: theme.colors.error, fontSize: 14, textAlign: "center" },
  hint: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12.5,
    textAlign: "center",
    marginTop: theme.spacing.sm,
  },
  button: {
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 10,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceHighest,
  },
  buttonText: { color: theme.colors.primary, fontSize: 15, fontWeight: "700" },
});
