import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import CameraProcessor, {
    CameraImageFrame,
    CameraPerformanceMetrics,
    CameraProcessorRef,
} from '../../components/CameraProcessor';
import ResultOverlay from '../../components/ResultOverlay';
import { globalAlphabetImageClassifier } from '../../lib/AlphabetImageClassifier';
import { globalClassifier } from '../../lib/SignClassifier';
import { FSLLabel, FSL_LABELS } from '../../lib/labels';

type RecognitionMode = 'alphabet' | 'word';
type StableWordPrediction = {
    label: string;
    labelIndex: number;
    confidence: number;
};
type WordPredictionHistoryItem = StableWordPrediction | null;
type WordInferencePolicy = {
    source: 'full' | 'completed';
    confidenceThreshold: number;
    quickAcceptThreshold: number;
    marginThreshold: number;
};

let speechRequestId = 0;

function stopDetectedSpeech(): void {
    speechRequestId += 1;
    void Speech.stop().catch(error => {
        console.warn('[Detect] Could not stop speech:', error);
    });
}

function speakDetectedPrediction(text: string): void {
    const normalizedText = text.trim();
    if (!normalizedText) return;

    const requestId = ++speechRequestId;
    void Speech.stop()
        .then(() => {
            // A newer detection may have arrived while the previous speech was
            // stopping. Only the newest confirmed prediction should be spoken.
            if (requestId !== speechRequestId) return;

            Speech.speak(normalizedText, {
                language: 'fil-PH',
                rate: 0.85,
                pitch: 1,
                onError: error => {
                    console.warn('[Detect] Text-to-speech error:', error);
                },
            });
        })
        .catch(error => {
            console.warn('[Detect] Could not start speech:', error);
        });
}

// Compact camera bridge payload aligned with the word model: Pose-LH-RH.
// Pose: 0..131, LH: 132..194, RH: 195..257
const POSE_START = 0;
const POSE_SIZE = 132;
const LH_START = 132;
const RH_START = 195;
const HAND_SIZE = 63;
const WORD_FRAME_SIZE = POSE_SIZE + HAND_SIZE + HAND_SIZE;
const INITIAL_WORD_SEQUENCE_LENGTH = 30;
const WORD_CONFIDENCE_THRESHOLD = 0.75;
const WORD_QUICK_ACCEPT_THRESHOLD = 0.90;
const WORD_COMPLETED_GESTURE_CONFIDENCE_THRESHOLD = 0.85;
const WORD_COMPLETED_GESTURE_QUICK_ACCEPT_THRESHOLD = 0.94;
const WORD_COMPLETED_GESTURE_MARGIN_THRESHOLD = 0.12;
const WORD_SMOOTHING_WINDOW = 3;
const WORD_PREDICTION_STRIDE = 1;
const WORD_GESTURE_MIN_FRAMES = 14;
const WORD_GESTURE_END_STILL_FRAMES = 2;
const WORD_COMPLETED_GESTURE_MAX_PROBES = 6;
const WORD_COMPLETED_GESTURE_PROBE_STRIDE = 2;
const WORD_THANK_YOU_MIN_FRAMES = 22;
const WORD_HAND_MOTION_THRESHOLD = 0.006;
const WORD_GESTURE_PRE_ROLL_FRAMES = 3;
const WORD_RESULT_REARM_STILL_FRAMES = 2;
const WORD_RESULT_REARM_MOTION_FRAMES = 3;
const WORD_RESULT_VISIBLE_MS = 2000;
const WORD_DEBUG_LOG_INTERVAL = 15;
const WORD_INFERENCE_LOG_INTERVAL = 10;

const ALPHABET_CONFIDENCE_THRESHOLD = 0.62;
const ALPHABET_QUICK_ACCEPT_THRESHOLD = 0.95;
const ALPHABET_MARGIN_THRESHOLD = 0.18;
const ALPHABET_CONFIRMATION_COUNT = 3;
const ALPHABET_HISTORY_LIMIT = 5;
const CONFUSABLE_ALPHABET_LABELS = new Set(['M', 'N', 'S', 'T']);
const CONFUSABLE_ALPHABET_CONFIDENCE_THRESHOLD = 0.75;
const CONFUSABLE_ALPHABET_QUICK_ACCEPT_THRESHOLD = 0.97;
const CONFUSABLE_ALPHABET_MARGIN_THRESHOLD = 0.25;
const CONFUSABLE_ALPHABET_CONFIRMATION_COUNT = 4;
const ALPHABET_INFERENCE_INTERVAL_MS = 180;
const ALPHABET_FRAME_TIMEOUT_MS = 800;
const DETECTION_COOLDOWN_MS = 500;

const NO_HANDS_GRACE_FRAMES = 3;
const SWAP_HANDS_FOR_MIRROR = false;

const FULL_WORD_INFERENCE_POLICY: WordInferencePolicy = {
    source: 'full',
    confidenceThreshold: WORD_CONFIDENCE_THRESHOLD,
    quickAcceptThreshold: WORD_QUICK_ACCEPT_THRESHOLD,
    marginThreshold: 0.08,
};

const COMPLETED_WORD_INFERENCE_POLICY: WordInferencePolicy = {
    source: 'completed',
    confidenceThreshold: WORD_COMPLETED_GESTURE_CONFIDENCE_THRESHOLD,
    quickAcceptThreshold: WORD_COMPLETED_GESTURE_QUICK_ACCEPT_THRESHOLD,
    marginThreshold: WORD_COMPLETED_GESTURE_MARGIN_THRESHOLD,
};

function normalizeLabelKey(value: string): string {
    return value.replace(/[_-]+/g, ' ').trim().toUpperCase();
}

