const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAndroidManifestPlugin(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;

    // Add xmlns:tools to the manifest tag
    if (!androidManifest.manifest.$['xmlns:tools']) {
      androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // Add tools:replace="android:appComponentFactory" to the application tag
    // We must also provide the new value to avoid the merger error
    if (androidManifest.manifest.application && androidManifest.manifest.application.length > 0) {
      const app = androidManifest.manifest.application[0];
      app.$['tools:replace'] = 'android:appComponentFactory';
      app.$['android:appComponentFactory'] = 'androidx.core.app.CoreComponentFactory';
    }

    return config;
  });
};
