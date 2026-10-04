module.exports = {
  dependency: {
    platforms: {
      android: { packageImportPath: 'import com.pocketly.buildinfo.PocketlyBuildInfoPackage;', packageInstance: 'new PocketlyBuildInfoPackage()' },
      ios: {},
    },
  },
};
