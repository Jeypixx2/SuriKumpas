import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import { globalClassifier } from '../lib/SignClassifier';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

const CAMERA_DEBUG = false;
const debugLog = (...args: unknown[]) => {
    if (CAMERA_DEBUG) console.log(...args);
};

interface CameraProcessorProps {
    onKeypointsExtracted?: (keypoints: Float32Array | 'hands-detected' | 'no-hands') => void;
    onHandLandmarksExtracted?: (landmarks: Float32Array, timestamp: number) => void;
    onNoHandDetected?: (timestamp: number) => void;
    onSignDetected?: (label: string) => void;
    onPerformance?: (metrics: CameraPerformanceMetrics) => void;
    onReady?: () => void;
    onError?: (message: string) => void;
    style?: any;
    active?: boolean;
    recognitionMode?: 'alphabet' | 'word';
}

export interface CameraPerformanceMetrics {
    mode: 'alphabet' | 'word';
    processedFps: number;
    averageMediaPipeMs: number;
    bridgeBatchSize: number;
    bridgeMs?: number;
}

export interface CameraProcessorRef {
    captureFrame: () => void;
}

const MEDIAPIPE_SCRIPT = `
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js" crossorigin="anonymous"></script>
    <script>
        let videoElement = null;
        let canvasElement = null;
        let canvasCtx = null;
        let poseTracker = null;
        let handsTracker = null;
        let latestPoseResults = null;
        let latestHandsResults = null;
        let wordProcessedFrameCount = 0;
        let alphabetProcessedFrameCount = 0;
        let wordKeypointBatch = [];
        let wordInputCanvas = null;
        let wordInputCtx = null;
        let isProcessing = false;
        let recognitionMode = 'alphabet';
        let lastAlphabetSignalAt = 0;
        let lastCanvasDrawAt = 0;
        const ALPHABET_SIGNAL_INTERVAL_MS = 66;
        const WORD_BRIDGE_BATCH_SIZE = 1;
        const WORD_INPUT_WIDTH = 192;
        const WORD_INPUT_HEIGHT = 144;
        const WORD_POSE_REFRESH_INTERVAL = 3;
        let performanceWindowStartedAt = performance.now();
        let performanceFrameCount = 0;
        let performanceTotalProcessingMs = 0;

        window.setRecognitionMode = function(mode) {
            const nextMode = mode === 'word' ? 'word' : 'alphabet';
            if (nextMode !== recognitionMode) {
                wordKeypointBatch = [];
                latestPoseResults = null;
                wordProcessedFrameCount = 0;
                alphabetProcessedFrameCount = 0;
                performanceWindowStartedAt = performance.now();
                performanceFrameCount = 0;
                performanceTotalProcessingMs = 0;
            }
            recognitionMode = nextMode;
        };

        window.onerror = function(msg) {
            if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: 'Error: ' + msg }));
            }
            return true;
        };

        function log(msg) {
            if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: String(msg) }));
            }
        }

        function r(n) { return Math.round(n * 10000) / 10000; }

        function bytesToBase64(bytes) {
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                let chunkString = '';
                for (let j = 0; j < chunk.length; j++) {
                    chunkString += String.fromCharCode(chunk[j]);
                }
                binary += chunkString;
            }
            return btoa(binary);
        }

        function extractKeypoints(results) {
            const kp = [];
            
            // The word model only consumes pose + hands. Do not send the 1,404
            // unused face values over the WebView bridge on every frame.
            // === MUST match SignClassifier.ts order exactly ===
            // 1. Pose: 33 * 4 = 132 values
            const pose = results.poseLandmarks || [];
            for (let i = 0; i < 33; i++) {
                if (i < pose.length) { const lm = pose[i]; kp.push(r(lm.x), r(lm.y), r(lm.z), r(lm.visibility ?? 1)); }
                else { kp.push(0, 0, 0, 0); }
            }
            
            // 2. Left hand: 21 * 3 = 63 values
            const lh = results.leftHandLandmarks || [];
            for (let i = 0; i < 21; i++) {
                if (i < lh.length) { const lm = lh[i]; kp.push(r(lm.x), r(lm.y), r(lm.z)); }
                else { kp.push(0, 0, 0); }
            }
            
            // 3. Right hand: 21 * 3 = 63 values
            const rh = results.rightHandLandmarks || [];
            for (let i = 0; i < 21; i++) {
                if (i < rh.length) { const lm = rh[i]; kp.push(r(lm.x), r(lm.y), r(lm.z)); }
                else { kp.push(0, 0, 0); }
            }
            
            return kp;
        }
        
        function onResults(results) {
            const hasHands = !!(
                (results.leftHandLandmarks && results.leftHandLandmarks.length) ||
                (results.rightHandLandmarks && results.rightHandLandmarks.length)
            );

            const resultTime = Date.now();
            const shouldDraw = recognitionMode !== 'word' || !hasHands ||
                resultTime - lastCanvasDrawAt >= 66;
            if (shouldDraw) {
                lastCanvasDrawAt = resultTime;
                canvasCtx.save();
                canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

                // Keep the visual overlay near 15 FPS in word mode. Landmark
                // extraction continues at full speed for recognition.
                if (results.leftHandLandmarks) {
                    drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS, {color: '#00FFCC', lineWidth: 1.5});
                    drawLandmarks(canvasCtx, results.leftHandLandmarks, {color: '#ffffff', lineWidth: 1, radius: 2});
                }
                if (results.rightHandLandmarks) {
                    drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS, {color: '#00FFCC', lineWidth: 1.5});
                    drawLandmarks(canvasCtx, results.rightHandLandmarks, {color: '#ffffff', lineWidth: 1, radius: 2});
                }

                canvasCtx.restore();
            }

            // Alphabet landmark mode: send 21 3D coordinates (63 floats) throttled to ~15 FPS
            if (recognitionMode === 'alphabet') {
                const now = Date.now();
                if (now - lastAlphabetSignalAt >= ALPHABET_SIGNAL_INTERVAL_MS) {
                    lastAlphabetSignalAt = now;
                    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                        const hand = results.multiHandLandmarks[0];
                        const landmarks = [];
                        for (let i = 0; i < 21; i++) {
                            landmarks.push(hand[i].x, hand[i].y, hand[i].z);
                        }
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'hand-landmarks',
                            landmarks: landmarks,
                            timestamp: now
                        }));
                    } else {
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'no-hand',
                            timestamp: now
                        }));
                    }
                }
                return;
            }

            const keypoints = new Float32Array(extractKeypoints(results));
            wordKeypointBatch.push({
                handsDetected: hasHands,
                data: bytesToBase64(new Uint8Array(keypoints.buffer))
            });

            // Send each compact 1,032-byte frame immediately. Waiting for a
            // second frame adds visible delay at the lower FPS seen on phones.
            if (wordKeypointBatch.length >= WORD_BRIDGE_BATCH_SIZE) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'word-keypoints-batch',
                    frames: wordKeypointBatch,
                    sentAt: Date.now()
                }));
                wordKeypointBatch = [];
            }
        }

        function recordPerformance(processingMs) {
            performanceFrameCount += 1;
            performanceTotalProcessingMs += processingMs;

            const now = performance.now();
            const elapsedMs = now - performanceWindowStartedAt;
            if (elapsedMs < 2000) return;

            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'performance',
                mode: recognitionMode,
                processedFps: performanceFrameCount * 1000 / elapsedMs,
                averageMediaPipeMs: performanceTotalProcessingMs / performanceFrameCount,
                bridgeBatchSize: recognitionMode === 'word' ? WORD_BRIDGE_BATCH_SIZE : 1,
                sentAt: Date.now()
            }));
            performanceWindowStartedAt = now;
            performanceFrameCount = 0;
            performanceTotalProcessingMs = 0;
        }

        function onHandsResults(results) {
            latestHandsResults = results;
        }

        function onPoseResults(results) {
            latestPoseResults = results;
        }

        function isFalseFaceHand(handLandmarks, poseLandmarks) {
            if (!handLandmarks || handLandmarks.length < 21) return false;
            if (!poseLandmarks || poseLandmarks.length < 17) return false;

            const nose = poseLandmarks[0];
            const leftShoulder = poseLandmarks[11];
            const rightShoulder = poseLandmarks[12];
            const leftWrist = poseLandmarks[15];
            const rightWrist = poseLandmarks[16];

            if (!nose || !leftShoulder || !rightShoulder) return false;
            if (nose.visibility !== undefined && nose.visibility < 0.35) return false;

            const handWrist = handLandmarks[0];
            if (!handWrist) return false;

            // Compute head/face boundary zone based on nose & shoulders
            const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
            const shoulderSpan = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y);
            const faceRadius = Math.max(shoulderSpan * 0.45, 0.15);

            const distToNose = Math.hypot(handWrist.x - nose.x, handWrist.y - nose.y);
            const isInFaceZone = distToNose < faceRadius || (handWrist.y < shoulderY && Math.abs(handWrist.x - nose.x) < faceRadius * 0.85);

            if (!isInFaceZone) {
                // Hand wrist is outside face/head area - genuine hand
                return false;
            }

            // Hand wrist IS within the face/head zone.
            // A genuine hand on the face requires an arm physically raised to the face.
            // Check if either pose wrist is near the hand wrist OR elevated near shoulder level.
            let armRaisedToHand = false;

            if (leftWrist && (leftWrist.visibility === undefined || leftWrist.visibility > 0.25)) {
                const distToLeft = Math.hypot(handWrist.x - leftWrist.x, handWrist.y - leftWrist.y);
                if (distToLeft < 0.22 || leftWrist.y < shoulderY + 0.08) {
                    armRaisedToHand = true;
                }
            }

            if (rightWrist && (rightWrist.visibility === undefined || rightWrist.visibility > 0.25)) {
                const distToRight = Math.hypot(handWrist.x - rightWrist.x, handWrist.y - rightWrist.y);
                if (distToRight < 0.22 || rightWrist.y < shoulderY + 0.08) {
                    armRaisedToHand = true;
                }
            }

            // If hand wrist is positioned on the face, but neither arm wrist is raised,
            // this is a phantom hand hallucinated by MediaPipe on facial contours.
            return !armRaisedToHand;
        }

        function emitCombinedResults(poseLandmarks = []) {
            const rawHandLandmarks = latestHandsResults?.multiHandLandmarks || [];
            const rawHandedness = latestHandsResults?.multiHandedness || [];
            
            // Filter out phantom hand landmarks appearing over face when hands are down
            const handLandmarks = [];
            const handedness = [];
            for (let i = 0; i < rawHandLandmarks.length; i++) {
                if (!isFalseFaceHand(rawHandLandmarks[i], poseLandmarks)) {
                    handLandmarks.push(rawHandLandmarks[i]);
                    handedness.push(rawHandedness[i]);
                }
            }

            let leftHandLandmarks = [];
            let rightHandLandmarks = [];

            for (let index = 0; index < handLandmarks.length; index++) {
                const landmarks = handLandmarks[index];
                const handednessEntry = handedness[index];
                const label = handednessEntry?.label || handednessEntry?.[0]?.label;

                // MediaPipe Hands labels assume a mirrored selfie image. The
                // camera pixels are not mirrored (only the display CSS is), so
                // swap the reported labels to preserve the word model's LH/RH order.
                if (label === 'Left') {
                    rightHandLandmarks = landmarks;
                } else if (label === 'Right') {
                    leftHandLandmarks = landmarks;
                } else if ((landmarks[0]?.x ?? 0.5) < 0.5) {
                    rightHandLandmarks = landmarks;
                } else {
                    leftHandLandmarks = landmarks;
                }
            }

            onResults({
                poseLandmarks,
                leftHandLandmarks,
                rightHandLandmarks,
                multiHandLandmarks: handLandmarks
            });
        }
        
        async function initLandmarkers() {
            try {
                log('Initializing...');
                videoElement = document.getElementById('input_video');
                canvasElement = document.getElementById('output_canvas');
                canvasCtx = canvasElement.getContext('2d');

                wordInputCanvas = document.createElement('canvas');
                wordInputCanvas.width = WORD_INPUT_WIDTH;
                wordInputCanvas.height = WORD_INPUT_HEIGHT;
                wordInputCtx = wordInputCanvas.getContext('2d', { alpha: false });
                wordInputCtx.imageSmoothingEnabled = true;
                wordInputCtx.imageSmoothingQuality = 'medium';

                poseTracker = new Pose({ locateFile: (file) => 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + file });
                poseTracker.setOptions({
                    modelComplexity: 0,
                    selfieMode: false,
                    smoothLandmarks: true,
                    enableSegmentation: false,
                    smoothSegmentation: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                poseTracker.onResults(onPoseResults);

                handsTracker = new Hands({ locateFile: (file) => 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + file });
                handsTracker.setOptions({
                    maxNumHands: 2,
                    modelComplexity: 0,
                    minDetectionConfidence: 0.72,
                    minTrackingConfidence: 0.65
                });
                handsTracker.onResults(onHandsResults);

                // Request front camera explicitly
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width: 320,
                        height: 240,
                        frameRate: { ideal: 30, max: 30 }
                    },
                    audio: false
                });
                videoElement.srcObject = stream;
                await videoElement.play();
                log('Front camera ready');

                // 30fps target for real-time word recognition windows.
                window.isTicking = false;
                async function tick() {
                    if (!window.isTicking) return;

                    const now = Date.now();
                    if (!isProcessing && (!window.lastTick || now - window.lastTick > 33)) {
                        isProcessing = true;
                        window.lastTick = now;
                        const processingStartedAt = performance.now();
                        let processedFrame = false;
                        try {
                            latestHandsResults = null;
                            if (recognitionMode === 'word') {
                                wordInputCtx.drawImage(
                                    videoElement,
                                    0,
                                    0,
                                    WORD_INPUT_WIDTH,
                                    WORD_INPUT_HEIGHT
                                );
                                wordProcessedFrameCount += 1;

                                // Body pose changes much more slowly than hand
                                // shape. Refresh it periodically and spend the
                                // saved work tracking hands each time.
                                if (
                                    !latestPoseResults ||
                                    wordProcessedFrameCount % WORD_POSE_REFRESH_INTERVAL === 1
                                ) {
                                    await poseTracker.send({ image: wordInputCanvas });
                                }
                                await handsTracker.send({ image: wordInputCanvas });
                                emitCombinedResults(latestPoseResults?.poseLandmarks || []);
                            } else {
                                alphabetProcessedFrameCount += 1;
                                if (!latestPoseResults || alphabetProcessedFrameCount % 15 === 1) {
                                    await poseTracker.send({ image: videoElement });
                                }
                                await handsTracker.send({ image: videoElement });
                                emitCombinedResults(latestPoseResults?.poseLandmarks || []);
                            }
                            processedFrame = true;
                        }
                        catch(e) { log('Send error: ' + e.message); }
                        finally {
                            if (processedFrame) {
                                recordPerformance(performance.now() - processingStartedAt);
                            }
                            isProcessing = false;
                        }
                    }
                    requestAnimationFrame(tick);
                }

                window.startTick = function() {
                    if (!window.isTicking) {
                        window.isTicking = true;
                        tick();
                    }
                };
                window.stopTick = function() {
                    window.isTicking = false;
                };

                // Signal ready
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));

            } catch(e) {
                log('Init failed: ' + e.toString());
            }
        }
        
        window.addEventListener('DOMContentLoaded', initLandmarkers);
    </script>
`;

