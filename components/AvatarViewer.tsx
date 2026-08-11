import { Buffer } from 'buffer';

const AVATAR_DEBUG = true;
const debugLog = (...args: unknown[]) => {
    if (AVATAR_DEBUG) console.log(...args);
};

const OriginalBlob = global.Blob;
global.Blob = function (this: any, parts: any[], options: any) {
    debugLog('[Avatar] Blob requested with parts:', parts?.length, 'options:', options);
    if (parts && parts.length > 0 && (parts[0] instanceof ArrayBuffer || ArrayBuffer.isView(parts[0]))) {
        const type = (options && options.type) ? options.type : 'image/png';
        debugLog('[Avatar] Blob is binary type:', type);

        debugLog('[Avatar] Blob converting buffer to base64...');
        const base64 = Buffer.from(parts[0] as any).toString('base64');
        this.dataURI = `data:${type};base64,${base64}`;
        debugLog('[Avatar] Blob conversion done. Length:', base64.length);
        return this;
    }
    return OriginalBlob ? new OriginalBlob(parts, options) : this;
} as any;

const GlobalURL = (global as any).URL ?? ((global as any).URL = {});
const originalCreateObjectURL = GlobalURL.createObjectURL?.bind(GlobalURL);
GlobalURL.createObjectURL = function (blob: any) {
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
import { StyleSheet, View, ViewStyle, Image, InteractionManager } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMUtils, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { AvatarAnimator } from '../lib/AvatarAnimator';
import { SequenceItem } from '../lib/labels';

const AVATAR_TARGET_FRAME_MS = 16;
const ACTIVE_SIGN_PRELOAD_DELAY_MS = 100;
const INACTIVE_SIGN_PRELOAD_DELAY_MS = 1000;
const BACKGROUND_PRELOAD_GAP_MS = 250;

const glbArrayBufferCache = new Map<any, Promise<ArrayBuffer>>();
const animationClipCache = new Map<any, Promise<THREE.AnimationClip | null>>();
const textureFileCache = new Map<string, string>();

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const waitForIdle = () => new Promise<void>(resolve => {
    InteractionManager.runAfterInteractions(() => resolve());
});

const getTextureCacheKey = (dataUrl: string) => {
    return `${dataUrl.length}:${dataUrl.slice(0, 80)}:${dataUrl.slice(-80)}`;
};

const readGlbAssetArrayBuffer = async (uri: string): Promise<ArrayBuffer> => {
    const glbBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    const glbBuf = Buffer.from(glbBase64, 'base64');
    const arrayBuffer = glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.byteLength);

    const header = Buffer.from(arrayBuffer.slice(0, 4)).toString('utf8');
    if (header !== 'glTF') {
        throw new Error(`Invalid GLB asset data. Expected "glTF" header, got "${header}".`);
    }

    return arrayBuffer;
};

const getGlbArrayBuffer = (assetFile: any): Promise<ArrayBuffer> => {
    const cached = glbArrayBufferCache.get(assetFile);
    if (cached) return cached;

    const loadPromise = (async () => {
        const glbAsset = await Asset.fromModule(assetFile).downloadAsync();
        const glbUri = glbAsset.localUri || glbAsset.uri;
        if (!glbUri) throw new Error('Could not resolve GLB asset URI');

        return readGlbAssetArrayBuffer(glbUri);
    })().catch(error => {
        glbArrayBufferCache.delete(assetFile);
        throw error;
    });

    glbArrayBufferCache.set(assetFile, loadPromise);
    return loadPromise;
};

