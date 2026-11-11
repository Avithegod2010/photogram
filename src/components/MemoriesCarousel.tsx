import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { Image } from "expo-image";
import { getMemories, type MemoryGroup } from "../lib/memories";
import { theme } from "../theme";
import { AppText, PressableScale } from "../ui";
import { t, tCount, tf } from "../lib/i18n";

const CARD_W = 152;
const CARD_H = 196;

/**
 * The one signature moment on the Gallery: a quiet shelf of past days. Photos
 * do the talking; the label sits on a scrim, not on a card border.
 */
export function MemoriesCarousel({
  onOpen,
}: {
  onOpen: (ids: number[], title: string) => void;
}) {
  const [groups, setGroups] = useState<MemoryGroup[]>([]);

  useEffect(() => {
    void getMemories().then(setGroups);
  }, []);

  if (groups.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <AppText variant="title3" style={styles.heading}>
        {t("memories.title")}
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {groups.map((g) => {
          const date = new Date(g.key + "T00:00:00").toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          const title = g.yearsAgo === 1 ? t("memories.oneYearAgo") : tf("memories.yearsAgo", { count: g.yearsAgo });
          return (
            <PressableScale
              key={g.key}
              onPress={() => onOpen(g.mediaIds, title)}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${date}, ${tCount("gallery.itemsCount", g.count)}`}
              style={styles.card}
              contentStyle={styles.cardContent}
            >
              <Image
                source={{ uri: g.coverThumb }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={`mem-${g.key}`}
                cachePolicy="memory-disk"
                transition={120}
                accessible={false}
              />
              <View style={styles.scrim} />
              <View style={styles.textBlock}>
                <AppText variant="bodyLarge" weight="bold" color={theme.colors.onViewer}>
                  {title}
                </AppText>
                <AppText variant="caption" color={theme.colors.onViewerMuted} numberOfLines={1}>
                  {date} · {tCount("gallery.itemsCount", g.count)}
                </AppText>
              </View>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: theme.spacing.md },
  heading: {
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  row: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: theme.radius.card,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  cardContent: { flex: 1, justifyContent: "flex-end", alignItems: "stretch" },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: CARD_H * 0.45,
    backgroundColor: theme.colors.mediaScrim,
  },
  textBlock: { padding: theme.spacing.sm, gap: 2 },
});