const CameraProcessor = forwardRef<CameraProcessorRef, CameraProcessorProps>(
    ({
        onKeypointsExtracted,
        onHandLandmarksExtracted,
        onNoHandDetected,
        onSignDetected,
        onPerformance,
        onReady,
        onError,
        style,
        active = true,
        recognitionMode = 'alphabet',
    }, ref) => {
        const [permission, requestPermission] = useCameraPermissions();
        const [isWebViewReady, setIsWebViewReady] = useState(false);
        const webViewRef = useRef<WebView>(null);
        const lastBridgeMsRef = useRef<number | undefined>(undefined);
        const WebViewWithAndroidPermissions = WebView as React.ComponentType<any>;

        useImperativeHandle(ref, () => ({
            captureFrame: () => {
            },
        }), []);

        useEffect(() => {
            if (!permission?.granted) {
                requestPermission();
            }
        }, [permission, requestPermission]);

        useEffect(() => {
            if (permission && !permission.granted && permission.canAskAgain === false) {
                onError?.('Camera permission is required.');
            }
        }, [permission, onError]);

        useEffect(() => {
            if (isWebViewReady) {
                const js = active ? 'window.startTick(); true;' : 'window.stopTick(); true;';
                webViewRef.current?.injectJavaScript(js);
            }
        }, [active, isWebViewReady]);

        useEffect(() => {
            if (!isWebViewReady) return;
            webViewRef.current?.injectJavaScript(
                `window.setRecognitionMode(${JSON.stringify(recognitionMode)}); true;`
            );
        }, [isWebViewReady, recognitionMode]);

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { margin: 0; padding: 0; overflow: hidden; background: #000; position: relative; }
                    /* selfieMode:true mirrors landmark coords; only the raw video needs CSS flip */
                    #input_video { 
                        position: absolute; top: 0; left: 0; 
                        width: 100vw; height: 100vh; 
                        object-fit: cover; 
                        z-index: 1;
                        transform: scaleX(-1);
                    }
                    #output_canvas { 
                        position: absolute; top: 0; left: 0; 
                        width: 100vw; height: 100vh; 
                        object-fit: cover; 
                        z-index: 2; 
                        pointer-events: none;
                        border: none;
                        /* Mirror canvas to match mirrored video display */
                        transform: scaleX(-1);
                    }
                </style>
                <script>
                    window.onerror = function(msg) {
                        try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: 'Early Error: ' + msg })); } catch(e){}
                    };
                    setTimeout(() => {
                        if (window.ReactNativeWebView) {
                            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: 'HTML Injected successfully!' }));
                        }
                    }, 100);
                <\/script>
                ${MEDIAPIPE_SCRIPT}
            </head>
            <body>
                <video id="input_video" playsinline></video>
                <canvas id="output_canvas" width="320" height="240"></canvas>
            </body>
            </html>
        `;

        const onMessage = useCallback((event: any) => {
            try {
                const message = JSON.parse(event.nativeEvent.data);
                if (message.type === 'keypoints') {
                    const keypoints = new Float32Array(message.data);
                    onKeypointsExtracted?.(keypoints);
                } else if (message.type === 'word-keypoints-batch') {
                    const bridgeMs = typeof message.sentAt === 'number'
                        ? Math.max(0, Date.now() - message.sentAt)
                        : undefined;
                    lastBridgeMsRef.current = bridgeMs;
                    for (const frame of message.frames || []) {
                        const buf = Buffer.from(frame.data, 'base64');
                        const ab = new ArrayBuffer(buf.length);
                        new Uint8Array(ab).set(buf);
                        const keypoints = new Float32Array(ab);
                        onKeypointsExtracted?.(keypoints);
                    }
                } else if (message.type === 'hand-landmarks') {
                    const landmarks = new Float32Array(message.landmarks);
                    onHandLandmarksExtracted?.(landmarks, message.timestamp || Date.now());
                } else if (message.type === 'no-hand') {
                    onNoHandDetected?.(message.timestamp || Date.now());
                    onKeypointsExtracted?.('no-hands');
                } else if (message.type === 'no-hands-keypoints') {
                    const keypoints = new Float32Array(message.data);
                    onKeypointsExtracted?.(keypoints);
                } else if (message.type === 'hands-detected') {
                    onKeypointsExtracted?.('hands-detected');
                } else if (message.type === 'no-hands') {
                    onNoHandDetected?.(message.timestamp || Date.now());
                    onKeypointsExtracted?.('no-hands');
                } else if (message.type === 'performance') {
                    onPerformance?.({
                        mode: message.mode === 'word' ? 'word' : 'alphabet',
                        processedFps: Number(message.processedFps) || 0,
                        averageMediaPipeMs: Number(message.averageMediaPipeMs) || 0,
                        bridgeBatchSize: Number(message.bridgeBatchSize) || 1,
                        bridgeMs: lastBridgeMsRef.current ?? (
                            typeof message.sentAt === 'number'
                                ? Math.max(0, Date.now() - message.sentAt)
                                : undefined
                        ),
                    });
                } else if (message.type === 'log') {
                    debugLog('[WebView DOM]', message.message);
                    if (typeof message.message === 'string' && message.message.startsWith('Init failed:')) {
                        onError?.(message.message);
                    }
                } else if (message.type === 'ready') {
                    debugLog('[CameraProcessor] WebView Ready Signal Received');
                    setIsWebViewReady(true);
                    onReady?.();
                }
            } catch (error) {
                console.error('Error parsing WebView message:', error);
            }
        }, [onKeypointsExtracted, onHandLandmarksExtracted, onNoHandDetected, onPerformance, onReady, onError]);

        const webViewPermissionProps = {
            onPermissionRequest: (event: any) => {
                event.grant();
            }
        } as any;

        if (!permission?.granted) {
            return (
                <View style={[styles.container, styles.centered, style]}>
                    <Text style={styles.permissionText}>Camera permission required</Text>
                </View>
            );
        }

        return (
            <View style={[styles.container, style]}>
                <WebViewWithAndroidPermissions
                    ref={webViewRef}
                    style={[styles.webView, { backgroundColor: 'transparent' }]}
                    originWhitelist={['*']}
                    source={{ html: htmlContent, baseUrl: 'https://www.google.com' }}
                    onMessage={onMessage}
                    javaScriptEnabled={true}
                    domStorageEnabled={true}
                    mediaPlaybackRequiresUserAction={false}
                    allowsInlineMediaPlayback={true}
                    allowFileAccessFromFileURLs={true}
                    allowUniversalAccessFromFileURLs={true}
                    mediaCapturePermissionGrantType="grant"
                    {...webViewPermissionProps}
                    onError={(syntheticEvent: any) => {
                        const { nativeEvent } = syntheticEvent;
                        console.error('WebView error: ', nativeEvent);
                    }}
                    onHttpError={(syntheticEvent: any) => {
                        const { nativeEvent } = syntheticEvent;
                        console.error('WebView HTTP error: ', nativeEvent);
                    }}
                    renderError={(errorDomain: any, errorCode: any, errorDesc: any) => (
                        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' }]}>
                            <Text style={{ color: 'red', textAlign: 'center' }}>WebView Crashed: {errorDesc} ({errorCode})</Text>
                        </View>
                    )}
                />
            </View>
        );
    }
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0a',
    },
    webView: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    centered: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    permissionText: {
        color: '#ffffff',
        fontSize: 16,
        textAlign: 'center',
    },
});

CameraProcessor.displayName = 'CameraProcessor';

export default CameraProcessor;