const getAnimationClip = (assetFile: any): Promise<THREE.AnimationClip | null> => {
    const cached = animationClipCache.get(assetFile);
    if (cached) return cached;

    const loadPromise = (async () => {
        const glbArrayBuffer = await getGlbArrayBuffer(assetFile);
        try {
            const gltf: any = await new Promise((resolve, reject) => {
                const loader = new GLTFLoader();
                loader.parse(glbArrayBuffer, '', (parsed: any) => resolve(parsed), (err: any) => reject(err));
            });

            const animations = gltf.animations ?? [];
            const playableAnimations = animations.filter((clip: THREE.AnimationClip) => {
                const clipName = clip.name.toUpperCase();
                return (
                    clip.tracks.length > 0 &&
                    !clipName.startsWith('T-POSE') &&
                    clipName !== 'FACE'
                );
            });
            const selectedClip = playableAnimations.length > 0
                ? playableAnimations[playableAnimations.length - 1]
                : animations.find((clip: THREE.AnimationClip) => clip.tracks.length > 0);

            return selectedClip?.clone() ?? null;
        } finally {
            glbArrayBufferCache.delete(assetFile);
        }
    })().catch(error => {
        animationClipCache.delete(assetFile);
        throw error;
    });

    animationClipCache.set(assetFile, loadPromise);
    return loadPromise;
};

