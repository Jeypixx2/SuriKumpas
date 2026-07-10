import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import CameraProcessor, { CameraImageFrame, CameraProcessorRef } from '../../components/CameraProcessor';
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

// Aligned with Pose-Face-LH-RH order:
// Pose: 0..131, Face: 132..1535, LH: 1536..1598, RH: 1599..1661
const POSE_START = 0;
const POSE_SIZE = 132;
const LH_START = 1536;
const RH_START = 1599;
const HAND_SIZE = 63;
const HOLISTIC_FRAME_SIZE = 1662;
const WORD_FRAME_SIZE = POSE_SIZE + HAND_SIZE + HAND_SIZE;
const INITIAL_WORD_SEQUENCE_LENGTH = 30;
const WORD_CONFIDENCE_THRESHOLD = 0.75;
const WORD_SMOOTHING_WINDOW = 5;
const WORD_PREDICTION_STRIDE = 2;
const WORD_RESULT_VISIBLE_MS = 2000;
const WORD_DEBUG_LOG_INTERVAL = 15;
const WORD_INFERENCE_LOG_INTERVAL = 10;

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
const SWAP_HANDS_FOR_MIRROR = false;

function normalizeLabelKey(value: string): string {
    return value.replace(/[_-]+/g, ' ').trim().toUpperCase();
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

function hasAnyNonZero(values: Float32Array): boolean {
    for (let i = 0; i < values.length; i++) {
        if (values[i] !== 0) return true;
    }
    return false;
}

function getWordHandVisibility(keypoints: Float32Array): { leftVisible: boolean; rightVisible: boolean } {
    return {
        leftVisible: hasAnyNonZero(keypoints.slice(LH_START, LH_START + HAND_SIZE)),
        rightVisible: hasAnyNonZero(keypoints.slice(RH_START, RH_START + HAND_SIZE)),
    };
}

function convertHolisticFrameToWordFrame(keypoints: Float32Array): Float32Array | null {
    if (keypoints.length !== HOLISTIC_FRAME_SIZE) {
        console.warn(`[Detect] Expected ${HOLISTIC_FRAME_SIZE} MediaPipe keypoints, got ${keypoints.length}.`);
        return null;
    }

    const pose = keypoints.slice(POSE_START, POSE_START + POSE_SIZE);
    const leftHand = keypoints.slice(LH_START, LH_START + HAND_SIZE);
    const rightHand = keypoints.slice(RH_START, RH_START + HAND_SIZE);
    const wordFrame = new Float32Array(WORD_FRAME_SIZE);

    wordFrame.set(pose, 0);
    if (SWAP_HANDS_FOR_MIRROR) {
        wordFrame.set(rightHand, POSE_SIZE);
        wordFrame.set(leftHand, POSE_SIZE + HAND_SIZE);
    } else {
        wordFrame.set(leftHand, POSE_SIZE);
        wordFrame.set(rightHand, POSE_SIZE + HAND_SIZE);
    }

    return wordFrame;
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

    const [activeMode, setActiveMode] = useState<RecognitionMode>('alphabet');
    const [detectedLabel, setDetectedLabel] = useState<FSLLabel | null>(null);
    const [confidence, setConfidence] = useState(0);
    const [showResult, setShowResult] = useState(false);
    const [status, setStatus] = useState('Paghahanda...');
    const [debugInfo, setDebugInfo] = useState('');
    const [isMirrored, setIsMirrored] = useState(true);
    const [isAlphabetModelReady, setIsAlphabetModelReady] = useState(false);
    const [isWordModelReady, setIsWordModelReady] = useState(false);
    const [alphabetLoadError, setAlphabetLoadError] = useState<string | null>(null);
    const [wordLoadError, setWordLoadError] = useState<string | null>(null);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const alphabetPredictionHistoryRef = useRef<string[]>([]);
    const wordSequenceLengthRef = useRef(INITIAL_WORD_SEQUENCE_LENGTH);
    const wordFrameBufferRef = useRef<Float32Array[]>([]);
    const wordPredictionHistoryRef = useRef<WordPredictionHistoryItem[]>([]);
    const wordFrameCountRef = useRef(0);
    const wordInferenceLogCounterRef = useRef(0);
    const lastStableWordPredictionRef = useRef<StableWordPrediction | null>(null);
    const lastEmittedWordLabelRef = useRef<string | null>(null);
    const missingHandFrameCountRef = useRef(0);
    const lastDetectionRef = useRef<number>(0);
    const lastAlphabetInferenceRef = useRef<number>(0);
    const activeAlphabetRequestRef = useRef<number>(0);
    const alphabetRequestCounterRef = useRef<number>(0);
    const alphabetFrameTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
        alphabetPredictionHistoryRef.current = [];
        cancelPendingAlphabetFrame();
    }, [cancelPendingAlphabetFrame]);

    const clearWordBuffers = useCallback(() => {
        wordFrameBufferRef.current = [];
        wordPredictionHistoryRef.current = [];
        wordFrameCountRef.current = 0;
        wordInferenceLogCounterRef.current = 0;
        lastStableWordPredictionRef.current = null;
        lastEmittedWordLabelRef.current = null;
        isWordProcessingRef.current = false;
    }, []);

    const resetWordPredictionState = useCallback(() => {
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
                setIsWordModelReady(false);
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
    }, [activeMode, canDetect]);

    const classifyWordSlidingWindow = useCallback(async (frames: Float32Array[]) => {
        if (!canDetect || activeMode !== 'word') return;
        if (isWordProcessingRef.current) return;

        isWordProcessingRef.current = true;
        if (!lastEmittedWordLabelRef.current) {
            setStatus('Sinusuri ang salita...');
        }

        try {
            const result = await signClassifierRef.current.classifyFSL(frames);
            const inferenceLogIndex = ++wordInferenceLogCounterRef.current;
            const shouldLogInference = inferenceLogIndex <= 5 ||
                inferenceLogIndex % WORD_INFERENCE_LOG_INTERVAL === 0;

            const acceptedPrediction: WordPredictionHistoryItem = result.confidence >= WORD_CONFIDENCE_THRESHOLD
                ? {
                    label: result.label,
                    labelIndex: result.labelIndex,
                    confidence: result.confidence,
                }
                : null;

            if (!acceptedPrediction && shouldLogInference) {
                console.log(
                    `[Detect] Word confidence below threshold ${WORD_CONFIDENCE_THRESHOLD}: ` +
                    `${result.label}:${result.confidence.toFixed(4)}`
                );
            }

            wordPredictionHistoryRef.current.push(acceptedPrediction);
            if (wordPredictionHistoryRef.current.length > WORD_SMOOTHING_WINDOW) {
                wordPredictionHistoryRef.current.shift();
            }

            const stablePrediction = getMajorityWordPrediction(wordPredictionHistoryRef.current);
            if (stablePrediction) {
                lastStableWordPredictionRef.current = stablePrediction;
            }

            const lastStablePrediction = lastStableWordPredictionRef.current;
            const historyDebug = wordPredictionHistoryRef.current
                .map(item => item?.label ?? 'null')
                .join(',');

            const shouldEmitPrediction = !!stablePrediction && !lastEmittedWordLabelRef.current;

            if (shouldEmitPrediction && stablePrediction) {
                const displayLabel = createWordDisplayLabel(stablePrediction.label, stablePrediction.labelIndex);
                setDetectedLabel(displayLabel);
                setConfidence(stablePrediction.confidence);
                setShowResult(true);
                setStatus(`${displayLabel.english} (${(stablePrediction.confidence * 100).toFixed(0)}%)`);
                cameraRef.current?.speak(displayLabel.filipino || displayLabel.english, 'fil-PH');
                lastEmittedWordLabelRef.current = stablePrediction.label;
                setTimeout(() => setShowResult(false), WORD_RESULT_VISIBLE_MS);
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
                    `Hist:${historyDebug} Swap:${SWAP_HANDS_FOR_MIRROR}`
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
    }, [activeMode, canDetect]);

    const processWordKeypoints = useCallback(async (keypoints: Float32Array, handsDetected: boolean) => {
        if (!canDetect || activeMode !== 'word') return;

        keypointLogCounterRef.current += 1;
        const shouldLogWordFrame = keypointLogCounterRef.current <= 5 ||
            keypointLogCounterRef.current % WORD_DEBUG_LOG_INTERVAL === 0;
        const { leftVisible, rightVisible } = getWordHandVisibility(keypoints);
        if (shouldLogWordFrame) {
            console.log(`[Detect] incoming keypoints length: ${keypoints.length}`);
        }

        const wordFrame = convertHolisticFrameToWordFrame(keypoints);
        if (!wordFrame) {
            setDebugInfo(`Mode: Word | Bad keypoints:${keypoints.length}`);
            return;
        }
        if (shouldLogWordFrame) {
            console.log(`[Detect] converted frame length: ${wordFrame.length}`);
        }

        const sequenceLength = wordSequenceLengthRef.current;
        wordFrameBufferRef.current.push(wordFrame);
        while (wordFrameBufferRef.current.length > sequenceLength) {
            wordFrameBufferRef.current.shift();
        }

        wordFrameCountRef.current += 1;
        const bufferLength = wordFrameBufferRef.current.length;
        const lastStablePrediction = lastStableWordPredictionRef.current;
        if (shouldLogWordFrame) {
            console.log(`[Detect] frameBuffer length: ${bufferLength}/${sequenceLength}`);
            setDebugInfo(
                `Mode: Word | LH:${leftVisible} RH:${rightVisible} ` +
                `Buffer:${bufferLength}/${sequenceLength} ` +
                `Frame:${wordFrameCountRef.current} Stable:${lastStablePrediction?.label ?? 'none'}`
            );
        }

        if (!handsDetected) return;
        if (bufferLength !== sequenceLength) return;
        if (wordFrameCountRef.current % WORD_PREDICTION_STRIDE !== 0) return;
        if (isWordProcessingRef.current) {
            setDebugInfo(
                `Mode: Word | Processing | Buffer:${bufferLength}/${sequenceLength} ` +
                `Stable:${lastStablePrediction?.label ?? 'none'}`
            );
            return;
        }

        const frames = wordFrameBufferRef.current.map(frame => new Float32Array(frame));
        await classifyWordSlidingWindow(frames);
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

    const handleKeypointsExtracted = useCallback(async (keypoints: Float32Array | 'no-hands') => {
        if (!canDetect) return;
        if (keypoints === 'no-hands') {
            handleHandsMissing();
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
                await processWordKeypoints(keypoints, false);
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
                    onReady={handleCameraReady}
                    onError={handleCameraIssue}
                    active={isFocused}
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

                {!!debugInfo && (
                    <View style={styles.debugPanel}>
                        <Text style={styles.debugText}>{debugInfo}</Text>
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
