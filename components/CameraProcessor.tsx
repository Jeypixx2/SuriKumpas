import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

const CAMERA_DEBUG = false;
const debugLog = (...args: unknown[]) => {
    if (CAMERA_DEBUG) console.log(...args);
};

interface CameraProcessorProps {
    onKeypointsExtracted?: (keypoints: Float32Array | 'hands-detected' | 'no-hands') => void;
    onImageFrameCaptured?: (frame: CameraImageFrame) => void;
    onPerformance?: (metrics: CameraPerformanceMetrics) => void;
    onReady?: () => void;
    onError?: (message: string) => void;
    style?: any;
    active?: boolean;
    recognitionMode?: 'alphabet' | 'word';
}

export interface CameraImageFrame {
    requestId?: number;
    width: number;
    height: number;
    rgb: Uint8Array;
    channels: 3;
    captureMs?: number;
    bridgeMs?: number;
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
    requestImageFrame: (requestId?: number, options?: { mirror?: boolean }) => void;
    speak: (text: string, lang?: string) => void;
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
        let wordKeypointBatch = [];
        let wordInputCanvas = null;
        let wordInputCtx = null;
        let isProcessing = false;
        let recognitionMode = 'alphabet';
        let lastAlphabetSignalAt = 0;
        let lastCanvasDrawAt = 0;
        const ALPHABET_SIGNAL_INTERVAL_MS = 66;
        const WORD_BRIDGE_BATCH_SIZE = 1;
        let performanceWindowStartedAt = performance.now();
        let performanceFrameCount = 0;
        let performanceTotalProcessingMs = 0;

