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

const CUSTOM_ANIMATIONS: Record<string, any> = {
    'GOOD MORNING': require('../assets/good_morning.glb'),
    'GOOD EVENING': require('../assets/good_evening.glb'),
    'GOOD NIGHT': require('../assets/good_night.glb'),
    'MAGANDANG UMAGA': require('../assets/good_morning.glb'),
    'MAGANDANG GABI': require('../assets/good_evening.glb'),
    'HELLO': require('../assets/hello.glb'),
    'HOW ARE YOU': require('../assets/how_are_you.glb'),
    'KUMUSTA KA': require('../assets/how_are_you.glb'),
    'AUNTIE': require('../assets/auntie.glb'),
    'TITA': require('../assets/auntie.glb'),
    'IM FINE': require('../assets/im_fine.glb'),
    "I'M FINE": require('../assets/im_fine.glb'),
    'MABUTI': require('../assets/im_fine.glb'),
    'THANK YOU': require('../assets/thank_you.glb'),
    'SALAMAT': require('../assets/thank_you.glb'),
};

const CUSTOM_LETTERS: Record<string, any> = {
    'A': require('../assets/a.glb'),
    'B': require('../assets/b.glb'),
    'C': require('../assets/c.glb'),
    'D': require('../assets/d.glb'),
    'E': require('../assets/e.glb'),
    'F': require('../assets/f.glb'),
    'G': require('../assets/g.glb'),
    'H': require('../assets/h.glb'),
    'I': require('../assets/i.glb'),
    'J': require('../assets/j.glb'),
    'K': require('../assets/k.glb'),
    'L': require('../assets/l.glb'),
    'M': require('../assets/m.glb'),
    'N': require('../assets/n.glb'),
    'O': require('../assets/o.glb'),
    'P': require('../assets/p.glb'),
};

const sharedLoader = new GLTFLoader();

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
    onSequenceEnd?: () => void;
    active?: boolean;
}

export default function AvatarViewer({
    onVRMLoaded,
    onError,
    style,
    signToPlay,
    letterToPlay,
    sequenceToPlay,
    onSequenceEnd,
    avatarUri = './avatar3.vrm',
    active = true
}: AvatarViewerProps) {
    const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const vrmRef = useRef<VRM | null>(null);
    const animatorRef = useRef<AvatarAnimator | null>(null);
    const loadedAnimationsRef = useRef<Set<string>>(new Set());
    const animationFrameRef = useRef<number | null>(null);
    const activeRef = useRef<boolean>(active);
    const animateRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        activeRef.current = active;
        if (active && animateRef.current && !animationFrameRef.current) {
            console.log('[AvatarViewer] Restarting animation loop...');
            animateRef.current();
        }
    }, [active]);

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

            // The alpha parameter ensures the WebGL context is transparent
            const renderer = new Renderer({ gl, alpha: true } as any);
renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
renderer.setClearColor(0x000000, 0); // Transparent WebGL background!
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // ← ADD
renderer.toneMappingExposure = 1.2;                    // ← ADD
rendererRef.current = renderer;

            const scene = new THREE.Scene();
            sceneRef.current = scene;

            const camera = new THREE.PerspectiveCamera(
                45,
                gl.drawingBufferWidth / gl.drawingBufferHeight,
                0.01,
                100
            );
            camera.position.set(0, 1.35, 1.4); // Zoomed in closer to make signs bigger
            camera.lookAt(0, 1.35, 0); // Focus on the upper chest
            cameraRef.current = camera;

            const ambientLight = new THREE.AmbientLight(0xffffff, 1.2); // Boosted ambient light for standard glTF
            scene.add(ambientLight);

            const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); // Boosted main light
            directionalLight.position.set(1, 2, 1.5);
            scene.add(directionalLight);

            // Replaced ghostly cyan side light with soft warm fill light
            const fillLight = new THREE.DirectionalLight(0xfffaed, 0.4);
            fillLight.position.set(-1, 1, 1);
            scene.add(fillLight);

            await loadVRM(scene);

            const animate = () => {
                if (!activeRef.current) {
                    console.log('[AvatarViewer] Stopping animation loop...');
                    animationFrameRef.current = null;
                    return;
                }

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
            
            animateRef.current = animate;

            // 🚀 Force shader compilation immediately even if hidden, so it appears instantly later
            try {
                if (renderer && scene && camera) {
                    renderer.render(scene, camera);
                    gl.endFrameEXP();
                }
            } catch (e) {
                console.error('[Avatar] Initial render crash:', e);
            }

            // Start loop if active
            if (activeRef.current) {
                animate();
            }

        } catch (error) {
            console.error('Error initializing GL context:', error);
            onError?.(error instanceof Error ? error : new Error(String(error)));
        }
    }, [onError, active, signToPlay, letterToPlay, sequenceToPlay]);

    const loadVRM = async (scene: THREE.Scene) => {
        console.log('[Avatar] Starting loadVRM...');
        try {
            console.log('[Avatar] Requiring hello.glb asset...');
            const asset = await Asset.fromModule(require('../assets/hello.glb')).downloadAsync();
            console.log('[Avatar] Asset downloaded successfully.');
            const uri = asset.localUri || asset.uri;

            if (!uri) {
                throw new Error('Could not resolve GLB asset URI');
            }

            console.log('[Avatar] Reading FileSystem...');
            const fileBase64 = await FileSystem.readAsStringAsync(uri, {
                encoding: 'base64',
            });
            console.log('[Avatar] FileSystem read complete, string length:', fileBase64.length);

            const buf = Buffer.from(fileBase64, 'base64');
            const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

            const vrm = await new Promise<any>((resolve, reject) => {
                const loader = new GLTFLoader();
                loader.register((parser: any) => new VRMLoaderPlugin(parser));

                console.log('[Avatar] Calling GLTFLoader.parse...');
                loader.parse(
                    arrayBuffer,
                    '',
                    (gltf: any) => {
                        console.log('[Avatar] GLTFLoader.parse successful');
                        let parsedVrm = gltf.userData.vrm;
                        const isStandardGltf = !parsedVrm;
                        if (!parsedVrm) {
                            // Standard GLTF/GLB avatar model fallback
                            parsedVrm = gltf;
                        }
                        // Disable frustum culling and optimize materials/double-sided rendering
                        parsedVrm.scene.traverse((obj: any) => {
    if (obj.isMesh) {
        obj.frustumCulled = false;
        
        if (isStandardGltf && obj.material) {
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            materials.forEach((mat: any) => {
                if (mat.isMeshStandardMaterial) {
                    mat.metalness = 0.0;
                    mat.roughness = 0.8;
                }
                mat.side = THREE.DoubleSide;
                if (mat.map) {
                    mat.map.colorSpace = THREE.SRGBColorSpace;
                }
                if (mat.emissiveMap) {                          // ← ADD
                    mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;  // ← ADD
                }
            });
        }
    }
});
                        resolve(parsedVrm);
                    },
                    (error: any) => {
                        console.error('[Avatar] GLTFLoader parse error:', error);
                        reject(error);
                    }
                );
            });

            vrmRef.current = vrm;
            if (vrm.humanoid) {
                vrm.scene.rotation.y = Math.PI; // Face the camera for VRM
            } else {
                vrm.scene.rotation.y = 0; // Face the camera for standard GLTF
            }
            scene.add(vrm.scene);

            const animator = new AvatarAnimator();
            animator.setOnSequenceEnd(() => {
                console.log('[AvatarViewer] Sequence finished, notifying parent...');
                if (onSequenceEnd) onSequenceEnd();
            });
            animator.setVRM(vrm);
            animatorRef.current = animator;

            // Automatically import any animations embedded inside the main avatar model itself
            if (vrm.animations && vrm.animations.length > 0) {
                vrm.animations.forEach((clip: THREE.AnimationClip) => {
                    const clipName = clip.name.toUpperCase();
                    if (clipName === 'ARMATUREACTION' || clipName === 'HELLO') {
                        animator.setCustomSignAnimation('HELLO', clip);
                        loadedAnimationsRef.current.add('sign_HELLO');
                        console.log('[Avatar] Automatically registered embedded HELLO animation');
                    }
                });
            }

            // 🚀 Show the avatar IMMEDIATELY — don't wait for GLBs
            console.log('[Avatar] Avatar loaded. Showing avatar instantly...');
            onVRMLoaded?.();

            const playInitial = async () => {
                if (sequenceToPlay && sequenceToPlay.length > 0) {
                    for (const item of sequenceToPlay) {
                        await ensureAnimationLoaded(item.value, item.type === 'letter', animator);
                    }
                    animator.playSequence(sequenceToPlay);
                } else if (signToPlay) {
                    await ensureAnimationLoaded(signToPlay, false, animator);
                    animator.playSignAnimation(signToPlay);
                } else if (letterToPlay) {
                    await ensureAnimationLoaded(letterToPlay, true, animator);
                    animator.playLetterAnimation(letterToPlay);
                }
            };
            playInitial();

        } catch (error) {
            console.error('Error loading avatar:', error);
            onError?.(error instanceof Error ? error : new Error(String(error)));
        }
    };

    const ensureAnimationLoaded = async (keyword: string, isLetter: boolean, animator: AvatarAnimator) => {
        const cacheKey = isLetter ? `letter_${keyword}` : `sign_${keyword}`;
        if (loadedAnimationsRef.current.has(cacheKey)) return;

        const assetFile = isLetter ? CUSTOM_LETTERS[keyword.toUpperCase()] : CUSTOM_ANIMATIONS[keyword.toUpperCase()];
        if (!assetFile) return;

        try {
            const glbAsset = await Asset.fromModule(assetFile).downloadAsync();
            const glbUri = glbAsset.localUri || glbAsset.uri;
            if (glbUri) {
                // React Native's fetch() often fails silently on local file:// URIs, 
                // returning an empty blob. We revert strictly to FileSystem read.
                const glbBase64 = await FileSystem.readAsStringAsync(glbUri, { encoding: 'base64' });
                const glbBuf = Buffer.from(glbBase64, 'base64');
                const glbArrayBuffer = glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength);

                const extGLTF: any = await new Promise((resolve, reject) => {
                    sharedLoader.parse(glbArrayBuffer, '', (gltf: any) => resolve(gltf), (err: any) => reject(err));
                });

                if (extGLTF.animations && extGLTF.animations.length > 0) {
                    const clip = extGLTF.animations[0];
                    if (isLetter) {
                        animator.setCustomLetterAnimation(keyword, clip);
                    } else {
                        animator.setCustomSignAnimation(keyword, clip);
                    }
                    loadedAnimationsRef.current.add(cacheKey);
                }
            }
        } catch (err) {
            console.warn(`[Avatar] Lazy load failed for ${keyword}:`, err);
        }
    };

    useEffect(() => {
        const play = async () => {
            if (signToPlay && animatorRef.current && !letterToPlay) {
                await ensureAnimationLoaded(signToPlay, false, animatorRef.current);
                animatorRef.current.playSignAnimation(signToPlay);
            }
        };
        play();
    }, [signToPlay, letterToPlay]);

    useEffect(() => {
        const play = async () => {
            if (letterToPlay && animatorRef.current && !signToPlay) {
                await ensureAnimationLoaded(letterToPlay, true, animatorRef.current);
                animatorRef.current.playLetterAnimation(letterToPlay);
            }
        };
        play();
    }, [letterToPlay, signToPlay]);

    useEffect(() => {
        const play = async () => {
            if (sequenceToPlay && sequenceToPlay.length > 0 && animatorRef.current) {
                for (const item of sequenceToPlay) {
                    await ensureAnimationLoaded(item.value, item.type === 'letter', animatorRef.current);
                }
                animatorRef.current.playSequence(sequenceToPlay);
            }
        };
        play();
    }, [sequenceToPlay]);

    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            animatorRef.current?.dispose();
            rendererRef.current?.dispose();
            if (vrmRef.current) {
                if ((vrmRef.current as any).humanoid) {
                    VRMUtils.deepDispose(vrmRef.current.scene);
                } else {
                    // Standard GLTF resources disposal
                    vrmRef.current.scene.traverse((obj: any) => {
                        if (obj.geometry) {
                            obj.geometry.dispose();
                        }
                        if (obj.material) {
                            if (Array.isArray(obj.material)) {
                                obj.material.forEach((m: any) => m.dispose());
                            } else {
                                obj.material.dispose();
                            }
                        }
                    });
                }
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
