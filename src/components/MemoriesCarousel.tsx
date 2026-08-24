import React, { useEffect, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Image } from "expo-image";
import { getMemories, MemoryGroup } from "../lib/memories";
import { theme } from "../theme";

const CARD_W = 148;
const CARD_H = 190;

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
    <Animated.View entering={FadeInDown.duration(350)} style={styles.wrap}>
      <Text style={styles.heading}>Memories</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {groups.map((g) => (
          <Pressable
            key={g.key}
            onPress={() => onOpen(g.mediaIds, `${g.yearsAgo} years ago`)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <Image source={{ uri: g.coverThumb }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={`mem-${g.key}`} />
            <Text style={styles.years}>{g.yearsAgo}y</Text>
            <Text style={styles.meta}>
              {new Date(g.key + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {g.count}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: theme.spacing.md },
  heading: {
    color: theme.colors.onSurface,
    fontSize: 17,
    fontWeight: "700",
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  row: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
    justifyContent: "flex-end",
    padding: theme.spacing.sm,
  },
  pressed: { transform: [{ scale: 0.97 }] },
  years: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    textShadowColor: "#000000CC",
    textShadowRadius: 6,
  },
  meta: { color: "#FFFFFFDD", fontSize: 12, textShadowColor: "#000000AA", textShadowRadius: 4 },
});
