import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import CameraProcessor, { CameraImageFrame, CameraProcessorRef } from '../../components/CameraProcessor';
import ResultOverlay from '../../components/ResultOverlay';
import { globalAlphabetImageClassifier } from '../../lib/AlphabetImageClassifier';
import { FSLLabel } from '../../lib/labels';

// Aligned with Pose-Face-LH-RH order:
// Pose: 0..131, Face: 132..1535, LH: 1536..1598, RH: 1599..1661
const LH_START = 1536;
const RH_START = 1599;
const ALPHABET_CONFIDENCE_THRESHOLD = 0.55;
const ALPHABET_QUICK_ACCEPT_THRESHOLD = 0.82;
const ALPHABET_MARGIN_THRESHOLD = 0.12;
const ALPHABET_CONFIRMATION_COUNT = 2;
const ALPHABET_HISTORY_LIMIT = 4;
const CONFUSABLE_ALPHABET_LABELS = new Set(['N', 'T']);
const CONFUSABLE_ALPHABET_CONFIDENCE_THRESHOLD = 0.72;
const CONFUSABLE_ALPHABET_QUICK_ACCEPT_THRESHOLD = 0.94;
const CONFUSABLE_ALPHABET_MARGIN_THRESHOLD = 0.22;
const CONFUSABLE_ALPHABET_CONFIRMATION_COUNT = 3;
const ALPHABET_INFERENCE_INTERVAL_MS = 350;
const ALPHABET_FRAME_TIMEOUT_MS = 1200;
const DETECTION_COOLDOWN_MS = 500;
const NO_HANDS_GRACE_FRAMES = 3;

