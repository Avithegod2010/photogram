import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import { AppText } from "./AppText";
import { IconButton } from "./IconButton";
import { easing } from "./motion";
import { t } from "../lib/i18n";

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Long content scrolls inside the sheet and keeps the grabber reachable. */
  scroll?: boolean;
  maxHeight?: `${number}%`;
};

/**
 * One bottom sheet. Slides up over 240ms, drag the handle to dismiss, respects
 * reduced motion and keeps the Android back button working. Focus is trapped by
 * the native Modal; the title is the modal's accessible header.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  scroll = false,
  maxHeight = "88%",
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      dragY.set(0);
      progress.set(
        withTiming(1, {
          duration: reduced ? 0 : theme.motion.duration.slow,
          easing: easing.enter,
        })
      );
    } else if (mounted) {
      progress.set(
        withTiming(
          0,
          { duration: reduced ? 0 : theme.motion.duration.base, easing: easing.exit },
          (finished) => {
            if (finished) scheduleOnRN(setMounted, false);
          }
        )
      );
    }
  }, [visible, mounted, progress, reduced, dragY]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 280 + dragY.get() }],
  }));

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      dragY.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY > 72 || e.velocityY > 900) {
        scheduleOnRN(onClose);
      } else {
        dragY.set(withTiming(0, { duration: theme.motion.duration.base, easing: easing.standard }));
      }
    });

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            style={[StyleSheet.absoluteFill, styles.backdrop]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { maxHeight, paddingBottom: insets.bottom + theme.spacing.lg },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.topRow}>
              <View style={styles.grabberArea}>
                <View style={styles.handle} />
              </View>
            </View>
          </GestureDetector>
          <IconButton
            icon="close"
            label={t("common.close")}
            size={40}
            onPress={onClose}
            style={styles.closeButton}
          />
          <View style={styles.handleArea}>
            {title ? (
              <AppText variant="title3" accessibilityRole="header" numberOfLines={2}>
                {title}
              </AppText>
            ) : null}
            {subtitle ? (
              <AppText
                variant="footnote"
                color={theme.colors.onSurfaceVariant}
                numberOfLines={3}
                style={styles.subtitle}
              >
                {subtitle}
              </AppText>
            ) : null}
          </View>
          <View style={styles.body}>
            {scroll ? (
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scrollContent}
              >
                {children}
              </ScrollView>
            ) : (
              children
            )}
          </View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { backgroundColor: theme.colors.scrim },
  sheet: {
    backgroundColor: theme.colors.surfaceContainer,
    borderTopLeftRadius: theme.radius.sheet,
    borderTopRightRadius: theme.radius.sheet,
    ...theme.elevation.sheet,
  },
  handleArea: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: 0,
    paddingBottom: theme.spacing.compact,
  },
  topRow: {
    height: 40,
    justifyContent: "center",
  },
  grabberArea: {
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  closeButton: { position: "absolute", right: theme.spacing.sm, top: 0 },
  handle: {
    alignSelf: "center",
    width: theme.layout.sheetHandle,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.outlineStrong,
  },
  subtitle: { marginTop: 2 },
  body: { paddingHorizontal: theme.spacing.lg },
  scrollContent: { paddingBottom: theme.spacing.md },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.compact,
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
});