        window.setRecognitionMode = function(mode) {
            const nextMode = mode === 'word' ? 'word' : 'alphabet';
            if (nextMode !== recognitionMode) {
                wordKeypointBatch = [];
                latestPoseResults = null;
                wordProcessedFrameCount = 0;
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

        window.speakText = function(text, lang) {
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = lang || 'fil-PH';
                utterance.rate = 1.1;
                window.speechSynthesis.speak(utterance);
            }
        };
        
        function r(n) { return Math.round(n * 10000) / 10000; }

        let latestHandBounds = null;
        let alphabetCanvas = null;
        let alphabetCtx = null;

        function rememberHandBounds(results) {
            const hands = [];
            if (results.leftHandLandmarks && results.leftHandLandmarks.length > 0) {
                hands.push(...results.leftHandLandmarks);
            }
            if (results.rightHandLandmarks && results.rightHandLandmarks.length > 0) {
                hands.push(...results.rightHandLandmarks);
            }

            if (hands.length === 0) {
                latestHandBounds = null;
                return;
            }

            let minX = 1;
            let minY = 1;
            let maxX = 0;
            let maxY = 0;
            hands.forEach((lm) => {
                minX = Math.min(minX, lm.x);
                minY = Math.min(minY, lm.y);
                maxX = Math.max(maxX, lm.x);
                maxY = Math.max(maxY, lm.y);
            });

            latestHandBounds = { minX, minY, maxX, maxY, seenAt: Date.now() };
        }

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

        window.captureAlphabetFrame = function(requestId, mirror) {
            const captureStartedAt = performance.now();
            try {
                if (!videoElement || videoElement.readyState < 2) {
                    throw new Error('Video is not ready yet.');
                }

                if (!alphabetCanvas) {
                    alphabetCanvas = document.createElement('canvas');
                    alphabetCanvas.width = 160;
                    alphabetCanvas.height = 160;
                    alphabetCtx = alphabetCanvas.getContext('2d', { willReadFrequently: true });
                    alphabetCtx.imageSmoothingEnabled = true;
                    alphabetCtx.imageSmoothingQuality = 'high';
                }

                const videoWidth = videoElement.videoWidth || 320;
                const videoHeight = videoElement.videoHeight || 240;

                let centerX = videoWidth / 2;
                let centerY = videoHeight / 2;
                let cropSize = Math.min(videoWidth, videoHeight) * 0.72;

                if (latestHandBounds) {
                    const boxCenterX = ((latestHandBounds.minX + latestHandBounds.maxX) / 2) * videoWidth;
                    const boxCenterY = ((latestHandBounds.minY + latestHandBounds.maxY) / 2) * videoHeight;
                    const boxWidth = Math.max(1, (latestHandBounds.maxX - latestHandBounds.minX) * videoWidth);
                    const boxHeight = Math.max(1, (latestHandBounds.maxY - latestHandBounds.minY) * videoHeight);

                    centerX = boxCenterX;
                    centerY = boxCenterY;
                    cropSize = Math.max(boxWidth, boxHeight) * 1.8;
                    cropSize = Math.max(cropSize, Math.min(videoWidth, videoHeight) * 0.42);
                    cropSize = Math.min(cropSize, Math.min(videoWidth, videoHeight));
                }

                let sourceX = centerX - cropSize / 2;
                let sourceY = centerY - cropSize / 2;
                sourceX = Math.max(0, Math.min(sourceX, videoWidth - cropSize));
                sourceY = Math.max(0, Math.min(sourceY, videoHeight - cropSize));

                alphabetCtx.save();
                alphabetCtx.clearRect(0, 0, 160, 160);
                if (mirror) {
                    alphabetCtx.translate(160, 0);
                    alphabetCtx.scale(-1, 1);
                }
                alphabetCtx.drawImage(
                    videoElement,
                    sourceX,
                    sourceY,
                    cropSize,
                    cropSize,
                    0,
                    0,
                    160,
                    160
                );
                alphabetCtx.restore();

                const rgba = alphabetCtx.getImageData(0, 0, 160, 160).data;
                const rgb = new Uint8Array(160 * 160 * 3);
                for (let rgbaIndex = 0, rgbIndex = 0; rgbaIndex < rgba.length; rgbaIndex += 4, rgbIndex += 3) {
                    rgb[rgbIndex] = rgba[rgbaIndex];
                    rgb[rgbIndex + 1] = rgba[rgbaIndex + 1];
                    rgb[rgbIndex + 2] = rgba[rgbaIndex + 2];
                }

                const encodedRgb = bytesToBase64(rgb);
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'image-frame',
                    requestId,
                    width: 160,
                    height: 160,
                    channels: 3,
                    data: encodedRgb,
                    captureMs: performance.now() - captureStartedAt,
                    sentAt: Date.now()
                }));
            } catch (e) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'image-frame-error',
                    requestId,
                    message: e.message || String(e)
                }));
            }
        };

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
            rememberHandBounds(results);
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

            // Alphabet classification only needs a small hand-presence signal.
            // Limit it to about 15 Hz so React Native stays responsive while
            // reducing the wait before the next eligible image inference.
            if (recognitionMode === 'alphabet') {
                const now = Date.now();
                if (now - lastAlphabetSignalAt >= ALPHABET_SIGNAL_INTERVAL_MS) {
                    lastAlphabetSignalAt = now;
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                        type: hasHands ? 'hands-detected' : 'no-hands'
                    }));
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

        function emitCombinedResults(poseLandmarks = []) {
            const handLandmarks = latestHandsResults?.multiHandLandmarks || [];
            const handedness = latestHandsResults?.multiHandedness || [];
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
                rightHandLandmarks
            });
        }
        
        async function initLandmarkers() {
            try {
                log('Initializing...');
                videoElement = document.getElementById('input_video');
                canvasElement = document.getElementById('output_canvas');
                canvasCtx = canvasElement.getContext('2d');

                wordInputCanvas = document.createElement('canvas');
                wordInputCanvas.width = 192;
                wordInputCanvas.height = 144;
                wordInputCtx = wordInputCanvas.getContext('2d', { alpha: false });
                wordInputCtx.imageSmoothingEnabled = false;

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
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
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
                                wordInputCtx.drawImage(videoElement, 0, 0, 192, 144);
                                wordProcessedFrameCount += 1;

                                // Body pose changes much more slowly than hand
                                // shape. Refresh it every third word frame and
                                // spend the saved work tracking hands each time.
                                if (!latestPoseResults || wordProcessedFrameCount % 3 === 1) {
                                    await poseTracker.send({ image: wordInputCanvas });
                                }
                                await handsTracker.send({ image: wordInputCanvas });
                                emitCombinedResults(latestPoseResults?.poseLandmarks || []);
                            } else {
                                // Alphabet remains on its existing fast hand-only path.
                                await handsTracker.send({ image: videoElement });
                                emitCombinedResults();
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
        onImageFrameCaptured,
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
            requestImageFrame: (requestId?: number, options?: { mirror?: boolean }) => {
                if (!isWebViewReady) {
                    onError?.('Camera is still starting.');
                    return;
                }

                const id = typeof requestId === 'number' ? requestId : Date.now();
                const shouldMirror = options?.mirror === true ? 'true' : 'false';
                webViewRef.current?.injectJavaScript(`window.captureAlphabetFrame(${id}, ${shouldMirror}); true;`);
            },
            speak: (text: string, lang: string = 'fil-PH') => {
                if (!isWebViewReady) return;

                const js = `window.speakText(${JSON.stringify(text)}, ${JSON.stringify(lang)}); true;`;
                webViewRef.current?.injectJavaScript(js);
            }
        }), [isWebViewReady, onError]);

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
                    if (CAMERA_DEBUG && Math.random() < 0.05) debugLog(`[CameraProcessor] Received keypoints, length: ${message.data.length}`);
                    const keypoints = new Float32Array(message.data);
                    onKeypointsExtracted?.(keypoints);
                } else if (message.type === 'word-keypoints-batch') {
                    const bridgeMs = typeof message.sentAt === 'number'
                        ? Math.max(0, Date.now() - message.sentAt)
                        : undefined;
                    lastBridgeMsRef.current = bridgeMs;
                    for (const frame of message.frames || []) {
                        const bytes = new Uint8Array(Buffer.from(frame.data, 'base64'));
                        const keypoints = new Float32Array(bytes.buffer);
                        onKeypointsExtracted?.(keypoints);
                    }
                } else if (message.type === 'no-hands-keypoints') {
                    const keypoints = new Float32Array(message.data);
                    onKeypointsExtracted?.(keypoints);
                } else if (message.type === 'hands-detected') {
                    onKeypointsExtracted?.('hands-detected');
                } else if (message.type === 'no-hands') {
                    onKeypointsExtracted?.('no-hands');
                } else if (message.type === 'image-frame') {
                    const rgb = new Uint8Array(Buffer.from(message.data, 'base64'));
                    const bridgeMs = typeof message.sentAt === 'number'
                        ? Math.max(0, Date.now() - message.sentAt)
                        : undefined;
                    lastBridgeMsRef.current = bridgeMs;
                    onImageFrameCaptured?.({
                        requestId: message.requestId,
                        width: message.width,
                        height: message.height,
                        channels: 3,
                        rgb,
                        captureMs: message.captureMs,
                        bridgeMs,
                    });
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
                } else if (message.type === 'image-frame-error') {
                    debugLog('[CameraProcessor] Image frame error:', message.message);
                    onError?.(message.message || 'Camera frame is not ready yet.');
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
        }, [onKeypointsExtracted, onImageFrameCaptured, onPerformance, onReady, onError]);

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
