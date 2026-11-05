// @ts-nocheck
// Probe stub for react-native-fast-tflite: runSync returns a controllable
// Float32Array so the real embedFace → setFaceEmbedding path can be tested.
let output = new Float32Array(4);

export function __setTfliteOutput(f32: Float32Array): void {
  output = f32;
}

export async function loadTensorflowModel(_source: unknown, _delegates: unknown[]) {
  return {
    inputs: [],
    outputs: [],
    runSync: (inputs: ArrayBuffer[]) => {
      void inputs;
      return [output.slice().buffer];
    },
    run: async (inputs: ArrayBuffer[]) => [output.slice().buffer],
  };
}
