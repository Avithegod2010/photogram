import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { theme } from "../theme";
import { AppText } from "./AppText";
import { t } from "../lib/i18n";

export type DialogProps = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  /** A custom body between the message and the actions. */
  children?: React.ReactNode;
};

/**
 * The one confirmation dialog. Replaces system Alert.alert for destructive and
 * multi-choice actions so every decision looks like Photogram, not the OS.
 * OS-level confirmations (permissions, share sheets) stay native.
 */
export function Dialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
  children,
}: DialogProps) {
  const cancel = onCancel ?? onConfirm;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={cancel}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessible={false} />
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            <AppText variant="title2" accessibilityRole="header">
              {title}
            </AppText>
            {message ? (
              <AppText variant="body" color={theme.colors.onSurfaceVariant} style={styles.message}>
                {message}
              </AppText>
            ) : null}
            {children}
          </ScrollView>
          <View style={styles.actions}>
            {cancelLabel ? (
              <Pressable
                onPress={cancel}
                accessibilityRole="button"
                accessibilityLabel={cancelLabel}
                style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              >
                <AppText variant="body" weight="semibold" color={theme.colors.onSurfaceVariant}>
                  {cancelLabel}
                </AppText>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <AppText
                variant="body"
                weight="semibold"
                color={destructive ? theme.colors.error : theme.colors.accent}
              >
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    maxHeight: "85%",
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
    ...theme.elevation.sheet,
  },
  body: { gap: theme.spacing.compact },
  message: { marginTop: -theme.spacing.xs },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    flexWrap: "wrap",
  },
  action: {
    minHeight: theme.layout.touch,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.compact,
    borderRadius: theme.radius.control,
  },
  actionPressed: { backgroundColor: theme.colors.surfaceHover },
});
