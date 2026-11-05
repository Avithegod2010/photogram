// @ts-nocheck
// Probe stub for expo-document-picker: the picker never opens in Node; the
// probe calls parseManifest/dryRunImport/applyImport directly.
const DocumentPicker = {
  getDocumentAsync: async () => ({ canceled: true, assets: [] }),
};
export default DocumentPicker;
export const getDocumentAsync = DocumentPicker.getDocumentAsync;