function formatFilipinoResult(value: string): string {
    return value
        .trim()
        .toLocaleLowerCase('fil-PH')
        .replace(/(^|\s|-)([a-z])/g, (_, prefix: string, letter: string) =>
            prefix + letter.toUpperCase()
        );
}

function createWordDisplayLabel(label: string, labelIndex: number): FSLLabel {
    const normalized = normalizeLabelKey(label);
    const existing = FSL_LABELS.find(item =>
        normalizeLabelKey(item.english) === normalized ||
        normalizeLabelKey(item.filipino) === normalized
    );

    return existing ?? {
        id: 500 + labelIndex,
        english: normalized,
        filipino: normalized,
        category: 'SENYAS',
    };
}

function modelErrorMessage(mode: RecognitionMode, error: unknown): string {
    const details = error instanceof Error ? error.message : String(error);
    if (mode === 'alphabet') {
        return details.includes('Alphabet model file')
            ? details
            : `Alphabet model file is missing or could not be loaded. Details: ${details}`;
    }

    return details.includes('Word model could not be loaded')
        ? details
        : `Word model could not be loaded. Details: ${details}`;
}

function hasAnyNonZero(values: Float32Array, start: number, end: number): boolean {
    for (let i = start; i < end; i++) {
        if (values[i] !== 0) return true;
    }
    return false;
}

function getWordHandVisibility(keypoints: Float32Array): { leftVisible: boolean; rightVisible: boolean } {
    return {
        leftVisible: hasAnyNonZero(keypoints, LH_START, LH_START + HAND_SIZE),
        rightVisible: hasAnyNonZero(keypoints, RH_START, RH_START + HAND_SIZE),
    };
}

function convertLandmarkFrameToWordFrame(keypoints: Float32Array): Float32Array | null {
    if (keypoints.length !== WORD_FRAME_SIZE) {
        console.warn(`[Detect] Expected ${WORD_FRAME_SIZE} pose+hand keypoints, got ${keypoints.length}.`);
        return null;
    }

    if (!SWAP_HANDS_FOR_MIRROR) return keypoints;

    const pose = keypoints.slice(POSE_START, POSE_START + POSE_SIZE);
    const leftHand = keypoints.slice(LH_START, LH_START + HAND_SIZE);
    const rightHand = keypoints.slice(RH_START, RH_START + HAND_SIZE);
    const wordFrame = new Float32Array(WORD_FRAME_SIZE);

    wordFrame.set(pose, 0);
    wordFrame.set(rightHand, POSE_SIZE);
    wordFrame.set(leftHand, POSE_SIZE + HAND_SIZE);

    return wordFrame;
}

function calculateHandMotion(previous: Float32Array, current: Float32Array): number {
    let totalMotion = 0;
    let comparedLandmarks = 0;

    for (const handStart of [LH_START, RH_START]) {
        for (let landmark = 0; landmark < 21; landmark++) {
            const index = handStart + landmark * 3;
            const previousX = previous[index];
            const previousY = previous[index + 1];
            const currentX = current[index];
            const currentY = current[index + 1];
            if (
                (previousX === 0 && previousY === 0) ||
                (currentX === 0 && currentY === 0)
            ) continue;

            totalMotion += Math.hypot(currentX - previousX, currentY - previousY);
            comparedLandmarks += 1;
        }
    }

    return comparedLandmarks > 0 ? totalMotion / comparedLandmarks : 0;
}

function resampleCompletedGesture(frames: Float32Array[], targetLength: number): Float32Array[] {
    if (frames.length >= targetLength) return frames.slice(-targetLength);
    if (frames.length === 0) return [];
    if (frames.length === 1) return Array.from({ length: targetLength }, () => frames[0]);

    // Spread the observed movement across the model's full time axis. Repeating
    // only the final pose hides the motion that separates compound gestures
    // such as GOOD MORNING from the shorter THANK YOU gesture.
    return Array.from({ length: targetLength }, (_, targetIndex) => {
        const sourcePosition = targetIndex * (frames.length - 1) / (targetLength - 1);
        return frames[Math.round(sourcePosition)];
    });
}

function getMajorityWordPrediction(history: WordPredictionHistoryItem[]): StableWordPrediction | null {
    const counts = new Map<string, { count: number; labelIndex: number; confidence: number }>();

    history.forEach(item => {
        if (!item) return;

        const current = counts.get(item.label);
        if (current) {
            current.count += 1;
            current.confidence = item.confidence;
        } else {
            counts.set(item.label, {
                count: 1,
                labelIndex: item.labelIndex,
                confidence: item.confidence,
            });
        }
    });

    let majority: StableWordPrediction | null = null;
    let majorityCount = 0;

    counts.forEach((value, label) => {
        if (value.count > majorityCount) {
            majorityCount = value.count;
            majority = {
                label,
                labelIndex: value.labelIndex,
                confidence: value.confidence,
            };
        }
    });

    return majority && majorityCount >= WORD_SMOOTHING_WINDOW / 2 ? majority : null;
}

