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
import { FSLLabel, FSL_LABELS, tokenizeSentence } from '../../lib/labels';
import Voice, { SpeechEndEvent, SpeechResultsEvent, SpeechErrorEvent } from '@dev-amirzubair/react-native-voice';
import { useAvatarContext } from '../../lib/AvatarContext';
import MicButton from '../../components/MicButton';

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

export type ConversationMessage = {
    id: string;
    role: 'deaf' | 'hearing';
    text: string;
};

// Compact camera bridge payload aligned with the word model: Pose-LH-RH.
// Pose: 0..131, LH: 132..194, RH: 195..257
const POSE_START = 0;
const POSE_SIZE = 132;
const LH_START = 132;
const RH_START = 195;
const HAND_SIZE = 63;
const WORD_FRAME_SIZE = POSE_SIZE + HAND_SIZE + HAND_SIZE;
const INITIAL_WORD_SEQUENCE_LENGTH = 30;
const WORD_HAND_MOTION_THRESHOLD = 0.006;
const WORD_GESTURE_PRE_ROLL_FRAMES = 3;
const WORD_RESULT_VISIBLE_MS = 2500;
const WORD_DEBUG_LOG_INTERVAL = 15;

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

const normalizeSpeechText = (text: string): string => {
    let s = text.trim().replace(/\s+/g, ' ').toUpperCase();
    if (s === 'MAGANDANG' || s === 'MAGANDA' || s === 'UMAGA') s = 'MAGANDANG UMAGA';
    if (s === 'MAGANDANG GABI' || s === 'GABI') s = 'MAGANDANG GABI';
    if (s === 'MAGANDANG HAPON' || s === 'HAPON') s = 'MAGANDANG HAPON';
    if (s === 'KAMUSTA' || s === 'KUMUSTA') s = 'KAMUSTA KA';
    if (s === 'ANO ANG PANGALAN' || s === 'ANO PANGALAN MO' || s === 'ANO ANG PANGALAN') s = 'ANO ANG PANGALAN MO';
    if (s === 'MABUTI NAMAN' || s === 'MABUTI') s = 'MABUTI NAMAN AKO';
    if (s === 'HINDI KO MAINTINDIHAN' || s === 'HINDI MAINTINDIHAN') s = 'HINDI KO MAINTINDIHAN';
    if (s === 'HINDI KO ALAM' || s === 'HINDI ALAM') s = 'HINDI KO ALAM';
    if (s === 'WALANG ANUMAN') s = 'WALANG ANUMAN';
    if (s === 'KITA TAYO BUKAS' || s === 'KITA BUKAS') s = 'KITA TAYO BUKAS';
    if (s === 'IKINAGAGALAK KITANG MAKILALA' || s === 'NICE TO MEET') s = 'NICE TO MEET YOU';
    return s;
};
const NO_HANDS_GRACE_FRAMES = 3;
const SWAP_HANDS_FOR_MIRROR = false;

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

    return Array.from({ length: targetLength }, (_, targetIndex) => {
        const sourcePosition = targetIndex * (frames.length - 1) / (targetLength - 1);
        return frames[Math.round(sourcePosition)];
    });
}

