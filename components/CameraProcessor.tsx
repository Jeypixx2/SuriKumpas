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
}

const MEDIAPIPE_SCRIPT = `
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/@mediapipe/holistic/holistic.js" crossorigin="anonymous"></script>
    <script>
        const videoElement = document.getElementById('input_video');
        const canvasElement = document.getElementById('output_canvas');
        const canvasCtx = canvasElement.getContext('2d');
        
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
            
            if (results.poseLandmarks) {
                drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
                    {color: '#00E5FF', lineWidth: 2});
                drawLandmarks(canvasCtx, results.poseLandmarks,
                    {color: '#FF0000', lineWidth: 1, radius: 3});
            }
            
            if (results.faceLandmarks) {
                drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_TESSELATION,
                    {color: '#00E5FF', lineWidth: 1});
            }
            
            if (results.leftHandLandmarks) {
                drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS,
                    {color: '#00E5FF', lineWidth: 2});
                drawLandmarks(canvasCtx, results.leftHandLandmarks,
                    {color: '#00FF00', lineWidth: 1, radius: 3});
            }
            
            if (results.rightHandLandmarks) {
                drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS,
                    {color: '#00E5FF', lineWidth: 2});
                drawLandmarks(canvasCtx, results.rightHandLandmarks,
                    {color: '#00FF00', lineWidth: 1, radius: 3});
            }
            
            canvasCtx.restore();
            
            const keypoints = extractKeypoints(results);
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'keypoints',
                data: Array.from(keypoints)
            }));
        }
        
        async function initHolistic() {
            try {
                log('Initializing Holistic...');
                
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    log('CRITICAL: getUserMedia is NOT available!');
                } else {
                    log('getUserMedia is available.');
                }

                holistic = new Holistic({locateFile: (file) => {
                    return 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic/' + file;
                }});
            
            holistic.setOptions({
                modelComplexity: 1,
                smoothLandmarks: true,
                enableSegmentation: false,
                smoothSegmentation: false,
                refineFaceLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            
            holistic.onResults(onResults);
            
            camera = new Camera(videoElement, {
                onFrame: async () => {
                    if (!isProcessing) {
                        isProcessing = true;
                        await holistic.send({image: videoElement});
                        isProcessing = false;
                    }
                },
                width: 640,
                height: 480
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
        const cameraRef = useRef<CameraView>(null);

        useImperativeHandle(ref, () => ({
            captureFrame: () => {
            }
        }));

        useEffect(() => {
            if (!permission?.granted) {
                requestPermission();
            }
        }, [permission, requestPermission]);

        useEffect(() => {
            const prepareHtmlFile = async () => {
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
                        ${MEDIAPIPE_SCRIPT}
                    </head>
                    <body>
                        <video id="input_video"></video>
                        <canvas id="output_canvas" width="640" height="480"></canvas>
                    </body>
                    </html>
                `;
                const filePath = FileSystem.cacheDirectory + 'mediapipe.html';
                try {
                    await FileSystem.writeAsStringAsync(filePath, htmlContent);
                    setHtmlUri('file://' + filePath);
                } catch (e) {
                    console.error('Failed to write mediapipe file', e);
                }
            };
            prepareHtmlFile();
        }, []);

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

        if (!htmlUri) {
            return (
                <View style={[styles.container, styles.centered, style]}>
                    <ActivityIndicator size="large" color="#00E5FF" />
                    <Text style={styles.permissionText}>Securing Camera Bridge...</Text>
                </View>
            );
        }

        return (
            <View style={[styles.container, style]}>
                <WebView
                    ref={webViewRef}
                    style={styles.webView}
                    originWhitelist={['*']}
                    source={{ uri: htmlUri }}
                    onMessage={onMessage}
                    javaScriptEnabled={true}
                    domStorageEnabled={true}
                    mediaPlaybackRequiresUserAction={false}
                    allowsInlineMediaPlayback={true}
                    allowFileAccessFromFileURLs={true}
                    allowUniversalAccessFromFileURLs={true}
                    mediaCapturePermissionGrantType="grant"
                />
            </View>
        );
    }
);

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0a',
    },
    webView: {
        flex: 1,
        width: width,
        height: height,
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