export default function DetectScreen() {
    const router = useRouter();
    const alphabetClassifierRef = useRef(globalAlphabetImageClassifier);
    const signClassifierRef = useRef(globalClassifier);
    const cameraRef = useRef<CameraProcessorRef>(null);
    const isFocused = useIsFocused();

    const [activeMode, setActiveMode] = useState<RecognitionMode>('word');
    const [detectedLabel, setDetectedLabel] = useState<FSLLabel | null>(null);
    const [confidence, setConfidence] = useState(0);
    const [showResult, setShowResult] = useState(false);
    const [status, setStatus] = useState('Paghahanda...');
    const [debugInfo, setDebugInfo] = useState('');
    const [performanceInfo, setPerformanceInfo] = useState('');
    const [isMirrored, setIsMirrored] = useState(true);
    const [isAlphabetModelReady, setIsAlphabetModelReady] = useState(false);
    const [isWordModelReady, setIsWordModelReady] = useState(() => globalClassifier.isFSLModelLoaded());
    const [alphabetLoadError, setAlphabetLoadError] = useState<string | null>(null);
    const [wordLoadError, setWordLoadError] = useState<string | null>(null);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const alphabetPredictionHistoryRef = useRef<string[]>([]);
    const lastEmittedAlphabetLabelRef = useRef<string | null>(null);
    const wordSequenceLengthRef = useRef(INITIAL_WORD_SEQUENCE_LENGTH);
    const wordFrameBufferRef = useRef<Float32Array[]>([]);
    const previousWordFrameRef = useRef<Float32Array | null>(null);
    const wordGestureMotionSeenRef = useRef(false);
    const wordStillFrameCountRef = useRef(0);
    const wordCompletedGestureProbeCountRef = useRef(0);
    const wordLastCompletedGestureProbeFrameRef = useRef(-Infinity);
    const wordFullWindowStartedRef = useRef(false);
    const wordResultLockedRef = useRef(false);
    const wordResultLockFrameCountRef = useRef(0);
    const wordResultLockStillFrameCountRef = useRef(0);
    const wordResultTransitionFramesRef = useRef<Float32Array[]>([]);
    const wordPredictionHistoryRef = useRef<WordPredictionHistoryItem[]>([]);
    const wordFrameCountRef = useRef(0);
    const wordInferenceLogCounterRef = useRef(0);
    const wordAttemptIdRef = useRef(0);
    const lastStableWordPredictionRef = useRef<StableWordPrediction | null>(null);
    const lastEmittedWordLabelRef = useRef<string | null>(null);
    const missingHandFrameCountRef = useRef(0);
    const lastDetectionRef = useRef<number>(0);
    const lastAlphabetInferenceRef = useRef<number>(0);
    const activeAlphabetRequestRef = useRef<number>(0);
    const alphabetRequestCounterRef = useRef<number>(0);
    const alphabetFrameTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const resultHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isAlphabetProcessingRef = useRef<boolean>(false);
    const isWordProcessingRef = useRef<boolean>(false);
    const processingAlphabetRequestRef = useRef<number>(0);
    const keypointLogCounterRef = useRef(0);

    const pulseDot = useRef(new Animated.Value(0.4)).current;
    const dotPattern = useMemo(() => Array.from({ length: 15 }).map((_, i) => (
        <View key={i} style={[styles.dot, { left: (i % 5) * 80 + 40, top: Math.floor(i / 5) * 80 + 40 }]} />
    )), []);

    const activeModelReady = activeMode === 'alphabet' ? isAlphabetModelReady : isWordModelReady;
    const activeModelError = activeMode === 'alphabet' ? alphabetLoadError : wordLoadError;
    const canDetect = isFocused && activeModelReady && isCameraReady && !activeModelError && !cameraError;
    const isLoadingDetection = !activeModelError && !cameraError && (!activeModelReady || !isCameraReady);
    const statusDotColor = activeModelError || cameraError || status.includes('Error') ?
        '#E57373' :
        status.includes('Walang') ? '#FF8A65' : '#5BC4B5';

    const cancelPendingAlphabetFrame = useCallback(() => {
        activeAlphabetRequestRef.current = 0;
        processingAlphabetRequestRef.current = 0;
        if (alphabetFrameTimeoutRef.current) {
            clearTimeout(alphabetFrameTimeoutRef.current);
            alphabetFrameTimeoutRef.current = null;
        }
    }, []);

    const clearAlphabetBuffers = useCallback(() => {
        lastEmittedAlphabetLabelRef.current = null;
        alphabetPredictionHistoryRef.current = [];
        cancelPendingAlphabetFrame();
    }, [cancelPendingAlphabetFrame]);

    const clearWordBuffers = useCallback(() => {
        wordAttemptIdRef.current += 1;
        wordFrameBufferRef.current = [];
        previousWordFrameRef.current = null;
        wordGestureMotionSeenRef.current = false;
        wordStillFrameCountRef.current = 0;
        wordCompletedGestureProbeCountRef.current = 0;
        wordLastCompletedGestureProbeFrameRef.current = -Infinity;
        wordFullWindowStartedRef.current = false;
        wordResultLockedRef.current = false;
        wordResultLockFrameCountRef.current = 0;
        wordResultLockStillFrameCountRef.current = 0;
        wordResultTransitionFramesRef.current = [];
        wordPredictionHistoryRef.current = [];
        wordFrameCountRef.current = 0;
        wordInferenceLogCounterRef.current = 0;
        lastStableWordPredictionRef.current = null;
        lastEmittedWordLabelRef.current = null;
        isWordProcessingRef.current = false;
    }, []);

    const keepResultVisible = useCallback((durationMs: number) => {
        if (resultHideTimeoutRef.current) {
            clearTimeout(resultHideTimeoutRef.current);
        }
        setShowResult(true);
        resultHideTimeoutRef.current = setTimeout(() => {
            setShowResult(false);
            resultHideTimeoutRef.current = null;
        }, durationMs);
    }, []);

    const resetWordPredictionState = useCallback(() => {
        // A confirmed hand gap marks the boundary between two signing attempts.
        // Discard every frame from the previous attempt so the next prediction
        // is built only from fresh frames belonging to the new gesture.
        wordAttemptIdRef.current += 1;
        wordFrameBufferRef.current = [];
        previousWordFrameRef.current = null;
        wordGestureMotionSeenRef.current = false;
        wordStillFrameCountRef.current = 0;
        wordCompletedGestureProbeCountRef.current = 0;
        wordLastCompletedGestureProbeFrameRef.current = -Infinity;
        wordFullWindowStartedRef.current = false;
        wordResultLockedRef.current = false;
        wordResultLockFrameCountRef.current = 0;
        wordResultLockStillFrameCountRef.current = 0;
        wordResultTransitionFramesRef.current = [];
        wordFrameCountRef.current = 0;
        wordPredictionHistoryRef.current = [];
        wordInferenceLogCounterRef.current = 0;
        lastStableWordPredictionRef.current = null;
        lastEmittedWordLabelRef.current = null;
    }, []);

    const switchRecognitionMode = useCallback((mode: RecognitionMode) => {
        if (mode === activeMode) return;
        console.log(`[Detect] Active recognition mode: ${mode}`);
        const nextError = mode === 'alphabet' ? alphabetLoadError : wordLoadError;
        setActiveMode(mode);
        setShowResult(false);
        setDetectedLabel(null);
        setPerformanceInfo('');
        clearAlphabetBuffers();
        clearWordBuffers();
        setDebugInfo(nextError
            ? `Mode: ${mode === 'alphabet' ? 'Alphabet' : 'Word'} | Err: ${nextError}`
            : `Mode: ${mode === 'alphabet' ? 'Alphabet' : 'Word'} | Ready`
        );
    }, [activeMode, alphabetLoadError, wordLoadError, clearAlphabetBuffers, clearWordBuffers]);

    useEffect(() => {
        if (!isFocused) {
            clearAlphabetBuffers();
            clearWordBuffers();
            missingHandFrameCountRef.current = 0;
        }
    }, [isFocused, clearAlphabetBuffers, clearWordBuffers]);

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
        let cancelled = false;

        const loadAlphabetModel = async () => {
            try {
                setAlphabetLoadError(null);
                setIsAlphabetModelReady(false);
                await alphabetClassifierRef.current.load();
                console.log('[Detect] Alphabet classifier loaded.');
                if (!cancelled) setIsAlphabetModelReady(true);
            } catch (error) {
                const message = modelErrorMessage('alphabet', error);
                console.warn('[Detect] Alphabet classifier unavailable:', error);
                if (!cancelled) {
                    setAlphabetLoadError(message);
                    setIsAlphabetModelReady(false);
                }
            }
        };

        const loadWordModel = async () => {
            try {
                setWordLoadError(null);
                if (!signClassifierRef.current.isFSLModelLoaded()) {
                    setIsWordModelReady(false);
                }
                await signClassifierRef.current.loadFSLModel();
                const sequenceLength = signClassifierRef.current.getSequenceLength();
                wordSequenceLengthRef.current = sequenceLength;
                console.log(
                    `[Detect] Word model input shape: [${signClassifierRef.current.getInputShape().join(', ')}], ` +
                    `MAX_SEQUENCE_LENGTH=${sequenceLength}`
                );
                console.log('[Detect] Word SignClassifier loaded.');
                if (!cancelled) setIsWordModelReady(true);
            } catch (error) {
                const message = modelErrorMessage('word', error);
                console.warn('[Detect] Word SignClassifier unavailable:', error);
                if (!cancelled) {
                    setWordLoadError(message);
                    setIsWordModelReady(false);
                }
            }
        };

        loadAlphabetModel();
        loadWordModel();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!isFocused) return;

        if (activeModelError) {
            setStatus(activeMode === 'alphabet' ? 'Alphabet model file is missing.' : 'Hindi ma-load ang word model.');
            setDebugInfo(`Mode: ${activeMode === 'alphabet' ? 'Alphabet' : 'Word'} | Err: ${activeModelError}`);
        } else if (cameraError) {
            setStatus('Hindi maihanda ang camera.');
        } else if (!activeModelReady) {
            setStatus(activeMode === 'alphabet' ? 'Nilo-load ang alphabet model...' : 'Nilo-load ang word model...');
        } else if (!isCameraReady) {
            setStatus('Binubuksan ang camera...');
        } else {
            setStatus(activeMode === 'alphabet' ? 'Handa na. Magpakita ng letra.' : 'Handa na. Magpakita ng salita.');
        }
    }, [isFocused, activeMode, activeModelReady, activeModelError, isCameraReady, cameraError]);

    useEffect(() => {
        return () => {
            if (alphabetFrameTimeoutRef.current) {
                clearTimeout(alphabetFrameTimeoutRef.current);
            }
            if (resultHideTimeoutRef.current) {
                clearTimeout(resultHideTimeoutRef.current);
            }
            stopDetectedSpeech();
        };
    }, []);

    const requestAlphabetFrame = useCallback((modeDebug: string) => {
        if (!canDetect || activeMode !== 'alphabet') return;

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
    }, [activeMode, canDetect, isMirrored]);

    const handleImageFrameCaptured = useCallback(async (frame: CameraImageFrame) => {
        if (!canDetect || activeMode !== 'alphabet') return;
        if (!frame.requestId || frame.requestId !== activeAlphabetRequestRef.current) return;

        if (alphabetFrameTimeoutRef.current) {
            clearTimeout(alphabetFrameTimeoutRef.current);
            alphabetFrameTimeoutRef.current = null;
        }
        activeAlphabetRequestRef.current = 0;
        isAlphabetProcessingRef.current = true;
        processingAlphabetRequestRef.current = frame.requestId;

        try {
            const inferenceStartedAt = Date.now();
            const result = await alphabetClassifierRef.current.classify(frame);
            const inferenceMs = Date.now() - inferenceStartedAt;
            if (processingAlphabetRequestRef.current !== frame.requestId) return;

            const alternativesDebug = result.alternatives
                .map(item => `${item.label}:${(item.confidence * 100).toFixed(0)}`)
                .join(' ');
            setDebugInfo(
                `Mode: Alphabet | ${alternativesDebug} | Gap:${(result.margin * 100).toFixed(0)} ` +
                `Capture:${frame.captureMs?.toFixed(0) ?? '?'}ms ` +
                `Bridge:${frame.bridgeMs?.toFixed(0) ?? '?'}ms Infer:${inferenceMs}ms`
            );

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

            const recentPredictions = alphabetPredictionHistoryRef.current.slice(-requiredRepeatCount);
            const hasConsecutiveConfirmation =
                recentPredictions.length === requiredRepeatCount &&
                recentPredictions.every(letter => letter === result.label);

            if (isQuickAccept || hasConsecutiveConfirmation) {
                // Continue checking frames so a different letter is recognized
                // immediately, but do not repeatedly announce the held letter.
                if (result.label === lastEmittedAlphabetLabelRef.current) {
                    alphabetPredictionHistoryRef.current = [];
                    return;
                }

                const label: FSLLabel = {
                    id: 200 + result.index,
                    english: result.label,
                    filipino: result.label,
                    category: 'ALPABETO'
                };

                setDetectedLabel(label);
                setConfidence(result.confidence);
                keepResultVisible(2000);
                setStatus(`${result.label} (${(result.confidence * 100).toFixed(0)}%)`);
                speakDetectedPrediction(result.label);
                lastDetectionRef.current = Date.now();
                lastEmittedAlphabetLabelRef.current = result.label;
                alphabetPredictionHistoryRef.current = [];
            }
        } catch (error) {
            const message = modelErrorMessage('alphabet', error);
            console.error('Alphabet Image Error:', error);
            setAlphabetLoadError(message);
            setIsAlphabetModelReady(false);
            setDebugInfo('Mode: Alphabet | Err: ' + message);
        } finally {
            if (processingAlphabetRequestRef.current === frame.requestId) {
                processingAlphabetRequestRef.current = 0;
            }
            isAlphabetProcessingRef.current = false;
        }
    }, [activeMode, canDetect, keepResultVisible]);

    const classifyWordSlidingWindow = useCallback(async (
        frames: Float32Array[],
        policy: WordInferencePolicy,
        observedFrameCount: number
    ) => {
        if (!canDetect || activeMode !== 'word') return;
        if (isWordProcessingRef.current) return;

        const attemptId = wordAttemptIdRef.current;
        isWordProcessingRef.current = true;
        if (!lastEmittedWordLabelRef.current) {
            setStatus('Sinusuri ang salita...');
        }

        try {
            const inferenceStartedAt = Date.now();
            const result = await signClassifierRef.current.classifyFSL(frames);
            const inferenceMs = Date.now() - inferenceStartedAt;
            // The hands may have disappeared while inference was running. An
            // answer from that old attempt must not overwrite the next one.
            if (attemptId !== wordAttemptIdRef.current) return;
            const inferenceLogIndex = ++wordInferenceLogCounterRef.current;
            const shouldLogInference = inferenceLogIndex <= 5 ||
                inferenceLogIndex % WORD_INFERENCE_LOG_INTERVAL === 0;

            let secondConfidence = 0;
            for (let index = 0; index < result.probabilities.length; index++) {
                if (index !== result.labelIndex) {
                    secondConfidence = Math.max(secondConfidence, result.probabilities[index]);
                }
            }
            const predictionMargin = result.confidence - secondConfidence;
            const deferredPartialThankYou =
                policy.source === 'completed' &&
                normalizeLabelKey(result.label) === 'THANK YOU' &&
                observedFrameCount < WORD_THANK_YOU_MIN_FRAMES;
            const acceptedPrediction: WordPredictionHistoryItem =
                !deferredPartialThankYou &&
                result.confidence >= policy.confidenceThreshold &&
                predictionMargin >= policy.marginThreshold
                ? {
                    label: result.label,
                    labelIndex: result.labelIndex,
                    confidence: result.confidence,
                }
                : null;

            if (!acceptedPrediction && shouldLogInference) {
                console.log(
                    `[Detect] Word ${policy.source} prediction rejected ` +
                    `(confidence>=${policy.confidenceThreshold}, margin>=${policy.marginThreshold}): ` +
                    `${result.label}:${result.confidence.toFixed(4)} ` +
                    `margin:${predictionMargin.toFixed(4)} source:${policy.source} ` +
                    `deferred:${deferredPartialThankYou}`
                );
            }

            wordPredictionHistoryRef.current.push(acceptedPrediction);
            if (wordPredictionHistoryRef.current.length > WORD_SMOOTHING_WINDOW) {
                wordPredictionHistoryRef.current.shift();
            }

            const stablePrediction = acceptedPrediction &&
                acceptedPrediction.confidence >= policy.quickAcceptThreshold
                ? acceptedPrediction
                : getMajorityWordPrediction(wordPredictionHistoryRef.current);
            if (stablePrediction) {
                lastStableWordPredictionRef.current = stablePrediction;
            }

            const lastStablePrediction = lastStableWordPredictionRef.current;
            const historyDebug = wordPredictionHistoryRef.current
                .map(item => item?.label ?? 'null')
                .join(',');

            const shouldEmitPrediction = !!stablePrediction &&
                stablePrediction.label !== lastEmittedWordLabelRef.current;

            if (shouldEmitPrediction && stablePrediction) {
                const displayLabel = createWordDisplayLabel(stablePrediction.label, stablePrediction.labelIndex);
                const filipinoText = formatFilipinoResult(displayLabel.filipino || displayLabel.english);
                setDetectedLabel({
                    ...displayLabel,
                    filipino: filipinoText,
                });
                setConfidence(stablePrediction.confidence);
                keepResultVisible(WORD_RESULT_VISIBLE_MS);
                setStatus(`${filipinoText} (${(stablePrediction.confidence * 100).toFixed(0)}%)`);
                speakDetectedPrediction(filipinoText);
                lastEmittedWordLabelRef.current = stablePrediction.label;
                wordResultLockedRef.current = true;
                wordResultLockFrameCountRef.current = 0;
                wordResultLockStillFrameCountRef.current = 0;
                wordResultTransitionFramesRef.current = [];
            }

            if (shouldLogInference || shouldEmitPrediction) {
                console.log(
                    `[Detect] Word sliding prediction: ${result.label} ` +
                    `(${result.confidence.toFixed(4)}) ` +
                    `stable:${lastStablePrediction?.label ?? 'none'} ` +
                    `emitted:${lastEmittedWordLabelRef.current ?? 'none'}`
                );
                setDebugInfo(
                    `Mode: Word | Pred:${result.label}:${(result.confidence * 100).toFixed(0)} ` +
                    `Stable:${lastStablePrediction?.label ?? 'none'} ` +
                    `Emitted:${lastEmittedWordLabelRef.current ?? 'none'} ` +
                    `Hist:${historyDebug} Gap:${(predictionMargin * 100).toFixed(0)} ` +
                    `Source:${policy.source} Frames:${observedFrameCount} ` +
                    `Deferred:${deferredPartialThankYou} Infer:${inferenceMs}ms Swap:${SWAP_HANDS_FOR_MIRROR}`
                );
            }
        } catch (error) {
            const message = modelErrorMessage('word', error);
            console.error('Word Sign Error:', error);
            setWordLoadError(message);
            setIsWordModelReady(false);
            setDebugInfo('Mode: Word | Err: ' + message);
        } finally {
            isWordProcessingRef.current = false;
        }
    }, [activeMode, canDetect, keepResultVisible]);

    const processWordKeypoints = useCallback(async (keypoints: Float32Array, handsDetected: boolean) => {
        if (!canDetect || activeMode !== 'word') return;

        keypointLogCounterRef.current += 1;
        const shouldLogWordFrame = keypointLogCounterRef.current <= 5 ||
            keypointLogCounterRef.current % WORD_DEBUG_LOG_INTERVAL === 0;
        const { leftVisible, rightVisible } = getWordHandVisibility(keypoints);
        if (shouldLogWordFrame) {
            console.log(`[Detect] incoming keypoints length: ${keypoints.length}`);
        }

        const wordFrame = convertLandmarkFrameToWordFrame(keypoints);
        if (!wordFrame) {
            setDebugInfo(`Mode: Word | Bad keypoints:${keypoints.length}`);
            return;
        }
        if (shouldLogWordFrame) {
            console.log(`[Detect] converted frame length: ${wordFrame.length}`);
        }

        const previousWordFrame = previousWordFrameRef.current;
        const handMotion = previousWordFrame
            ? calculateHandMotion(previousWordFrame, wordFrame)
            : 0;
        previousWordFrameRef.current = wordFrame;

        if (wordResultLockedRef.current) {
            if (!handsDetected || !previousWordFrame) return;

            wordResultLockFrameCountRef.current += 1;
            if (handMotion < WORD_HAND_MOTION_THRESHOLD) {
                wordResultLockStillFrameCountRef.current += 1;
                wordResultTransitionFramesRef.current = [];
                return;
            }

            // Keep the opening motion instead of throwing it away while the
            // previous result is visible. Those frames distinguish the next
            // sign and are especially important when signs are back-to-back.
            wordResultTransitionFramesRef.current.push(wordFrame);

            const signerPausedAfterResult =
                wordResultLockStillFrameCountRef.current >= WORD_RESULT_REARM_STILL_FRAMES;
            const transitionHasClearlyStarted =
                wordResultTransitionFramesRef.current.length >= WORD_RESULT_REARM_MOTION_FRAMES;
            if (!signerPausedAfterResult && !transitionHasClearlyStarted) return;

            // A new motion phase starts a fresh signing attempt. Seed it with
            // every transition frame except the current one, which the common
            // buffer path below will append exactly once.
            const transitionFrames = wordResultTransitionFramesRef.current;
            wordAttemptIdRef.current += 1;
            wordFrameBufferRef.current = transitionFrames.slice(0, -1);
            wordPredictionHistoryRef.current = [];
            wordFrameCountRef.current = wordFrameBufferRef.current.length;
            wordInferenceLogCounterRef.current = 0;
            lastStableWordPredictionRef.current = null;
            lastEmittedWordLabelRef.current = null;
            wordGestureMotionSeenRef.current = true;
            wordStillFrameCountRef.current = 0;
            wordCompletedGestureProbeCountRef.current = 0;
            wordLastCompletedGestureProbeFrameRef.current = -Infinity;
            wordFullWindowStartedRef.current = false;
            wordResultLockedRef.current = false;
            wordResultLockFrameCountRef.current = 0;
            wordResultLockStillFrameCountRef.current = 0;
            wordResultTransitionFramesRef.current = [];
            setShowResult(false);
        }

        if (handsDetected && previousWordFrame) {
            if (handMotion >= WORD_HAND_MOTION_THRESHOLD) {
                if (wordCompletedGestureProbeCountRef.current > 0) {
                    // Motion resumed after an early probe, so predictions from
                    // that incomplete endpoint must not stabilize a later one.
                    wordPredictionHistoryRef.current = [];
                    lastStableWordPredictionRef.current = null;
                }
                wordGestureMotionSeenRef.current = true;
                wordStillFrameCountRef.current = 0;
                wordCompletedGestureProbeCountRef.current = 0;
                wordLastCompletedGestureProbeFrameRef.current = -Infinity;
            } else if (wordGestureMotionSeenRef.current) {
                wordStillFrameCountRef.current += 1;
            }
        }

        const sequenceLength = wordSequenceLengthRef.current;
        wordFrameBufferRef.current.push(wordFrame);
        if (!wordGestureMotionSeenRef.current) {
            // Hands can be visible for a long time while the signer prepares.
            // Keep only a tiny lead-in so idle/setup frames do not dominate the
            // model input or make the actual gesture arrive too late.
            while (wordFrameBufferRef.current.length > WORD_GESTURE_PRE_ROLL_FRAMES) {
                wordFrameBufferRef.current.shift();
            }
            wordFrameCountRef.current = wordFrameBufferRef.current.length;
        } else {
            while (wordFrameBufferRef.current.length > sequenceLength) {
                wordFrameBufferRef.current.shift();
            }
            wordFrameCountRef.current += 1;
        }

        const bufferLength = wordFrameBufferRef.current.length;
        const lastStablePrediction = lastStableWordPredictionRef.current;
        if (shouldLogWordFrame) {
            console.log(`[Detect] frameBuffer length: ${bufferLength}/${sequenceLength}`);
            setDebugInfo(
                `Mode: Word | LH:${leftVisible} RH:${rightVisible} ` +
                `Buffer:${bufferLength}/${sequenceLength} ` +
                `Frame:${wordFrameCountRef.current} Motion:${handMotion.toFixed(4)} ` +
                `Still:${wordStillFrameCountRef.current} ` +
                `Probe:${wordCompletedGestureProbeCountRef.current}/${WORD_COMPLETED_GESTURE_MAX_PROBES} ` +
                `Stable:${lastStablePrediction?.label ?? 'none'}`
            );
        }

        if (!handsDetected) return;
        const hasCompleteWindow = bufferLength === sequenceLength;
        if (hasCompleteWindow && !wordFullWindowStartedRef.current) {
            // Early padded probes use a stricter but different input shape in
            // time. Never let their history vote on the first true 30-frame
            // window if early recognition did not succeed.
            wordFullWindowStartedRef.current = true;
            wordPredictionHistoryRef.current = [];
            lastStableWordPredictionRef.current = null;
        }
        const completedGestureProbeDue =
            wordFrameCountRef.current - wordLastCompletedGestureProbeFrameRef.current >=
            WORD_COMPLETED_GESTURE_PROBE_STRIDE;
        const hasCompletedGesture =
            bufferLength >= Math.min(WORD_GESTURE_MIN_FRAMES, sequenceLength) &&
            wordGestureMotionSeenRef.current &&
            wordStillFrameCountRef.current >= WORD_GESTURE_END_STILL_FRAMES &&
            wordCompletedGestureProbeCountRef.current < WORD_COMPLETED_GESTURE_MAX_PROBES &&
            completedGestureProbeDue;
        if (!hasCompleteWindow && !hasCompletedGesture) return;
        if (wordFrameCountRef.current % WORD_PREDICTION_STRIDE !== 0) return;
        if (isWordProcessingRef.current) {
            setDebugInfo(
                `Mode: Word | Processing | Buffer:${bufferLength}/${sequenceLength} ` +
                `Stable:${lastStablePrediction?.label ?? 'none'}`
            );
            return;
        }

        // A completed short gesture is distributed across the 30-frame input
        // so its motion is not drowned out by copies of the final pose.
        const frames = hasCompleteWindow
            ? wordFrameBufferRef.current.slice()
            : resampleCompletedGesture(wordFrameBufferRef.current, sequenceLength);
        if (!hasCompleteWindow) {
            wordCompletedGestureProbeCountRef.current += 1;
            wordLastCompletedGestureProbeFrameRef.current = wordFrameCountRef.current;
        }
        await classifyWordSlidingWindow(
            frames,
            hasCompleteWindow ? FULL_WORD_INFERENCE_POLICY : COMPLETED_WORD_INFERENCE_POLICY,
            bufferLength
        );
    }, [activeMode, canDetect, classifyWordSlidingWindow]);

    const handleHandsMissing = useCallback(() => {
        missingHandFrameCountRef.current += 1;
        if (missingHandFrameCountRef.current < NO_HANDS_GRACE_FRAMES) return;
        if (missingHandFrameCountRef.current > NO_HANDS_GRACE_FRAMES) return;

        setStatus('Walang kamay na nakita.');
        if (activeMode === 'word') {
            resetWordPredictionState();
            setShowResult(false);
            setDebugInfo(
                `Mode: Word | No hands | Buffer:${wordFrameBufferRef.current.length}/${wordSequenceLengthRef.current} Stable:none Emitted:none`
            );
            return;
        }

        clearAlphabetBuffers();
    }, [activeMode, clearAlphabetBuffers, resetWordPredictionState]);

    const handleKeypointsExtracted = useCallback(async (
        keypoints: Float32Array | 'hands-detected' | 'no-hands'
    ) => {
        if (!canDetect) return;
        if (keypoints === 'no-hands') {
            handleHandsMissing();
            return;
        }

        if (keypoints === 'hands-detected') {
            missingHandFrameCountRef.current = 0;
            if (activeMode === 'alphabet' && Date.now() - lastDetectionRef.current >= DETECTION_COOLDOWN_MS) {
                requestAlphabetFrame('Hand detected');
            }
            return;
        }

        const { leftVisible, rightVisible } = getWordHandVisibility(keypoints);
        const handsDetected = leftVisible || rightVisible;

        if (activeMode === 'word') {
            const shouldLogWordVisibility = keypointLogCounterRef.current <= 5 ||
                keypointLogCounterRef.current % WORD_DEBUG_LOG_INTERVAL === 0;
            if (shouldLogWordVisibility) {
                console.log(
                    `[Detect] Word visibility keypoints:${keypoints.length} ` +
                    `LH:${leftVisible} RH:${rightVisible}`
                );
            }

            if (!handsDetected) {
                handleHandsMissing();
                // Keep very brief tracking dropouts inside an active gesture,
                // but never refill a reset buffer with handless frames.
                if (missingHandFrameCountRef.current < NO_HANDS_GRACE_FRAMES) {
                    await processWordKeypoints(keypoints, false);
                }
                return;
            }

            missingHandFrameCountRef.current = 0;
            await processWordKeypoints(keypoints, true);
            return;
        }

        if (!handsDetected) {
            handleHandsMissing();
            return;
        }

        missingHandFrameCountRef.current = 0;

        const now = Date.now();
        if (now - lastDetectionRef.current < DETECTION_COOLDOWN_MS) return;

        requestAlphabetFrame('Hand detected');
    }, [activeMode, canDetect, requestAlphabetFrame, handleHandsMissing, processWordKeypoints]);

    const handleCameraReady = useCallback(() => {
        setCameraError(null);
        setIsCameraReady(true);
    }, []);

    const handleCameraPerformance = useCallback((metrics: CameraPerformanceMetrics) => {
        setPerformanceInfo(
            `${metrics.mode === 'word' ? 'Pose+Hands' : 'Hands'}:` +
            `${metrics.processedFps.toFixed(1)}fps ` +
            `MP:${metrics.averageMediaPipeMs.toFixed(0)}ms ` +
            `Bridge:${metrics.bridgeMs?.toFixed(0) ?? '?'}ms ` +
            `Batch:${metrics.bridgeBatchSize}`
        );
    }, []);

    const handleCameraIssue = useCallback((message: string) => {
        const normalizedMessage = message.toLowerCase();
        const isStartupDelay =
            normalizedMessage.includes('still starting') ||
            normalizedMessage.includes('not ready yet');

        if (isStartupDelay) {
            if (!isCameraReady) setStatus('Binubuksan ang camera...');
            return;
        }

        if (
            normalizedMessage.includes('permission') ||
            normalizedMessage.includes('init failed') ||
            normalizedMessage.includes('denied') ||
            normalizedMessage.includes('failed')
        ) {
            setCameraError(message);
            setIsCameraReady(false);
            return;
        }

        setDebugInfo(`Camera: ${message}`);
    }, [isCameraReady]);

    return (
        <View style={styles.container}>
            <View style={styles.topHalf}>
                <CameraProcessor
                    ref={cameraRef}
                    style={styles.camera}
                    onKeypointsExtracted={handleKeypointsExtracted}
                    onImageFrameCaptured={handleImageFrameCaptured}
                    onPerformance={handleCameraPerformance}
                    onReady={handleCameraReady}
                    onError={handleCameraIssue}
                    active={isFocused}
                    recognitionMode={activeMode}
                />
                {!canDetect && (
                    <View style={styles.readinessOverlay}>
                        {isLoadingDetection ? (
                            <ActivityIndicator size="small" color="#5BC4B5" />
                        ) : (
                            <MaterialIcons name="error-outline" size={24} color="#E57373" />
                        )}
                        <Text style={[
                            styles.readinessText,
                            !isLoadingDetection && styles.readinessErrorText
                        ]}>
                            {status}
                        </Text>
                    </View>
                )}
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
                            backgroundColor: statusDotColor
                        }
                    ]} />
                    <Text style={styles.statusText}>{status}</Text>
                </View>

                {!!(debugInfo || performanceInfo) && (
                    <View style={styles.debugPanel}>
                        <Text style={styles.debugText}>{debugInfo}</Text>
                        {!!performanceInfo && <Text style={styles.debugText}>{performanceInfo}</Text>}
                    </View>
                )}

                <ResultOverlay label={detectedLabel} confidence={confidence} visible={showResult} />

                <View style={styles.dotPattern}>
                    {dotPattern}
                </View>

                <View style={styles.modeToggle}>
                    <TouchableOpacity
                        style={[styles.modeButton, activeMode === 'alphabet' && styles.modeButtonActive]}
                        onPress={() => switchRecognitionMode('alphabet')}
                    >
                        <MaterialIcons
                            name="sort-by-alpha"
                            size={17}
                            color={activeMode === 'alphabet' ? '#FFFFFF' : '#5BC4B5'}
                        />
                        <Text style={[styles.modeText, activeMode === 'alphabet' && styles.modeTextActive]}>
                            Alphabet
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.modeButton, activeMode === 'word' && styles.modeButtonActive]}
                        onPress={() => switchRecognitionMode('word')}
                    >
                        <MaterialIcons
                            name="gesture"
                            size={17}
                            color={activeMode === 'word' ? '#FFFFFF' : '#5BC4B5'}
                        />
                        <Text style={[styles.modeText, activeMode === 'word' && styles.modeTextActive]}>
                            Word
                        </Text>
                    </TouchableOpacity>
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
    readinessOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(10, 10, 10, 0.72)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        zIndex: 8,
    },
    readinessText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '700',
        marginTop: 12,
        textAlign: 'center',
        lineHeight: 18,
    },
    readinessErrorText: {
        color: '#FFCDD2',
    },
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
        maxWidth: '88%',
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
        flexShrink: 1,
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
        maxWidth: '88%',
    },
    debugText: {
        color: '#7A7A9D',
        fontSize: 10,
        fontFamily: 'monospace',
    },
    modeToggle: {
        position: 'absolute',
        bottom: 30,
        left: 20,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: '#A8E6CF',
        padding: 3,
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 3,
    },
    modeButton: {
        height: 34,
        minWidth: 84,
        borderRadius: 17,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    modeButtonActive: {
        backgroundColor: '#5BC4B5',
    },
    modeText: {
        color: '#2B9C8E',
        marginLeft: 5,
        fontSize: 11,
        fontWeight: 'bold',
        letterSpacing: 0.4,
    },
    modeTextActive: {
        color: '#FFFFFF',
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
