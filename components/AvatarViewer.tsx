import { Buffer } from 'buffer';

const OriginalBlob = global.Blob;
global.Blob = function (this: any, parts: any[], options: any) {
  if (parts && parts.length > 0 && (parts[0] instanceof ArrayBuffer || ArrayBuffer.isView(parts[0]))) {
    const base64 = Buffer.from(parts[0] as any).toString('base64');
    const type = (options && options.type) ? options.type : 'image/png';
    this.dataURI = `data:${type};base64,${base64}`;
    return this;
  }
  return OriginalBlob ? new OriginalBlob(parts, options) : this;
} as any;

const originalCreateObjectURL = global.URL.createObjectURL;
global.URL.createObjectURL = function (blob: any) {
  if (blob && blob.dataURI) {
    return blob.dataURI;
  }
  return originalCreateObjectURL ? originalCreateObjectURL(blob) : '';
};

import React, { useRef, useEffect, useCallback } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMUtils, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { AvatarAnimator } from '../lib/AvatarAnimator';

interface AvatarViewerProps {
    onVRMLoaded?: () => void;
    onError?: (error: Error) => void;
    style?: ViewStyle;
    signToPlay?: string | null;
    letterToPlay?: string | null;
    avatarUri?: string;
}

export default function AvatarViewer({
    onVRMLoaded,
    onError,
    style,
    signToPlay,
    letterToPlay,
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
        try {
            glRef.current = gl;

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
            camera.position.set(0, 1.2, 1.8);
            camera.lookAt(0, 1.0, 0);
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
                    renderer.render(scene, camera);
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
        try {
            // Correctly resolve the local URI for the avatar.vrm model
            const asset = await Asset.fromModule(require('../assets/avatar.vrm')).downloadAsync();
            const uri = asset.localUri || asset.uri;

            if (!uri) {
                throw new Error('Could not resolve VRM asset URI');
            }

            // Read the file from the local device as base64
            const fileBase64 = await FileSystem.readAsStringAsync(uri, {
                encoding: 'base64',
            });

            // Convert base64 to an ArrayBuffer safely avoiding shared pools
            const buf = Buffer.from(fileBase64, 'base64');
            const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

            const vrm = await new Promise<VRM>((resolve, reject) => {
                const loader = new GLTFLoader();
                loader.register((parser: any) => new VRMLoaderPlugin(parser));
                
                loader.parse(
                    arrayBuffer,
                    '',
                    (gltf: any) => {
                        const vrm = gltf.userData.vrm as VRM;
                        VRMUtils.removeUnnecessaryVertices(vrm.scene);
                        resolve(vrm);
                    },
                    (error: any) => reject(error)
                );
            });

            vrmRef.current = vrm;
            scene.add(vrm.scene);

            const animator = new AvatarAnimator();
            animator.setVRM(vrm);
            animatorRef.current = animator;

            console.log('[Avatar] VRM loaded successfully');
            onVRMLoaded?.();
        } catch (error) {
            console.error('Error loading VRM:', error);
            onError?.(error instanceof Error ? error : new Error(String(error)));
        }
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
