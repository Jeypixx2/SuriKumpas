const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withAndroidGradlePlugin(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      const gradleContents = config.modResults.contents;
      
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

      // Inject the block if it doesn't already exist
      if (!gradleContents.includes("group: 'com.android.support', module: 'support-compat'")) {
        config.modResults.contents = gradleContents + excludeBlock;
      }
    }
    return config;
  });
};