const CUSTOM_ANIMATIONS: Record<string, any> = {
    // Greetings & Phrases
    'GOOD MORNING': require('../assets/magandang_umaga.glb'),
    'MAGANDANG UMAGA': require('../assets/magandang_umaga.glb'),
    'MAGANDA UMAGA': require('../assets/magandang_umaga.glb'),
    'GOOD EVENING': require('../assets/magandang_gabi.glb'),
    'GOOD NIGHT': require('../assets/magandang_gabi.glb'),
    'MAGANDANG GABI': require('../assets/magandang_gabi.glb'),
    'MAGANDANG GABI POH': require('../assets/magandang_gabi.glb'),
    'MAGANDA GABI': require('../assets/magandang_gabi.glb'),
    'GOOD AFTERNOON': require('../assets/magandang_hapon.glb'),
    'GOOD AFTER NOON': require('../assets/magandang_hapon.glb'),
    'MAGANDANG HAPON': require('../assets/magandang_hapon.glb'),
    'MAGANDA HAPON': require('../assets/magandang_hapon.glb'),
    'KUMUSTA': require('../assets/kamusta_ka.glb'),
    'KAMUSTA': require('../assets/kamusta_ka.glb'),
    'HELLO': require('../assets/hello.glb'),
    'HOW ARE YOU': require('../assets/kamusta_ka.glb'),
    'KUMUSTA KA': require('../assets/kamusta_ka.glb'),
    'KAMUSTA KA': require('../assets/kamusta_ka.glb'),
    'IM FINE': require('../assets/mabuti_naman_ako.glb'),
    "I'M FINE": require('../assets/mabuti_naman_ako.glb'),
    'I AM FINE': require('../assets/mabuti_naman_ako.glb'),
    'MABUTI': require('../assets/mabuti_naman_ako.glb'),
    'MABUTI NAMAN AKO': require('../assets/mabuti_naman_ako.glb'),
    'SEE YOU TOMORROW': require('../assets/kita_tayo_bukas.glb'),
    'KITA TAYO BUKAS': require('../assets/kita_tayo_bukas.glb'),
    'NICE TO MEET YOU': require('../assets/ikinaggalak_kitang_makilala.glb'),
    'MASAYA AKONG MAKILALA KA': require('../assets/ikinaggalak_kitang_makilala.glb'),
    'IKINAGAGALAK KITANG MAKILALA': require('../assets/ikinaggalak_kitang_makilala.glb'),
    "YOU'RE WELCOME": require('../assets/walang_anuman.glb'),
    'YOURE WELCOME': require('../assets/walang_anuman.glb'),
    'WALANG ANUMAN': require('../assets/walang_anuman.glb'),
    'WHAT IS YOUR NAME': require('../assets/ano_ang_pangalan_mo.glb'),
    'ANO ANG PANGALAN MO': require('../assets/ano_ang_pangalan_mo.glb'),
    'SORRY': require('../assets/paumanhin.glb'),
    'PAUMANHIN': require('../assets/paumanhin.glb'),
    'PLEASE': require('../assets/pakiusap.glb'),
    'PAKIUSAP': require('../assets/pakiusap.glb'),

    // Responses & Survival
    "DON'T UNDERSTAND": require('../assets/hindi_ko_maintindihan.glb'),
    'DONT UNDERSTAND': require('../assets/hindi_ko_maintindihan.glb'),
    'HINDI NAINTINDIHAN': require('../assets/hindi_ko_maintindihan.glb'),
    'HINDI KO MAINTINDIHAN': require('../assets/hindi_ko_maintindihan.glb'),
    "DON'T KNOW": require('../assets/hindi_ko_alam.glb'),
    'DONT KNOW': require('../assets/hindi_ko_alam.glb'),
    'HINDI ALAM': require('../assets/hindi_ko_alam.glb'),
    'HINDI KO ALAM': require('../assets/hindi_ko_alam.glb'),
    'KNOW': require('../assets/alam.glb'),
    'ALAM': require('../assets/alam.glb'),
    'NO': require('../assets/hindi.glb'),
    'HINDI': require('../assets/hindi.glb'),
    'YES': require('../assets/oo.glb'),
    'OO': require('../assets/oo.glb'),

    // Calendar & Days
    'TODAY': require('../assets/ngayong_araw.glb'),
    'NGAYON': require('../assets/ngayong_araw.glb'),
    'NGAYONG ARAW': require('../assets/ngayong_araw.glb'),
    'TOMORROW': require('../assets/bukas.glb'),
    'BUKAS': require('../assets/bukas.glb'),
    'JANUARY': require('../assets/january.glb'),
    'ENERO': require('../assets/january.glb'),
    'MARCH': require('../assets/march.glb'),
    'MARSO': require('../assets/march.glb'),
    'APRIL': require('../assets/april.glb'),
    'ABRIL': require('../assets/april.glb'),
    'MAY': require('../assets/may.glb'),
    'MAYO': require('../assets/may.glb'),
    'JUNE': require('../assets/june.glb'),
    'HUNYO': require('../assets/june.glb'),
    'JULY': require('../assets/july.glb'),
    'HULYO': require('../assets/july.glb'),
    'AUGUST': require('../assets/august.glb'),
    'AGOSTO': require('../assets/august.glb'),
    'SEPTEMBER': require('../assets/september.glb'),
    'SETYEMBRE': require('../assets/september.glb'),
    'OCTOBER': require('../assets/october.glb'),
    'OKTUBRE': require('../assets/october.glb'),
    'NOVEMBER': require('../assets/november.glb'),
    'NOBYEMBRE': require('../assets/november.glb'),
    'DECEMBER': require('../assets/december.glb'),
    'DISYEMBRE': require('../assets/december.glb'),

    // Numbers
    'FOUR': require('../assets/four.glb'),
    'APAT': require('../assets/four.glb'),
    'FIVE': require('../assets/five.glb'),
    'LIMA': require('../assets/five.glb'),
    'SIX': require('../assets/six.glb'),
    'ANIM': require('../assets/six.glb'),
    'SEVEN': require('../assets/seven.glb'),
    'PITO': require('../assets/seven.glb'),
    'EIGHT': require('../assets/eight.glb'),
    'WALO': require('../assets/eight.glb'),
    'NINE': require('../assets/nine.glb'),
    'SIYAM': require('../assets/nine.glb'),

    // People & Relationships
    'BOY': require('../assets/lalake.glb'),
    'MAN': require('../assets/lalake.glb'),
    'LALAKI': require('../assets/lalake.glb'),
    'LALAKE': require('../assets/lalake.glb'),
    'WOMAN': require('../assets/babae.glb'),
    'GIRL': require('../assets/babae.glb'),
    'BABAE': require('../assets/babae.glb'),
    'BATA': require('../assets/babae.glb'),
    'HARD OF HEARING': require('../assets/mahina_ang_pandinig.glb'),
    'MAHINA PANDINIG': require('../assets/mahina_ang_pandinig.glb'),
    'MAHINA ANG PANDINIG': require('../assets/mahina_ang_pandinig.glb'),
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
    'Q': require('../assets/q.glb'),
    'R': require('../assets/r.glb'),
    'S': require('../assets/s.glb'),
    'T': require('../assets/t.glb'),
    'U': require('../assets/u.glb'),
    'V': require('../assets/v.glb'),
    'W': require('../assets/w.glb'),
    'X': require('../assets/x.glb'),
    'Y': require('../assets/y.glb'),
    'Z': require('../assets/z.glb'),
};

