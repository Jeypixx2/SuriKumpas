import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View, Text, Dimensions, ActivityIndicator } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';

interface CameraProcessorProps {
    onKeypointsExtracted?: (keypoints: Float32Array) => void;
    style?: any;
}

export interface CameraProcessorRef {
    captureFrame: () => void;
    speak: (text: string, lang?: string) => void;
}

const MEDIAPIPE_SCRIPT = `
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/holistic/holistic.js" crossorigin="anonymous"></script>
    <script>
        let videoElement = null;
        let canvasElement = null;
        let canvasCtx = null;
        let holistic = null;
        let isProcessing = false;

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
                window.speechSynthesis.speak(utterance);
            }
        };
        
        function r(n) { return Math.round(n * 10000) / 10000; }

        function extractKeypoints(results) {
            const kp = [];
            
            // Pose: 33 * 4 = 132 values
            const pose = results.poseLandmarks || [];
            for (let i = 0; i < 33; i++) {
                if (i < pose.length) { const lm = pose[i]; kp.push(r(lm.x), r(lm.y), r(lm.z), r(lm.visibility || 1)); }
                else { kp.push(0, 0, 0, 0); }
            }
            
            // Face: 468 * 3 = 1404 values — model was trained with this, MUST include real data
            const face = results.faceLandmarks || [];
            for (let i = 0; i < 468; i++) {
                if (i < face.length) { const lm = face[i]; kp.push(r(lm.x), r(lm.y), r(lm.z)); }
                else { kp.push(0, 0, 0); }
            }
            
            // Left hand: 21 * 3 = 63 values
            const lh = results.leftHandLandmarks || [];
            for (let i = 0; i < 21; i++) {
                if (i < lh.length) { const lm = lh[i]; kp.push(r(lm.x), r(lm.y), r(lm.z)); }
                else { kp.push(0, 0, 0); }
            }
            
            // Right hand: 21 * 3 = 63 values
            const rh = results.rightHandLandmarks || [];
            for (let i = 0; i < 21; i++) {
                if (i < rh.length) { const lm = rh[i]; kp.push(r(lm.x), r(lm.y), r(lm.z)); }
                else { kp.push(0, 0, 0); }
            }
            
            return kp;
        }
        
        function onResults(results) {
            canvasCtx.save();
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            
            // Draw hands only — pose skeleton is expensive and irrelevant for sign classification
            if (results.leftHandLandmarks) {
                drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS, {color: '#00FFCC', lineWidth: 2});
                drawLandmarks(canvasCtx, results.leftHandLandmarks, {color: '#ffffff', lineWidth: 1, radius: 3});
            }
            if (results.rightHandLandmarks) {
                drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS, {color: '#00FFCC', lineWidth: 2});
                drawLandmarks(canvasCtx, results.rightHandLandmarks, {color: '#ffffff', lineWidth: 1, radius: 3});
            }
            
            canvasCtx.restore();

            const lh = results.leftHandLandmarks || [];
            const rh = results.rightHandLandmarks || [];
            if (lh.length === 0 && rh.length === 0) return;
            
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'keypoints',
                data: extractKeypoints(results)
            }));
        }
        
        async function initHolistic() {
            try {
                log('Initializing...');
                videoElement = document.getElementById('input_video');
                canvasElement = document.getElementById('output_canvas');
                canvasCtx = canvasElement.getContext('2d');

                holistic = new Holistic({ locateFile: (file) => 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic/' + file });
                holistic.setOptions({
                    modelComplexity: 0,
                    selfieMode: true,           // MUST be true: model trained with mirrored landmark coords
                    smoothLandmarks: true,
                    enableSegmentation: false,
                    smoothSegmentation: false,
                    refineFaceLandmarks: false,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                });
                holistic.onResults(onResults);

                // Request front camera explicitly
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'user', width: 320, height: 240 },
                    audio: false
                });
                videoElement.srcObject = stream;
                await videoElement.play();
                log('Front camera ready');

                // 10fps frame loop (3 seconds to accumulate 30 frames for FSL classification)
                async function tick() {
                    const now = Date.now();
                    if (!isProcessing && (!window.lastTick || now - window.lastTick > 100)) {
                        isProcessing = true;
                        window.lastTick = now;
                        try { await holistic.send({ image: videoElement }); }
                        catch(e) { log('Send error: ' + e.message); }
                        finally { isProcessing = false; }
                    }
                    requestAnimationFrame(tick);
                }
                tick();

            } catch(e) {
                log('Init failed: ' + e.toString());
            }
        }
        
        window.addEventListener('DOMContentLoaded', initHolistic);
    </script>
`;

const CameraProcessor = forwardRef<CameraProcessorRef, CameraProcessorProps>(
    ({ onKeypointsExtracted, style }, ref) => {
        const [permission, requestPermission] = useCameraPermissions();
        const [htmlUri, setHtmlUri] = useState<string | null>(null);
        const webViewRef = useRef<WebView>(null);

        useImperativeHandle(ref, () => ({
            captureFrame: () => {
            },
            speak: (text: string, lang: string = 'fil-PH') => {
                const js = `window.speakText("${text}", "${lang}"); true;`;
                webViewRef.current?.injectJavaScript(js);
            }
        }));

        useEffect(() => {
            if (!permission?.granted) {
                requestPermission();
            }
        }, [permission, requestPermission]);

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
                        /* NO transform — landmark coords already mirrored by selfieMode:true */
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
                <canvas id="output_canvas" width="640" height="480"></canvas>
            </body>
            </html>
        `;

        const onMessage = useCallback((event: any) => {
            try {
                const message = JSON.parse(event.nativeEvent.data);
                if (message.type === 'keypoints') {
                    const keypoints = new Float32Array(message.data);
                    onKeypointsExtracted?.(keypoints);
                } else if (message.type === 'log') {
                    console.log('[WebView DOM]', message.message);
                }
            } catch (error) {
                console.error('Error parsing WebView message:', error);
            }
        }, [onKeypointsExtracted]);
        
        if (!permission?.granted) {
            return (
                <View style={[styles.container, styles.centered, style]}>
                    <Text style={styles.permissionText}>Camera permission required</Text>
                </View>
            );
        }

        return (
            <View style={[styles.container, style]}>
                <WebView
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
                    // @ts-ignore: Prop may not be exposed in local library typings
                    onPermissionRequest={(event: any) => {
                        event.grant();
                    }}
                    onError={(syntheticEvent) => {
                        const { nativeEvent } = syntheticEvent;
                        console.error('WebView error: ', nativeEvent);
                    }}
                    onHttpError={(syntheticEvent) => {
                        const { nativeEvent } = syntheticEvent;
                        console.error('WebView HTTP error: ', nativeEvent);
                    }}
                    renderError={(errorDomain, errorCode, errorDesc) => (
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
