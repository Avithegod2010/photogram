module.exports = {
    dependency: {
        platforms: {
            // iOS metadata is auto-discovered from `react-native-tdlib.podspec`.
            // `sourceDir` is auto-discovered from the `android/` folder.
            // The @react-native-community/cli v20+ schema rejects `podspecPath`
            // and `sourceDir` and silently drops the entire `platforms` map,
            // which breaks autolinking on RN >= 0.78 — so only the
            // packageImportPath/packageInstance pair is declared here.
            ios: {},
            android: {
                packageImportPath: 'import com.reactnativetdlib.tdlibclient.TdLibPackage;',
                packageInstance: 'new TdLibPackage()',
            },
        },
    },
};
