import { Buffer } from 'buffer';

const OriginalBlob = global.Blob;
global.Blob = function (this: any, parts: any[], options: any) {
    console.log('[Avatar] Blob requested with parts:', parts?.length, 'options:', options);
    if (parts && parts.length > 0 && (parts[0] instanceof ArrayBuffer || ArrayBuffer.isView(parts[0]))) {
        const type = (options && options.type) ? options.type : 'image/png';
        console.log('[Avatar] Blob is binary type:', type);

        console.log('[Avatar] Blob converting buffer to base64...');
        const base64 = Buffer.from(parts[0] as any).toString('base64');
        this.dataURI = `data:${type};base64,${base64}`;
        console.log('[Avatar] Blob conversion done. Length:', base64.length);
        return this;
    }
    return OriginalBlob ? new OriginalBlob(parts, options) : this;
} as any;

const originalCreateObjectURL = global.URL.createObjectURL;
global.URL.createObjectURL = function (blob: any) {
    if (blob && blob.dataURI) {
        // console.log('[Avatar] createObjectURL returning dataURI...');
        return blob.dataURI;
    }
    return originalCreateObjectURL ? originalCreateObjectURL(blob) : '';
};

// Polyfill ImageLoader to avoid hanging when Three.js tries to use document.createElementNS('img')
// We will modify THREE.ImageLoader after it is imported below.
const originalImageLoaderLoad = function (url: string, onLoad: any, onProgress: any, onError: any) { };

import React, { useRef, useEffect, useCallback } from 'react';
import { StyleSheet, View, ViewStyle, Image } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMUtils, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { AvatarAnimator } from '../lib/AvatarAnimator';
import { SequenceItem } from '../lib/labels';

// Apply Polyfills for all Three.js Loaders to intercept and prevent native execution hangs
['ImageLoader', 'ImageBitmapLoader', 'TextureLoader', 'FileLoader'].forEach((loaderName) => {
    const loaderClass = (THREE as any)[loaderName];
    if (loaderClass && loaderClass.prototype) {
        const origLoad = loaderClass.prototype.load;
        loaderClass.prototype.load = function (url: string, onLoad?: any, onProgress?: any, onError?: any) {
            console.log(`[Avatar] ${loaderName}.load intercepted! URL length:`, url ? url.length : 0);

            // If it's an image load, we intercept it to save dataURIs to physical files
            if (loaderName === 'ImageLoader' || loaderName === 'ImageBitmapLoader' || loaderName === 'TextureLoader') {
                const isTexture = loaderName === 'TextureLoader';
                const result = isTexture ? new THREE.Texture() : {};

                const processImage = async () => {
                    let finalUrl = url;
                    // React Native's bridge drops massive data: URIs causing textures to be black. 
                    // Write the base64 to a physical temp file and load it from disk!
                    if (url && url.startsWith('data:image/')) {
                        const extension = url.includes('image/jpeg') ? '.jpg' : '.png';
                        const filePath = FileSystem.cacheDirectory + 'tex_' + Math.random().toString(36).substring(2) + extension;
                        const base64Data = url.substring(url.indexOf(',') + 1);
                        await FileSystem.writeAsStringAsync(filePath, base64Data, { encoding: 'base64' });
                        finalUrl = filePath;
                        console.log('[Avatar] Texture saved to disk:', filePath);
                    }

                    // Native Three.js WILL FAIL to upload the texture if width and height are undefined!
                    const size = await new Promise<{ width: number, height: number }>((resolve) => {
                        Image.getSize(finalUrl,
                            (width, height) => resolve({ width, height }),
                            () => resolve({ width: 1024, height: 1024 }) // Fallback to 1024x1024 if size extraction fails
                        );
                    });

                    const imageHack = { uri: finalUrl, localUri: finalUrl, width: size.width, height: size.height };
                    if (isTexture) {
                        (result as THREE.Texture).image = imageHack;
                        (result as THREE.Texture).needsUpdate = true;
                    } else {
                        Object.assign(result, imageHack);
                    }

                    console.log(`[Avatar] ${loaderName} loaded texture sizes: ${size.width}x${size.height}`);
                    if (onLoad) onLoad(isTexture ? result : imageHack);
                };

                processImage().catch(err => {
                    console.error('[Avatar] Texture processing failed', err);
                    if (onError) onError(err);
                });

                return (isTexture ? result : { uri: url, localUri: url }) as any;
            }

            // Otherwise, let the original loader handle it
            return origLoad.call(this, url, onLoad, onProgress, onError);
        };
    }
});

