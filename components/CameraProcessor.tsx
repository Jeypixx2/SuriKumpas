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
        let camera = null;
        let isProcessing = false;

        window.onerror = function(msg, url, line) {
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: 'WebView Error: ' + msg }));
            }
            return true;
        };

        function log(msg) {
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'log', message: String(msg) }));
            }
        }

        window.speakText = function(text, lang) {
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = lang || 'fil-PH';
                utterance.pitch = 1.0;
                utterance.rate = 1.0;
                window.speechSynthesis.speak(utterance);
            }
        };
        
        function extractKeypoints(results) {
            const keypoints = [];
            
            const poseLandmarks = results.poseLandmarks || [];
            for (let i = 0; i < 33; i++) {
                if (i < poseLandmarks.length) {
                    const lm = poseLandmarks[i];
                    keypoints.push(lm.x, lm.y, lm.z, lm.visibility || 1.0);
                } else {
                    keypoints.push(0, 0, 0, 0);
                }
            }
            
            const faceLandmarks = results.faceLandmarks || [];
            for (let i = 0; i < 468; i++) {
                if (i < faceLandmarks.length) {
                    const lm = faceLandmarks[i];
                    keypoints.push(lm.x, lm.y, lm.z);
                } else {
                    keypoints.push(0, 0, 0);
                }
            }
            
            const leftHandLandmarks = results.leftHandLandmarks || [];
            for (let i = 0; i < 21; i++) {
                if (i < leftHandLandmarks.length) {
                    const lm = leftHandLandmarks[i];
                    keypoints.push(lm.x, lm.y, lm.z);
                } else {
                    keypoints.push(0, 0, 0);
                }
            }
            
            const rightHandLandmarks = results.rightHandLandmarks || [];
            for (let i = 0; i < 21; i++) {
                if (i < rightHandLandmarks.length) {
                    const lm = rightHandLandmarks[i];
                    keypoints.push(lm.x, lm.y, lm.z);
                } else {
                    keypoints.push(0, 0, 0);
                }
            }
            
            return new Float32Array(keypoints);
        }
        
        function onResults(results) {
            canvasCtx.save();
            canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
            
            canvasCtx.shadowColor = '#00E5FF';
            canvasCtx.shadowBlur = 8;
            
            if (results.poseLandmarks) {
                drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
                    {color: '#00E5FF', lineWidth: 3});
                drawLandmarks(canvasCtx, results.poseLandmarks,
                    {color: '#FF2A85', lineWidth: 2, radius: 4});
            }
            
            if (results.leftHandLandmarks) {
                drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS,
                    {color: '#00E5FF', lineWidth: 3});
                drawLandmarks(canvasCtx, results.leftHandLandmarks,
                    {color: '#00FFCC', lineWidth: 2, radius: 4});
            }
            
            if (results.rightHandLandmarks) {
                drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS,
                    {color: '#00E5FF', lineWidth: 3});
                drawLandmarks(canvasCtx, results.rightHandLandmarks,
                    {color: '#00FFCC', lineWidth: 2, radius: 4});
            }
            
            canvasCtx.shadowBlur = 0;
            canvasCtx.restore();

            const leftHand = results.leftHandLandmarks || [];
            const rightHand = results.rightHandLandmarks || [];
            if (leftHand.length === 0 && rightHand.length === 0) {
                // Drop the frame if no hands are visible to prevent immense JSON lag
                return;
            }
            
            const keypoints = extractKeypoints(results);
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'keypoints',
                data: Array.from(keypoints)
            }));
        }
        
        async function initHolistic() {
            try {
                log('Initializing Holistic...');
                
                videoElement = document.getElementById('input_video');
                canvasElement = document.getElementById('output_canvas');
                canvasCtx = canvasElement.getContext('2d');
                
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    log('CRITICAL: getUserMedia is NOT available!');
                } else {
                    log('getUserMedia is available.');
                }

                holistic = new Holistic({locateFile: (file) => {
                    return 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic/' + file;
                }});
            
            holistic.setOptions({
                modelComplexity: 0,
                smoothLandmarks: true,
                enableSegmentation: false,
                smoothSegmentation: false,
                refineFaceLandmarks: false,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            
            holistic.onResults(onResults);
            
            camera = new Camera(videoElement, {
                onFrame: async () => {
                    if (!isProcessing) {
                        isProcessing = true;
                        try {
                            await holistic.send({image: videoElement});
                        } finally {
                            // Yield back to browser microtask queue to unblock UI thread
                            setTimeout(() => { isProcessing = false }, 10);
                        }
                    }
                },
                width: 320,
                height: 240
            });
            
                camera.start().then(() => log('Camera started successfully')).catch(e => log('Camera start failed: ' + e.message));
            } catch (err) {
                log('Init Error: ' + err.toString());
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
                    body { margin: 0; overflow: hidden; background: #1a1a1a; }
                    #input_video { display: none; }
                    #output_canvas { width: 100%; height: 100%; border: 2px solid cyan; }
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
                </script>
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
