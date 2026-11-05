// @ts-nocheck
// Probe stub for expo-media-library/legacy subpath.
export const MediaType = { photo: "photo", video: "video" };
export const SortBy = { creationTime: "creationTime" };
export const deleteAssetsAsync = async () => {};
export const getAssetInfoAsync = async () => ({});
export const getAssetsAsync = async () => ({ assets: [], endCursor: "", hasNextPage: false, totalCount: 0 });
export const requestPermissionsAsync = async () => ({ granted: true });
export const getPermissionsAsync = async () => ({ granted: true });
