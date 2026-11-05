// @ts-nocheck
// Probe stub for expo-image-manipulator: the crop→resize→save chain returns a
// registered probe file so faces.ts's real jpeg-js decode + preprocessing can
// run against it.
export const SaveFormat = { JPEG: "jpeg", PNG: "png" };

let outputUri = "/probe-docs/crop.jpg";
export function __setCropOutput(uri: string): void {
  outputUri = uri;
}

export const ImageManipulator = {
  manipulate: (_uri: string) => {
    const chain = {
      crop: (_o: unknown) => chain,
      resize: (_o: unknown) => chain,
      rotate: (_o: unknown) => chain,
      renderAsync: async () => ({
        saveAsync: async (_o: unknown) => ({ uri: outputUri }),
      }),
    };
    return chain;
  },
};
