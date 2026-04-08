const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withAndroidGradlePlugin(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      let gradleContents = config.modResults.contents;
      
      // 1. Add configurations.all exclude block if not present
      const excludeBlock = `
configurations.all {
    exclude group: 'com.android.support', module: 'support-compat'
    exclude group: 'com.android.support', module: 'support-core-utils'
    exclude group: 'com.android.support', module: 'support-core-ui'
    exclude group: 'com.android.support', module: 'support-media-compat'
    exclude group: 'com.android.support', module: 'support-fragment'
    exclude group: 'com.android.support', module: 'support-v4'
}
`;

      if (!gradleContents.includes("group: 'com.android.support', module: 'support-compat'")) {
        gradleContents = gradleContents + excludeBlock;
      }

      // 2. Add packagingOptions inside android block to resolve META-INF conflicts
      const packagingBlock = `
    packagingOptions {
        pickFirst 'META-INF/androidx.appcompat_appcompat.version'
        pickFirst 'META-INF/*'
    }
`;

      // Check if android block exists
      if (gradleContents.includes('android {')) {
        if (gradleContents.includes('packagingOptions {')) {
          gradleContents = gradleContents.replace(
            /packagingOptions\s*\{/,
            "packagingOptions {\n        pickFirst 'META-INF/androidx.appcompat_appcompat.version'\n        pickFirst 'META-INF/*'"
          );
        } else if (gradleContents.includes('packaging {')) {
          gradleContents = gradleContents.replace(
            /packaging\s*\{/,
            "packaging {\n        pickFirst 'META-INF/androidx.appcompat_appcompat.version'\n        pickFirst 'META-INF/*'"
          );
        } else {
          gradleContents = gradleContents.replace(
            /android\s*\{/,
            `android {${packagingBlock}`
          );
        }
      }

      config.modResults.contents = gradleContents;
    }
    return config;
  });
};