export default function DetectScreen() {
    const router = useRouter();
    const alphabetClassifierRef = useRef(globalAlphabetImageClassifier);
    const cameraRef = useRef<CameraProcessorRef>(null);
    const isFocused = useIsFocused();

    const [detectedLabel, setDetectedLabel] = useState<FSLLabel | null>(null);
    const [confidence, setConfidence] = useState(0);
    const [showResult, setShowResult] = useState(false);
    const [status, setStatus] = useState('Paghahanda...');
    const [debugInfo, setDebugInfo] = useState('');
    const [isMirrored, setIsMirrored] = useState(true);

    const alphabetPredictionHistoryRef = useRef<string[]>([]);
    const missingHandFrameCountRef = useRef(0);
    const lastDetectionRef = useRef<number>(0);
    const lastAlphabetInferenceRef = useRef<number>(0);
    const activeAlphabetRequestRef = useRef<number>(0);
    const alphabetRequestCounterRef = useRef<number>(0);
    const alphabetFrameTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isAlphabetProcessingRef = useRef<boolean>(false);
    const processingAlphabetRequestRef = useRef<number>(0);

    const pulseDot = useRef(new Animated.Value(0.4)).current;
    const dotPattern = useMemo(() => Array.from({ length: 15 }).map((_, i) => (
        <View key={i} style={[styles.dot, { left: (i % 5) * 80 + 40, top: Math.floor(i / 5) * 80 + 40 }]} />
    )), []);

    useEffect(() => {
        if (!isFocused) {
            alphabetPredictionHistoryRef.current = [];
            missingHandFrameCountRef.current = 0;
            activeAlphabetRequestRef.current = 0;
            processingAlphabetRequestRef.current = 0;
            isAlphabetProcessingRef.current = false;
            if (alphabetFrameTimeoutRef.current) {
                clearTimeout(alphabetFrameTimeoutRef.current);
                alphabetFrameTimeoutRef.current = null;
            }
        }
    }, [isFocused]);

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseDot, {
                    toValue: 1,
                    duration: 900,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseDot, {
                    toValue: 0.4,
                    duration: 900,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, [pulseDot]);

    useEffect(() => {
        const loadModels = async () => {
            try {
                await alphabetClassifierRef.current.load();
                setStatus('Handa na. Magpakita ng letra.');
            } catch (error: any) {
                console.error('Error loading alphabet model:', error);
                setStatus('Error sa pagload ng model.');
                Alert.alert('Alphabet Model Load Error', error.message || String(error));
            }
        };
        loadModels();
    }, []);

    useEffect(() => {
        return () => {
            if (alphabetFrameTimeoutRef.current) {
                clearTimeout(alphabetFrameTimeoutRef.current);
            }
        };
    }, []);

    const cancelPendingAlphabetFrame = useCallback(() => {
        activeAlphabetRequestRef.current = 0;
        processingAlphabetRequestRef.current = 0;
        if (alphabetFrameTimeoutRef.current) {
            clearTimeout(alphabetFrameTimeoutRef.current);
            alphabetFrameTimeoutRef.current = null;
        }
    }, []);

    const clearAlphabetBuffers = useCallback(() => {
        alphabetPredictionHistoryRef.current = [];
        cancelPendingAlphabetFrame();
    }, [cancelPendingAlphabetFrame]);

    const handleHandsMissing = useCallback(() => {
        missingHandFrameCountRef.current += 1;
        if (missingHandFrameCountRef.current < NO_HANDS_GRACE_FRAMES) return;
        if (missingHandFrameCountRef.current > NO_HANDS_GRACE_FRAMES) return;

        setStatus('Walang kamay na nakita.');
        clearAlphabetBuffers();
    }, [clearAlphabetBuffers]);

    const requestAlphabetFrame = useCallback((modeDebug: string) => {
        const now = Date.now();
        if (isAlphabetProcessingRef.current) return;
        if (activeAlphabetRequestRef.current !== 0) return;
        if (now - lastAlphabetInferenceRef.current < ALPHABET_INFERENCE_INTERVAL_MS) return;

        const requestId = ++alphabetRequestCounterRef.current;
        activeAlphabetRequestRef.current = requestId;
        lastAlphabetInferenceRef.current = now;
        setStatus('Sinusuri ang letra...');
        setDebugInfo(`Mode: Alphabet | ${modeDebug}`);

        cameraRef.current?.requestImageFrame(requestId, { mirror: isMirrored });
        alphabetFrameTimeoutRef.current = setTimeout(() => {
            if (activeAlphabetRequestRef.current === requestId) {
                activeAlphabetRequestRef.current = 0;
            }
            alphabetFrameTimeoutRef.current = null;
        }, ALPHABET_FRAME_TIMEOUT_MS);
    }, [isMirrored]);

    const handleImageFrameCaptured = useCallback(async (frame: CameraImageFrame) => {
        if (!isFocused) return;
        if (!frame.requestId || frame.requestId !== activeAlphabetRequestRef.current) return;

        if (alphabetFrameTimeoutRef.current) {
            clearTimeout(alphabetFrameTimeoutRef.current);
            alphabetFrameTimeoutRef.current = null;
        }
        activeAlphabetRequestRef.current = 0;
        isAlphabetProcessingRef.current = true;
        processingAlphabetRequestRef.current = frame.requestId;

        try {
            const result = await alphabetClassifierRef.current.classify(frame);
            if (processingAlphabetRequestRef.current !== frame.requestId) return;

            const alternativesDebug = result.alternatives
                .map(item => `${item.label}:${(item.confidence * 100).toFixed(0)}`)
                .join(' ');
            setDebugInfo(`Mode: Alphabet | ${alternativesDebug} | Gap:${(result.margin * 100).toFixed(0)}`);

            const isConfusableLetter = CONFUSABLE_ALPHABET_LABELS.has(result.label);
            const confidenceThreshold = isConfusableLetter
                ? CONFUSABLE_ALPHABET_CONFIDENCE_THRESHOLD
                : ALPHABET_CONFIDENCE_THRESHOLD;
            const marginThreshold = isConfusableLetter
                ? CONFUSABLE_ALPHABET_MARGIN_THRESHOLD
                : ALPHABET_MARGIN_THRESHOLD;
            const quickAcceptThreshold = isConfusableLetter
                ? CONFUSABLE_ALPHABET_QUICK_ACCEPT_THRESHOLD
                : ALPHABET_QUICK_ACCEPT_THRESHOLD;
            const requiredRepeatCount = isConfusableLetter
                ? CONFUSABLE_ALPHABET_CONFIRMATION_COUNT
                : ALPHABET_CONFIRMATION_COUNT;

            if (result.confidence < confidenceThreshold || result.margin < marginThreshold) {
                alphabetPredictionHistoryRef.current = [];
                return;
            }

            const isQuickAccept = result.confidence >= quickAcceptThreshold;

            if (!isQuickAccept) {
                alphabetPredictionHistoryRef.current.push(result.label);
                if (alphabetPredictionHistoryRef.current.length > ALPHABET_HISTORY_LIMIT) {
                    alphabetPredictionHistoryRef.current.shift();
                }
            }

            const repeatedLetterCount = isQuickAccept
                ? requiredRepeatCount
                : alphabetPredictionHistoryRef.current.filter(letter => letter === result.label).length;

            if (isQuickAccept || repeatedLetterCount >= requiredRepeatCount) {
                const label: FSLLabel = {
                    id: 200 + result.index,
                    english: result.label,
                    filipino: result.label,
                    category: 'ALPABETO'
                };

                setDetectedLabel(label);
                setConfidence(result.confidence);
                setShowResult(true);
                setStatus(`${result.label} (${(result.confidence * 100).toFixed(0)}%)`);
                cameraRef.current?.speak(result.label, 'fil-PH');
                lastDetectionRef.current = Date.now();
                alphabetPredictionHistoryRef.current = [];
                setTimeout(() => setShowResult(false), 2000);
            }
        } catch (e: any) {
            console.error('Alphabet Image Error:', e);
            setDebugInfo('Mode: Alphabet | Err: ' + (e.message || String(e)));
        } finally {
            if (processingAlphabetRequestRef.current === frame.requestId) {
                processingAlphabetRequestRef.current = 0;
            }
            isAlphabetProcessingRef.current = false;
        }
    }, [isFocused]);

    const handleKeypointsExtracted = useCallback(async (keypoints: Float32Array | 'no-hands') => {
        if (!isFocused) return;
        if (keypoints === 'no-hands') {
            handleHandsMissing();
            return;
        }

        let handsDetected = false;
        for (let i = LH_START; i < LH_START + 63; i++) {
            if (keypoints[i] !== 0) { handsDetected = true; break; }
        }
        if (!handsDetected) {
            for (let i = RH_START; i < RH_START + 63; i++) {
                if (keypoints[i] !== 0) { handsDetected = true; break; }
            }
        }

        if (!handsDetected) {
            handleHandsMissing();
            return;
        }

        missingHandFrameCountRef.current = 0;

        const now = Date.now();
        if (now - lastDetectionRef.current < DETECTION_COOLDOWN_MS) return;

        requestAlphabetFrame('Hand detected');
    }, [isFocused, requestAlphabetFrame, handleHandsMissing]);

    return (
        <View style={styles.container}>
            <View style={styles.topHalf}>
                <CameraProcessor
                    ref={cameraRef}
                    style={styles.camera}
                    onKeypointsExtracted={handleKeypointsExtracted}
                    onImageFrameCaptured={handleImageFrameCaptured}
                    active={isFocused}
                />
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <MaterialIcons name="arrow-back" size={22} color="#2D3561" />
                </TouchableOpacity>
            </View>

            <View style={styles.bottomHalf}>
                <View style={styles.statusPill}>
                    <Animated.View style={[
                        styles.statusDot,
                        {
                            opacity: pulseDot,
                            backgroundColor: status.includes('Walang') ?
                                '#FF8A65' :
                                status.includes('Error') ? '#E57373' : '#5BC4B5'
                        }
                    ]} />
                    <Text style={styles.statusText}>{status}</Text>
                </View>

                {!!debugInfo && (
                    <View style={styles.debugPanel}>
                        <Text style={styles.debugText}>{debugInfo}</Text>
                    </View>
                )}

                <ResultOverlay label={detectedLabel} confidence={confidence} visible={showResult} />

                <View style={styles.dotPattern}>
                    {dotPattern}
                </View>

                <TouchableOpacity
                    style={styles.mirrorToggle}
                    onPress={() => setIsMirrored(!isMirrored)}
                >
                    <MaterialIcons name="flip" size={18} color="#5BC4B5" />
                    <Text style={styles.mirrorText}>{isMirrored ? 'Mirrored' : 'Normal'}</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFF9F5' },
    topHalf: { height: '50%', width: '100%', position: 'relative' },
    bottomHalf: {
        height: '50%', width: '100%', backgroundColor: '#FAFAFE',
        justifyContent: 'center', alignItems: 'center',
        borderTopWidth: 2,
        borderTopColor: '#A8E6CF',
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 10,
    },
    camera: { flex: 1 },
    backButton: {
        position: 'absolute', top: 50, left: 20, width: 44, height: 44,
        borderRadius: 22, backgroundColor: 'rgba(255, 255, 255, 0.9)',
        alignItems: 'center', justifyContent: 'center', zIndex: 10,
        borderWidth: 1.5,
        borderColor: '#A8E6CF',
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
        elevation: 4,
    },
    statusPill: {
        position: 'absolute',
        top: 24,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderWidth: 1.5,
        borderColor: '#E0F5F2',
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 8,
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
        elevation: 3,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 8,
    },
    statusText: {
        color: '#2D3561',
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 0.4,
    },
    debugPanel: {
        position: 'absolute',
        top: 72,
        backgroundColor: 'rgba(255,255,255,0.9)',
        borderWidth: 1,
        borderColor: '#A8E6CF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    debugText: {
        color: '#7A7A9D',
        fontSize: 10,
        fontFamily: 'monospace',
    },
    mirrorToggle: {
        position: 'absolute', bottom: 30, right: 20,
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: '#A8E6CF',
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 3,
    },
    mirrorText: { color: '#2B9C8E', marginLeft: 6, fontSize: 11, fontWeight: 'bold', letterSpacing: 0.4 },
    dotPattern: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' },
    dot: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(91, 196, 181, 0.15)' },
});
