import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getAutoAlbums, AutoAlbum } from "../lib/albums";
import { theme } from "../theme";

export function AlbumsScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<{ Album: { key: string; label: string } }>;
}) {
  const insets = useSafeAreaInsets();
  const [albums, setAlbums] = useState<AutoAlbum[] | null>(null);

  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      void getAutoAlbums()
        .then(setAlbums)
        .catch(() => setAlbums([]));
    });
    return unsub;
  }, [navigation]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Albums</Text>
      </View>
      <Text style={styles.note}>Auto-grouped from your library — updated on every scan.</Text>
      {albums === null ? null : (
        <FlashList
          data={albums}
          numColumns={2}
          keyExtractor={(a) => a.key}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => navigation.navigate("Album", { key: item.key, label: item.label })}
            >
              <View style={styles.coverWrap}>
                {item.coverThumb ? (
                  <Image
                    source={{ uri: item.coverThumb }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={150}
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]} />
                )}
              </View>
              <Text style={styles.cardLabel} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={styles.cardCount}>
                {item.count} item{item.count === 1 ? "" : "s"}
              </Text>
            </Pressable>
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.empty}>Nothing scanned yet — scan your library first.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 4,
  },
  back: { color: theme.colors.onSurface, fontSize: 24 },
  title: { color: theme.colors.onSurface, fontSize: 24, fontWeight: "700" },
  note: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12.5,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  listContent: { padding: theme.spacing.sm, paddingBottom: 40 },
  card: { flex: 1, margin: theme.spacing.sm, flexBasis: "45%" },
  coverWrap: {
    aspectRatio: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceHighest,
  },
  coverPlaceholder: { backgroundColor: theme.colors.surfaceHighest },
  cardLabel: {
    color: theme.colors.onSurface,
    fontSize: 15,
    fontWeight: "600",
    marginTop: theme.spacing.sm,
  },
  cardCount: { color: theme.colors.onSurfaceVariant, fontSize: 12.5, marginTop: 2 },
  empty: { color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 60 },
});