interface AvatarViewerProps {
    onVRMLoaded?: () => void;
    onError?: (error: Error) => void;
    style?: ViewStyle;
    signToPlay?: string | null;
    letterToPlay?: string | null;
    sequenceToPlay?: SequenceItem[] | null;
    avatarUri?: string;
}

export default function AvatarViewer({
    onVRMLoaded,
    onError,
    style,
    signToPlay,
    letterToPlay,
    sequenceToPlay,
    avatarUri = './avatar.vrm'
}: AvatarViewerProps) {
    const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const vrmRef = useRef<VRM | null>(null);
    const animatorRef = useRef<AvatarAnimator | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
        console.log('[Avatar] onContextCreate FIRED! GL context acquired.');
        try {
            glRef.current = gl;

            // Prevent native EXGL log spam by intercepting unsupported pixelStorei parameters
            const originalPixelStorei = gl.pixelStorei.bind(gl);
            gl.pixelStorei = function (pname: number, param: any) {
                // Ignore UNPACK_FLIP_Y_WEBGL (37440), UNPACK_PREMULTIPLY_ALPHA_WEBGL (37441), UNPACK_COLORSPACE_CONVERSION_WEBGL (37443)
                if (pname === 37440 || pname === 37441 || pname === 37443 || pname === 3317) {
                    return;
                }
                originalPixelStorei(pname, param);
            };

            // Prevent native Expo GL engine memory corruption crash caused by undefined uniform names
            const originalGetActiveUniform = gl.getActiveUniform.bind(gl);
            gl.getActiveUniform = function (program: WebGLProgram, index: number) {
                const info = originalGetActiveUniform(program, index);
                if (info && info.name === undefined) {
                    // Return a new object because WebGLActiveInfo properties are read-only
                    return { size: info.size, type: info.type, name: '' } as WebGLActiveInfo;
                }
                return info;
            };

            const renderer = new Renderer({ gl });
            renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
            renderer.setClearColor(0x0a0a0a, 1.0);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            rendererRef.current = renderer;

            const scene = new THREE.Scene();
            sceneRef.current = scene;

            const camera = new THREE.PerspectiveCamera(
                45,
                gl.drawingBufferWidth / gl.drawingBufferHeight,
                0.01,
                100
            );
            camera.position.set(0, 1.0, 2.2); // Zoomed out farther so hands stay in frame
            camera.lookAt(0, 1.0, 0); // Looking at the chest level
            cameraRef.current = camera;

            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);

            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(1, 2, 2);
            scene.add(directionalLight);

            const fillLight = new THREE.DirectionalLight(0x00e5ff, 0.3);
            fillLight.position.set(-1, 1, 1);
            scene.add(fillLight);

            await loadVRM(scene);

            const animate = () => {
                animationFrameRef.current = requestAnimationFrame(animate);

                if (animatorRef.current) {
                    animatorRef.current.update();
                }

                if (renderer && scene && camera) {
                    try {
                        renderer.render(scene, camera);
                    } catch (e) {
                        console.error('[Avatar] Render crash:', e);
                    }
                }

                gl.endFrameEXP();
            };
            animate();

        } catch (error) {
            console.error('Error initializing GL context:', error);
            onError?.(error instanceof Error ? error : new Error(String(error)));
        }
    }, [onError]);

    const loadVRM = async (scene: THREE.Scene) => {
        console.log('[Avatar] Starting loadVRM...');
        try {
            console.log('[Avatar] Requiring asset...');
            const asset = await Asset.fromModule(require('../assets/avatar.vrm')).downloadAsync();
            console.log('[Avatar] Asset downloaded successfully.');
            const uri = asset.localUri || asset.uri;

            if (!uri) {
                throw new Error('Could not resolve VRM asset URI');
            }

            console.log('[Avatar] Reading FileSystem...');
            const fileBase64 = await FileSystem.readAsStringAsync(uri, {
                encoding: 'base64',
            });
            console.log('[Avatar] FileSystem read complete, string length:', fileBase64.length);

            const buf = Buffer.from(fileBase64, 'base64');
            const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

            const vrm = await new Promise<VRM>((resolve, reject) => {
                const loader = new GLTFLoader();
                loader.register((parser: any) => new VRMLoaderPlugin(parser));

                console.log('[Avatar] Calling GLTFLoader.parse...');
                loader.parse(
                    arrayBuffer,
                    '',
                    (gltf: any) => {
                        console.log('[Avatar] GLTFLoader.parse successful');
                        const vrm = gltf.userData.vrm as VRM;
                        VRMUtils.removeUnnecessaryVertices(vrm.scene);
                        resolve(vrm);
                    },
                    (error: any) => {
                        console.error('[Avatar] GLTFLoader parse error:', error);
                        reject(error);
                    }
                );
            });

            vrmRef.current = vrm;
            scene.add(vrm.scene);

            const animator = new AvatarAnimator();
            animator.setVRM(vrm);
            animatorRef.current = animator;

            // 🚀 Avatar is visible NOW — notify the UI immediately!
            console.log('[Avatar] VRM loaded. Notifying UI...');
            onVRMLoaded?.();

            // Play any outstanding animation requests
            if (sequenceToPlay && sequenceToPlay.length > 0) animator.playSequence(sequenceToPlay);
            else if (signToPlay) animator.playSignAnimation(signToPlay);
            else if (letterToPlay) animator.playLetterAnimation(letterToPlay);

            // ⬇️ Load GLB animations quietly in the background AFTER avatar is shown
            loadCustomAnimations(animator);

        } catch (error) {
            console.error('Error loading VRM:', error);
            onError?.(error instanceof Error ? error : new Error(String(error)));
        }
    };

    const loadCustomAnimations = async (animator: AvatarAnimator) => {
        const customAnimations = [
            { keyword: 'GOOD MORNING', file: require('../assets/good_morning.glb') },
            { keyword: 'GOOD EVENING', file: require('../assets/good_evening.glb') },
            { keyword: 'GOOD NIGHT', file: require('../assets/good_night.glb') },
            { keyword: 'MAGANDANG UMAGA', file: require('../assets/good_morning.glb') },
            { keyword: 'MAGANDANG GABI', file: require('../assets/good_evening.glb') },

        ];

        console.log(`[Avatar] Background-loading ${customAnimations.length} GLB animations...`);

        for (const anim of customAnimations) {
            try {
                const glbAsset = await Asset.fromModule(anim.file).downloadAsync();
                const glbUri = glbAsset.localUri || glbAsset.uri;
                if (glbUri) {
                    const glbBase64 = await FileSystem.readAsStringAsync(glbUri, { encoding: 'base64' });
                    const glbBuf = Buffer.from(glbBase64, 'base64');
                    const glbArrayBuffer = glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength);

                    const extGLTF: any = await new Promise((resolve, reject) => {
                        const loader = new GLTFLoader();
                        loader.parse(glbArrayBuffer, '', (gltf: any) => resolve(gltf), (err: any) => reject(err));
                    });

                    if (extGLTF.animations && extGLTF.animations.length > 0) {
                        const clip = extGLTF.animations[0];
                        console.log(`[Avatar] BG loaded: [${anim.keyword}] Tracks: ${clip.tracks.length}`);
                        animator.setCustomSignAnimation(anim.keyword, clip);
                    }
                }
            } catch (err) {
                console.warn(`[Avatar] BG load failed for ${anim.keyword}:`, err);
            }
        }
        console.log('[Avatar] All background GLB animations loaded!');
    };

    useEffect(() => {
        if (signToPlay && animatorRef.current && !letterToPlay) {
            animatorRef.current.playSignAnimation(signToPlay);
        }
    }, [signToPlay, letterToPlay]);

    useEffect(() => {
        if (letterToPlay && animatorRef.current && !signToPlay) {
            animatorRef.current.playLetterAnimation(letterToPlay);
        }
    }, [letterToPlay, signToPlay]);

    useEffect(() => {
        if (sequenceToPlay && sequenceToPlay.length > 0 && animatorRef.current) {
            animatorRef.current.playSequence(sequenceToPlay);
        }
    }, [sequenceToPlay]);

    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            animatorRef.current?.dispose();
            rendererRef.current?.dispose();
            if (vrmRef.current) {
                VRMUtils.deepDispose(vrmRef.current.scene);
            }
        };
    }, []);

    return (
        <View style={[styles.container, style]}>
            <GLView
                style={styles.glView}
                onContextCreate={onContextCreate}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        overflow: 'hidden',
    },
    glView: {
        flex: 1,
    },
});