export default function MainScreen() {
    const PAUSE_SILENCE_MS = 1200;
    const router = useRouter();
    const [isListening, setIsListening] = useState(false);
    const [isAutoListening, setIsAutoListening] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const {
        setSignToPlay, setLetterToPlay, sequenceToPlay, setSequenceToPlay
    } = useAvatarContext();
    const [voiceErrorMessage, setVoiceErrorMessage] = useState<string | null>(null);
    const voiceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const pauseTimerRef = useRef<NodeJS.Timeout | null>(null);
    const autoRestartTimerRef = useRef<NodeJS.Timeout | null>(null);
    const latestSpeechRef = useRef('');
    const speechSessionFinalizedRef = useRef(false);
    const lastQueuedSpeechRef = useRef('');
    const isVoiceStartingRef = useRef(false);
    const isStoppingVoiceRef = useRef(false);
    const isTtsSpeakingRef = useRef(false);
    const speechRequestIdRef = useRef(0);

    const speakAndLogSign = useCallback((_text: string, filipinoText: string) => {
        const normalizedText = filipinoText.trim();
        if (!normalizedText) return;

        const requestId = ++speechRequestIdRef.current;
        void Speech.stop().then(() => {
            if (requestId !== speechRequestIdRef.current) return;
            Speech.speak(normalizedText, {
                language: 'fil-PH',
                rate: 0.85,
                pitch: 1,
                onStart: () => { isTtsSpeakingRef.current = true; },
                onDone: () => { isTtsSpeakingRef.current = false; },
                onStopped: () => { isTtsSpeakingRef.current = false; },
                onError: (error) => {
                    isTtsSpeakingRef.current = false;
                    console.warn('[Detect] Text-to-speech error:', error);
                },
            });
        }).catch(error => {
            console.warn('[Detect] Could not start speech:', error);
        });
    }, []);

    const stopDetectedSpeech = useCallback(() => {
        speechRequestIdRef.current += 1;
        isTtsSpeakingRef.current = false;
        void Speech.stop().catch(error => {
            console.warn('[Detect] Could not stop speech:', error);
        });
    }, []);

    const clearPauseTimer = useCallback(() => {
        if (pauseTimerRef.current) {
            clearTimeout(pauseTimerRef.current);
            pauseTimerRef.current = null;
        }
    }, []);

    const clearAutoRestartTimer = useCallback(() => {
        if (autoRestartTimerRef.current) {
            clearTimeout(autoRestartTimerRef.current);
            autoRestartTimerRef.current = null;
        }
    }, []);

    const queueSpeechForSigning = useCallback((rawText: string) => {
        const text = normalizeSpeechText(rawText);
        if (!text) return;

        setRecognizedText(text);

        const sequence = tokenizeSentence(text);
        if (sequence.length > 0) {
            setSequenceToPlay(sequence);
            setSignToPlay(null);
            setLetterToPlay(null);
            lastQueuedSpeechRef.current = text;
        } else {
            setSequenceToPlay(null);
            setSignToPlay(null);
            setLetterToPlay(null);
            lastQueuedSpeechRef.current = '';

            if (voiceTimeoutRef.current) {
                clearTimeout(voiceTimeoutRef.current);
            }
            voiceTimeoutRef.current = setTimeout(() => {
                setVoiceErrorMessage(null);
            }, 3000);
        }
    }, [setSequenceToPlay, setSignToPlay, setLetterToPlay]);

    const finalizeSpeechSession = useCallback((rawText?: string) => {
        clearPauseTimer();
        if (speechSessionFinalizedRef.current) return;

        const text = normalizeSpeechText(rawText || latestSpeechRef.current);
        if (!text) return;

        speechSessionFinalizedRef.current = true;
        queueSpeechForSigning(text);
    }, [clearPauseTimer, queueSpeechForSigning]);

    const resetPauseTimer = useCallback(() => {
        clearPauseTimer();
        pauseTimerRef.current = setTimeout(() => {
            finalizeSpeechSession();
        }, PAUSE_SILENCE_MS);
    }, [clearPauseTimer, finalizeSpeechSession]);

    const startContinuousListening = useCallback(async () => {
        if (!Voice || isVoiceStartingRef.current) return;
        isVoiceStartingRef.current = true;
        clearAutoRestartTimer();
        clearPauseTimer();

        try {
            latestSpeechRef.current = '';
            setRecognizedText('');
            speechSessionFinalizedRef.current = false;

            isStoppingVoiceRef.current = true;
            await Voice.stop().catch(() => {});
            await Voice.cancel().catch(() => {});
            isStoppingVoiceRef.current = false;

            await Voice.start('fil-PH');
            setIsListening(true);
            setVoiceErrorMessage(null);
        } catch (error) {
            isStoppingVoiceRef.current = false;
            setIsListening(false);
            console.warn('[Voice] Start listening error:', error);
        } finally {
            isVoiceStartingRef.current = false;
        }
    }, [clearPauseTimer, clearAutoRestartTimer]);

    const stopListening = useCallback(async () => {
        if (!Voice) return;
        try {
            isStoppingVoiceRef.current = true;
            await Voice.stop().catch(() => {});
            await Voice.cancel().catch(() => {});
            setIsListening(false);
            if (latestSpeechRef.current && !speechSessionFinalizedRef.current) {
                finalizeSpeechSession();
            }
        } catch (error) {
            console.warn('[Voice] Stop listening error:', error);
        } finally {
            isStoppingVoiceRef.current = false;
        }
    }, [finalizeSpeechSession]);

    const scheduleAutoRestart = useCallback((delayMs = 400) => {
        clearAutoRestartTimer();
        if (!isAutoListening || isVoiceStartingRef.current) return;
        autoRestartTimerRef.current = setTimeout(() => {
            startContinuousListening();
        }, delayMs);
    }, [clearAutoRestartTimer, isAutoListening, startContinuousListening]);

    const onSpeechStart = useCallback((_e: any) => {
        setIsListening(true);
        setVoiceErrorMessage(null);
    }, []);

    const onSpeechPartialResults = useCallback((e: SpeechResultsEvent) => {
        if (isTtsSpeakingRef.current) return;
        const text = normalizeSpeechText(e.value?.[0] || '');
        if (!text) return;

        latestSpeechRef.current = text;
        setRecognizedText(text);
        speechSessionFinalizedRef.current = false;
        resetPauseTimer();
    }, [resetPauseTimer]);

    const onSpeechResults = useCallback((e: SpeechResultsEvent) => {
        if (isTtsSpeakingRef.current) return;
        const text = normalizeSpeechText(e.value?.[0] || latestSpeechRef.current);
        if (text) latestSpeechRef.current = text;
        setIsListening(false);
        finalizeSpeechSession(text);
        if (isAutoListening) scheduleAutoRestart();
    }, [finalizeSpeechSession, scheduleAutoRestart, isAutoListening]);

    const onSpeechEnd = useCallback((_e: SpeechEndEvent) => {
        setIsListening(false);
        setTimeout(() => {
            if (latestSpeechRef.current && !speechSessionFinalizedRef.current) {
                finalizeSpeechSession();
            }
            if (isAutoListening) scheduleAutoRestart();
        }, 600);
    }, [finalizeSpeechSession, scheduleAutoRestart, isAutoListening]);

    const onSpeechError = useCallback((e: SpeechErrorEvent) => {
        setIsListening(false);

        if (isStoppingVoiceRef.current) {
            return;
        }

        if (latestSpeechRef.current && !speechSessionFinalizedRef.current) {
            finalizeSpeechSession();
        }

        if (isAutoListening) scheduleAutoRestart();
    }, [finalizeSpeechSession, scheduleAutoRestart, isAutoListening]);

    useEffect(() => {
        Voice.onSpeechStart = onSpeechStart;
        Voice.onSpeechResults = onSpeechResults;
        Voice.onSpeechPartialResults = onSpeechPartialResults;
        Voice.onSpeechEnd = onSpeechEnd;
        Voice.onSpeechError = onSpeechError;
    }, [onSpeechStart, onSpeechResults, onSpeechPartialResults, onSpeechEnd, onSpeechError]);

    useEffect(() => {
        return () => {
            Voice.destroy().then(() => Voice.removeAllListeners());
            if (voiceTimeoutRef.current) clearTimeout(voiceTimeoutRef.current);
            clearPauseTimer();
            clearAutoRestartTimer();
        };
    }, [clearPauseTimer, clearAutoRestartTimer]);

    const alphabetClassifierRef = useRef(globalAlphabetImageClassifier);
    const signClassifierRef = useRef(globalClassifier);
    const cameraRef = useRef<CameraProcessorRef>(null);
    const isFocused = useIsFocused();

    const toggleListening = useCallback(async () => {
        if (!Voice) {
            setVoiceErrorMessage("Voice module not linked natively.");
            return;
        }

        if (isListening) {
            await stopListening();
        } else {
            await startContinuousListening();
        }
    }, [isListening, startContinuousListening, stopListening]);

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
    const wordAttemptIdRef = useRef(0);
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
        wordAttemptIdRef.current += 1;
        wordFrameBufferRef.current = [];
        previousWordFrameRef.current = null;
        wordGestureMotionSeenRef.current = false;
        wordStillFrameCountRef.current = 0;
    }, []);

    const switchRecognitionMode = useCallback((mode: RecognitionMode) => {
        if (mode === activeMode) return;
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
                if (!cancelled) setIsAlphabetModelReady(true);
            } catch (error) {
                const message = modelErrorMessage('alphabet', error);
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
                if (!cancelled) setIsWordModelReady(true);
            } catch (error) {
                const message = modelErrorMessage('word', error);
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
    }, [stopDetectedSpeech]);

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
                speakAndLogSign(result.label, result.label);
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
    }, [activeMode, canDetect, keepResultVisible, speakAndLogSign]);

    const classifyCompletedGesture = useCallback(async (frames: Float32Array[]) => {
        if (!canDetect || activeMode !== 'word') return;
        if (isWordProcessingRef.current) return;

        isWordProcessingRef.current = true;
        try {
            const inferenceStartedAt = Date.now();
            const result = await signClassifierRef.current.classifyFSL(frames);
            const inferenceMs = Date.now() - inferenceStartedAt;

            if (result.confidence >= 0.40) {
                const displayLabel = createWordDisplayLabel(result.label, result.labelIndex);
                const filipinoText = formatFilipinoResult(displayLabel.filipino || displayLabel.english);
                setDetectedLabel({
                    ...displayLabel,
                    filipino: filipinoText,
                });
                setConfidence(result.confidence);
                keepResultVisible(WORD_RESULT_VISIBLE_MS);
                setStatus(`${filipinoText} (${(result.confidence * 100).toFixed(0)}%)`);
                speakAndLogSign(result.label, filipinoText);
                setDebugInfo(`Pred: ${result.label} (${(result.confidence * 100).toFixed(0)}%) Infer:${inferenceMs}ms`);
            } else {
                setStatus(`Hindi natukoy (${(result.confidence * 100).toFixed(0)}%). Subukan muli.`);
                setDebugInfo(`Mababang kumpiyansa: ${result.label} (${(result.confidence * 100).toFixed(0)}%)`);
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
    }, [activeMode, canDetect, keepResultVisible, speakAndLogSign]);

    const processWordKeypoints = useCallback(async (keypoints: Float32Array, handsDetected: boolean) => {
        if (!canDetect || activeMode !== 'word') return;

        const wordFrame = convertLandmarkFrameToWordFrame(keypoints);
        if (!wordFrame) return;

        const previousWordFrame = previousWordFrameRef.current;
        const handMotion = previousWordFrame
            ? calculateHandMotion(previousWordFrame, wordFrame)
            : 0;
        previousWordFrameRef.current = wordFrame;

        if (!handsDetected) {
            if (wordGestureMotionSeenRef.current && wordFrameBufferRef.current.length >= 8 && !isWordProcessingRef.current) {
                const frames = resampleCompletedGesture(wordFrameBufferRef.current, wordSequenceLengthRef.current);
                resetWordPredictionState();
                await classifyCompletedGesture(frames);
            }
            return;
        }

        if (handMotion >= WORD_HAND_MOTION_THRESHOLD) {
            wordGestureMotionSeenRef.current = true;
            wordStillFrameCountRef.current = 0;
            wordFrameBufferRef.current.push(wordFrame);
            if (wordFrameBufferRef.current.length > 60) {
                wordFrameBufferRef.current.shift();
            }
            setStatus(`Kinukunan ang senyas... (${wordFrameBufferRef.current.length})`);
            setDebugInfo(`Mode: Word | Signing... Frames:${wordFrameBufferRef.current.length} Motion:${handMotion.toFixed(4)}`);
        } else if (wordGestureMotionSeenRef.current) {
            wordStillFrameCountRef.current += 1;
            wordFrameBufferRef.current.push(wordFrame);

            if (wordStillFrameCountRef.current >= 3) {
                const capturedCount = wordFrameBufferRef.current.length;
                if (capturedCount >= 8 && !isWordProcessingRef.current) {
                    setStatus('Isinasalin ang senyas...');
                    const frames = resampleCompletedGesture(wordFrameBufferRef.current, wordSequenceLengthRef.current);
                    resetWordPredictionState();
                    await classifyCompletedGesture(frames);
                } else if (capturedCount < 8) {
                    resetWordPredictionState();
                    setStatus('Handa na. Magpakita ng salita.');
                }
            }
        } else {
            while (wordFrameBufferRef.current.length > WORD_GESTURE_PRE_ROLL_FRAMES) {
                wordFrameBufferRef.current.shift();
            }
            wordFrameBufferRef.current.push(wordFrame);
            if (!showResult && !isWordProcessingRef.current) {
                setStatus('Handa na. Isenyas ang salita.');
            }
        }
    }, [activeMode, canDetect, showResult, classifyCompletedGesture, resetWordPredictionState]);

    const handleHandsMissing = useCallback(() => {
        missingHandFrameCountRef.current += 1;
        if (missingHandFrameCountRef.current < NO_HANDS_GRACE_FRAMES) return;
        if (missingHandFrameCountRef.current > NO_HANDS_GRACE_FRAMES) return;

        setStatus('Walang kamay na nakita.');
        if (activeMode === 'word') {
            resetWordPredictionState();
            setShowResult(false);
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
            if (!handsDetected) {
                handleHandsMissing();
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
            `MP:${metrics.averageMediaPipeMs.toFixed(0)}ms`
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
                <View style={styles.textContainer}>
                    {voiceErrorMessage ? (
                        <View style={styles.errorCard}>
                            <MaterialIcons name="error-outline" size={18} color="#E57373" style={{ marginRight: 6 }} />
                            <Text style={styles.errorText}>{voiceErrorMessage}</Text>
                        </View>
                    ) : null}

                    {sequenceToPlay && sequenceToPlay.length > 0 && (
                        <View style={styles.sequenceContainer}>
                            {sequenceToPlay.slice(0, 5).map((item, index) => (
                                <View key={index} style={styles.sequenceBadge}>
                                    <Text style={styles.sequenceText}>
                                        {item.display}
                                    </Text>
                                </View>
                            ))}
                            {sequenceToPlay.length > 5 && (
                                <Text style={styles.moreText}>+{sequenceToPlay.length - 5} more</Text>
                            )}
                        </View>
                    )}
                </View>

                {/* Small Side Mic Trigger Button inside 3D View */}
                <TouchableOpacity
                    style={[
                        styles.sideMicButton,
                        isListening && styles.sideMicButtonActive
                    ]}
                    onPress={toggleListening}
                    activeOpacity={0.8}
                >
                    <MaterialIcons
                        name={isListening ? 'mic' : 'mic-none'}
                        size={24}
                        color={isListening ? '#FFFFFF' : '#7E57C2'}
                    />
                </TouchableOpacity>

                <View style={styles.micContainer}>
                    <MicButton
                        onPress={toggleListening}
                        isListening={isListening}
                        size={100}
                    />
                    <Text style={styles.micHint}>
                        {isListening ? 'LISTENING... TAP TO TRANSLATE' : 'TAP MIC TO SPEAK'}
                    </Text>
                </View>
            </View>

            <View style={styles.bottomHalf}>
                <View style={StyleSheet.absoluteFillObject}>
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
                </View>

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
    textContainer: { position: 'absolute', top: 12, left: 0, right: 0, alignItems: 'center', zIndex: 105, width: '100%' },
    errorCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF0F0', borderWidth: 1.5, borderColor: '#FFCCCC', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, width: '85%', justifyContent: 'center', marginTop: 8 },
    errorText: { color: '#E57373', fontSize: 13, fontWeight: '600', textAlign: 'center' },
    micContainer: { position: 'absolute', bottom: 36, left: 0, right: 0, alignItems: 'center', zIndex: 105 },
    micHint: { color: '#B0B0C8', fontSize: 11, fontWeight: 'bold', letterSpacing: 1.5, marginTop: 16 },
    sequenceContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 12, gap: 8 },
    sequenceBadge: { backgroundColor: '#F0EDFB', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14, borderWidth: 1.5, borderColor: '#C9B8F0', shadowColor: '#9575CD', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
    sequenceText: { color: '#5E35B1', fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
    moreText: { color: '#B0B0C8', fontSize: 11, fontWeight: '600', alignSelf: 'center', marginLeft: 4 },
    topHalf: { height: '50%', width: '100%', position: 'relative' },
    sideMicButton: {
        position: 'absolute',
        top: '50%',
        marginTop: -24,
        right: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 1.5,
        borderColor: '#C9B8F0',
        shadowColor: '#7E57C2',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 4,
        zIndex: 120,
    },
    sideMicButtonActive: {
        backgroundColor: '#7E57C2',
        borderColor: '#7E57C2',
    },
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
