const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// 1. Disable package exports to fix Three.js warnings (and prevent resolution issues)
config.resolver.unstable_enablePackageExports = false;

// 2. Force all 'three' and '@pixiv/three-vrm' imports to resolve to root node_modules
config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    'three': path.resolve(__dirname, 'node_modules/three'),
    '@pixiv/three-vrm': path.resolve(__dirname, 'node_modules/@pixiv/three-vrm'),
};

// 3. Prevent multiple instances by ensuring 'three' and its subpaths resolve to one place
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'three' || moduleName.startsWith('three/')) {
        const rootThree = path.resolve(__dirname, 'node_modules/three');
        if (moduleName === 'three') {
            return context.resolveRequest(context, path.resolve(rootThree, 'build/three.module.js'), platform);
        }
        // Redirect three/examples/jsm/* to actual files
        if (moduleName.startsWith('three/examples/jsm/')) {
            let relativePath = moduleName.replace('three/', '');
            if (!relativePath.endsWith('.js')) {
                relativePath += '.js';
            }
            return context.resolveRequest(context, path.resolve(rootThree, relativePath), platform);
        }
    }
    return originalResolveRequest ? originalResolveRequest(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

// 4. Important: Add asset support and ensure sourceExts includes the defaults plus extras
config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs', 'cjs'];
config.resolver.assetExts = [...config.resolver.assetExts, 'tflite', 'vrm', 'bin', 'json'];

module.exports = config;