const PRIORITY_SIGN_PRELOADS = [
    'HELLO',
    'GOOD MORNING',
    'GOOD AFTERNOON',
    'GOOD EVENING',
    'HOW ARE YOU',
    'KAMUSTA KA',
    'ANO ANG PANGALAN MO',
    'IM FINE',
    "DON'T KNOW",
    "DON'T UNDERSTAND",
    'KNOW',
    'NO',
];

// Apply Polyfills for all Three.js Loaders to intercept and prevent native execution hangs
['ImageLoader', 'ImageBitmapLoader', 'TextureLoader', 'FileLoader'].forEach((loaderName) => {
    const loaderClass = (THREE as any)[loaderName];
    if (loaderClass && loaderClass.prototype) {
        const origLoad = loaderClass.prototype.load;
        loaderClass.prototype.load = function (url: string, onLoad?: any, onProgress?: any, onError?: any) {
            debugLog(`[Avatar] ${loaderName}.load intercepted! URL length:`, url ? url.length : 0);

            // If it's an image load, we intercept it to save dataURIs to physical files
            if (loaderName === 'ImageLoader' || loaderName === 'ImageBitmapLoader' || loaderName === 'TextureLoader') {
                const isTexture = loaderName === 'TextureLoader';
                const result = isTexture ? new THREE.Texture() : {};

                const processImage = async () => {
                    let finalUrl = url;
                    // React Native's bridge drops massive data: URIs causing textures to be black. 
                    // Write the base64 to a physical temp file and load it from disk!
                    if (url && url.startsWith('data:image/')) {
                        const cacheKey = getTextureCacheKey(url);
                        const cachedPath = textureFileCache.get(cacheKey);
                        if (cachedPath) {
                            finalUrl = cachedPath;
                        } else {
                            const extension = url.includes('image/jpeg') ? '.jpg' : '.png';
                            const filePath = FileSystem.cacheDirectory + 'tex_' + Math.random().toString(36).substring(2) + extension;
                            const base64Data = url.substring(url.indexOf(',') + 1);
                            await FileSystem.writeAsStringAsync(filePath, base64Data, { encoding: 'base64' });
                            textureFileCache.set(cacheKey, filePath);
                            finalUrl = filePath;
                            debugLog('[Avatar] Texture saved to disk:', filePath);
                        }
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

                    debugLog(`[Avatar] ${loaderName} loaded texture sizes: ${size.width}x${size.height}`);
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
    const animationLoadPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
    const animationFrameRef = useRef<number | null>(null);
    const lastRenderTimeRef = useRef(0);
    const activeRef = useRef<boolean>(active);
    const animateRef = useRef<(() => void) | null>(null);
    const playRequestRef = useRef(0);
    const wordPreloadStartedRef = useRef(false);
    const wordPreloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        activeRef.current = active;
        if (active && animateRef.current && !animationFrameRef.current) {
            animateRef.current();
        }
    }, [active]);

    const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
        debugLog('[Avatar] onContextCreate FIRED! GL context acquired.');
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
            renderer.setClearColor(0x000000, 0);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.NoToneMapping;
            renderer.toneMappingExposure = 1.0;
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

            const animate = (timestamp = 0) => {
                if (!activeRef.current) {
                    animationFrameRef.current = null;
                    return;
                }

                animationFrameRef.current = requestAnimationFrame(animate);

                if (timestamp - lastRenderTimeRef.current < AVATAR_TARGET_FRAME_MS) {
                    return;
                }
                lastRenderTimeRef.current = timestamp;

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
        debugLog('[Avatar] Starting loadVRM...');
        try {
            const avatarAssetFile = require('../assets/hello.glb');
            const arrayBuffer = await getGlbArrayBuffer(avatarAssetFile);

            const vrm = await new Promise<any>((resolve, reject) => {
                const loader = new GLTFLoader();
                loader.register((parser: any) => new VRMLoaderPlugin(parser));

                debugLog('[Avatar] Calling GLTFLoader.parse...');
                loader.parse(
                    arrayBuffer,
                    '',
                    (gltf: any) => {
                        debugLog('[Avatar] GLTFLoader.parse successful');
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
                mat.side = THREE.FrontSide;
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
            }).finally(() => {
                glbArrayBufferCache.delete(avatarAssetFile);
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
                debugLog('[AvatarViewer] Sequence finished, notifying parent...');
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
                        debugLog('[Avatar] Automatically registered embedded HELLO animation');
                    }
                });
            }

            // 🚀 Show the avatar IMMEDIATELY — don't wait for GLBs
            debugLog('[Avatar] Avatar loaded. Showing avatar instantly...');
            onVRMLoaded?.();

            const playInitial = async () => {
                if (sequenceToPlay && sequenceToPlay.length > 0) {
                    await playSequenceWhenReady(sequenceToPlay, animator);
                } else if (signToPlay) {
                    await ensureAnimationLoaded(signToPlay, false, animator);
                    animator.playSignAnimation(signToPlay);
                } else if (letterToPlay) {
                    await ensureAnimationLoaded(letterToPlay, true, animator);
                    animator.playLetterAnimation(letterToPlay);
                }
            };
            playInitial().finally(() => preloadPrioritySignAnimations(animator));

        } catch (error) {
            console.error('Error loading avatar:', error);
            onError?.(error instanceof Error ? error : new Error(String(error)));
        }
    };

    const ensureAnimationLoaded = async (keyword: string, isLetter: boolean, animator: AvatarAnimator): Promise<void> => {
        const normalizedKeyword = keyword.toUpperCase();
        const cacheKey = isLetter ? `letter_${normalizedKeyword}` : `sign_${normalizedKeyword}`;
        if (loadedAnimationsRef.current.has(cacheKey)) return;
        const existingLoad = animationLoadPromisesRef.current.get(cacheKey);
        if (existingLoad) return existingLoad;

        const assetFile = isLetter ? CUSTOM_LETTERS[normalizedKeyword] : CUSTOM_ANIMATIONS[normalizedKeyword];
        if (!assetFile) {
            console.warn(`[Avatar] ensureAnimationLoaded: No asset file for key="${normalizedKeyword}" isLetter=${isLetter}`);
            return;
        }

        const loadPromise = (async () => {
            try {
                console.log(`[Avatar] Loading animation for: "${normalizedKeyword}"`);
                const clip = await getAnimationClip(assetFile);
                if (clip) {
                    if (animatorRef.current !== animator) return;
                    const animatorClip = clip.clone();
                    if (isLetter) {
                        animator.setCustomLetterAnimation(normalizedKeyword, animatorClip);
                    } else {
                        animator.setCustomSignAnimation(normalizedKeyword, animatorClip);
                        // Register under all keys in CUSTOM_ANIMATIONS that point to the SAME assetFile
                        for (const [key, file] of Object.entries(CUSTOM_ANIMATIONS)) {
                            if (file === assetFile && key !== normalizedKeyword) {
                                animator.setCustomSignAnimation(key, animatorClip.clone());
                                loadedAnimationsRef.current.add(`sign_${key}`);
                            }
                        }
                    }
                    loadedAnimationsRef.current.add(cacheKey);
                    console.log(`[Avatar] Animation loaded OK for: "${normalizedKeyword}"`);
                } else {
                    console.error(`[Avatar] getAnimationClip returned NULL for: "${normalizedKeyword}" — this will cause fingerspelling!`);
                }
            } catch (err) {
                console.error(`[Avatar] Lazy load FAILED for "${keyword}":`, err);
            } finally {
                animationLoadPromisesRef.current.delete(cacheKey);
            }
        })();

        animationLoadPromisesRef.current.set(cacheKey, loadPromise);
        return loadPromise;
    };

    const loadCustomSignAnimations = async (sequence: SequenceItem[], animator: AvatarAnimator) => {
        const signKeysToLoad = new Set<string>();
        for (const item of sequence) {
            if (item.type === 'sign') {
                const val = item.value.toUpperCase();
                const disp = item.display ? item.display.toUpperCase() : '';
                if (CUSTOM_ANIMATIONS[val]) signKeysToLoad.add(val);
                if (disp && CUSTOM_ANIMATIONS[disp]) signKeysToLoad.add(disp);
            }
        }

        await Promise.all(Array.from(signKeysToLoad).map(sign => ensureAnimationLoaded(sign, false, animator)));
    };

    const loadCustomLetterAnimations = async (sequence: SequenceItem[], animator: AvatarAnimator) => {
        const letters = Array.from(new Set(
            sequence
                .filter(item => item.type === 'letter' && CUSTOM_LETTERS[item.value.toUpperCase()])
                .map(item => item.value.toUpperCase())
        ));

        await Promise.all(letters.map(letter => ensureAnimationLoaded(letter, true, animator)));
    };

    const preloadPrioritySignAnimations = (animator: AvatarAnimator) => {
        if (wordPreloadStartedRef.current) return;
        wordPreloadStartedRef.current = true;

        const delayMs = activeRef.current ? ACTIVE_SIGN_PRELOAD_DELAY_MS : INACTIVE_SIGN_PRELOAD_DELAY_MS;
        wordPreloadTimerRef.current = setTimeout(async () => {
            for (const sign of PRIORITY_SIGN_PRELOADS) {
                if (animatorRef.current !== animator) return;
                await waitForIdle();
                await ensureAnimationLoaded(sign, false, animator);
                await wait(BACKGROUND_PRELOAD_GAP_MS);
            }
        }, delayMs);
    };

    const playSequenceWhenReady = async (sequence: SequenceItem[], animator: AvatarAnimator) => {
        const requestId = ++playRequestRef.current;

        await Promise.all([
            loadCustomSignAnimations(sequence, animator),
            loadCustomLetterAnimations(sequence, animator),
        ]);
        if (requestId !== playRequestRef.current) return;

        animator.playSequence(sequence);
    };

    useEffect(() => {
        if (!signToPlay && !letterToPlay && (!sequenceToPlay || sequenceToPlay.length === 0)) {
            ++playRequestRef.current;
        }
    }, [signToPlay, letterToPlay, sequenceToPlay]);

    useEffect(() => {
        const play = async () => {
            if (signToPlay && animatorRef.current && !letterToPlay) {
                const requestId = ++playRequestRef.current;
                await ensureAnimationLoaded(signToPlay, false, animatorRef.current);
                if (requestId !== playRequestRef.current) return;
                animatorRef.current.playSignAnimation(signToPlay);
            }
        };
        play();
    }, [signToPlay, letterToPlay]);

    useEffect(() => {
        const play = async () => {
            if (letterToPlay && animatorRef.current && !signToPlay) {
                const animator = animatorRef.current;
                const requestId = ++playRequestRef.current;
                await ensureAnimationLoaded(letterToPlay, true, animator);
                if (requestId !== playRequestRef.current || animatorRef.current !== animator) return;
                animator.playLetterAnimation(letterToPlay);
            }
        };
        play();
    }, [letterToPlay, signToPlay]);

    useEffect(() => {
        const play = async () => {
            if (sequenceToPlay && sequenceToPlay.length > 0 && animatorRef.current) {
                await playSequenceWhenReady(sequenceToPlay, animatorRef.current);
            }
        };
        play();
    }, [sequenceToPlay]);

    useEffect(() => {
        return () => {
            activeRef.current = false;
            ++playRequestRef.current;
            if (wordPreloadTimerRef.current) {
                clearTimeout(wordPreloadTimerRef.current);
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            animationLoadPromisesRef.current.clear();
            animatorRef.current?.dispose();
            animatorRef.current = null;
            rendererRef.current?.dispose();
            rendererRef.current = null;
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
            vrmRef.current = null;
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
