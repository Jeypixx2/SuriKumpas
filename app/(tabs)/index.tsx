import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, ActivityIndicator, ScrollView, Platform, StatusBar } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import CameraProcessor, {
    CameraPerformanceMetrics,
    CameraProcessorRef,
} from '../../components/CameraProcessor';
import ResultOverlay from '../../components/ResultOverlay';
import { globalAlphabetClassifier, AlphabetPredictionResult } from '../../lib/AlphabetClassifier';
import { globalClassifier } from '../../lib/SignClassifier';
import { FSLLabel, FSL_LABELS, tokenizeSentence } from '../../lib/labels';
import { getWordSuggestions } from '../../lib/wordSuggestions';
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
const DETECTION_COOLDOWN_MS = 1000;
const NO_HANDS_GRACE_FRAMES = 4;

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

    // School settings & course questions:
    if (s.includes('COURSE') || s.includes('KURSO')) {
        if (s.includes('ANO') || s.includes('ANONG') || s.includes('WHAT') || s.includes('KINUHA')) {
            s = 'ANO ANG COURSE MO';
        }
    } else if (s.includes('PAARALAN') || s.includes('ESKWELAHAN') || s.includes('NAG-AARAL') || s.includes('NAGAARAL') || s.includes('SCHOOL')) {
        if (s.includes('SAAN') || s.includes('WHERE')) {
            s = 'SAAN KA NAG-AARAL';
        }
    } else if (s.includes('YEAR') || s.includes('TAON')) {
        if (s.includes('ANONG') || s.includes('ANO') || s.includes('ILANG') || s.includes('WHAT')) {
            if (s.includes('KOLEHIYO') || s.includes('ESKWELA') || s.includes('COLLEGE') || s.includes('YEAR')) {
                s = 'ANONG YEAR MO NA';
            }
        }
    } else if (s.includes('KLASE') || s.includes('PASOK') || s.includes('CLASS')) {
        if (s.includes('MAY') || s.includes('MERON')) {
            s = 'MAY KLASE BA NGAYON';
        }
    } else if (s.includes('EXAM') || s.includes('PAGSUSULIT') || s.includes('TEST')) {
        if (s.includes('KAMUSTA') || s.includes('KUMUSTA') || s.includes('HOW')) {
            s = 'KUMUSTA ANG EXAM';
        }
    }

    return s;
};

/**
 * Phonetic pronunciation overrides for academic course acronyms so Android TTS
 * spells them letter-by-letter rather than mangling them as single words.
 */
const ACRONYM_PRONUNCIATION_MAP: Record<string, string> = {
    'BSIT': 'B S I T',
    'BSHM': 'B S H M',
    'BSCS': 'B S C S',
    'BSIS': 'B S I S',
    'BSTM': 'B S T M',
    'BSBA': 'B S B A',
    'BSA': 'B S A',
    'BSCRIM': 'B S Criminology',
    'BSED': 'B S Education',
    'BEED': 'B E Education',
    'BSN': 'B S Nursing',
    'BSCE': 'B S Civil Engineering',
    'BSEE': 'B S Electrical Engineering',
    'BSME': 'B S Mechanical Engineering',
    'BSARCH': 'B S Architecture',
    'BSPSYCH': 'B S Psychology',
    'BSAGRI': 'B S Agriculture',
    'IT': 'I T',
    'CS': 'C S',
    'HRM': 'H R M',
    'ID': 'I D',
    'PE': 'P E',
    'CNSC': 'C N S C',
    'USANT': 'U S A N T',
    'TESDA': 'Tesda',
};

/**
 * English to Tagalog dictionary translation map so that any fingerspelled
 * or recognized English word is converted into Tagalog before speech synthesis.
 */
const ENGLISH_TO_TAGALOG_MAP: Record<string, string> = {
    'HELLO': 'Hello',
    'HI': 'Kamusta',
    'YES': 'Oo',
    'NO': 'Hindi',
    'THANK YOU': 'Salamat',
    'THANKS': 'Salamat',
    'GOOD MORNING': 'Magandang umaga',
    'GOOD AFTERNOON': 'Magandang hapon',
    'GOOD EVENING': 'Magandang gabi',
    'GOOD NIGHT': 'Magandang gabi',
    'GOODBYE': 'Paalam',
    'BYE': 'Paalam',
    'PLEASE': 'Pakiusap',
    'SORRY': 'Paumanhin',
    'WELCOME': 'Walang anuman',
    "YOU'RE WELCOME": 'Walang anuman',
    'YOURE WELCOME': 'Walang anuman',
    'HOW ARE YOU': 'Kamusta ka',
    'I AM FINE': 'Mabuti naman ako',
    'IM FINE': 'Mabuti naman ako',
    'FINE': 'Mabuti',
    'UNDERSTAND': 'Naintindihan',
    "DON'T UNDERSTAND": 'Hindi ko maintindihan',
    'DONT UNDERSTAND': 'Hindi ko maintindihan',
    'KNOW': 'Alam',
    "DON'T KNOW": 'Hindi ko alam',
    'DONT KNOW': 'Hindi ko alam',
    'HELP': 'Tulong',
    'WHERE': 'Saan',
    'WHEN': 'Kailan',
    'WHAT': 'Ano',
    'WHY': 'Bakit',
    'HOW': 'Paano',
    'WHO': 'Sino',
    'WATER': 'Tubig',
    'FOOD': 'Pagkain',
    'RICE': 'Kanin',
    'BREAD': 'Tinapay',
    'FISH': 'Isda',
    'MEAT': 'Karne',
    'CHICKEN': 'Manok',
    'EGG': 'Itlog',
    'MILK': 'Gatas',
    'COFFEE': 'Kape',
    'TEA': 'Tsaa',
    'ONE': 'Isa',
    'TWO': 'Dalawa',
    'THREE': 'Tatlo',
    'FOUR': 'Apat',
    'FIVE': 'Lima',
    'SIX': 'Anim',
    'SEVEN': 'Pito',
    'EIGHT': 'Walo',
    'NINE': 'Siyam',
    'TEN': 'Sampu',
    'TODAY': 'Ngayong araw',
    'TOMORROW': 'Bukas',
    'YESTERDAY': 'Kahapon',
    'FATHER': 'Ama',
    'MOTHER': 'Ina',
    'BOY': 'Lalaki',
    'MAN': 'Lalaki',
    'GIRL': 'Babae',
    'WOMAN': 'Babae',
    'CHILD': 'Bata',
    'BABY': 'Sanggol',
    'FRIEND': 'Kaibigan',
    'LOVE': 'Mahal',
    'HAPPY': 'Masaya',
    'SAD': 'Malungkot',
    'TIRED': 'Pagod',
    'SICK': 'May sakit',
    'HUNGRY': 'Gutom',
    'THIRSTY': 'Uhaw',
    'FAST': 'Mabilis',
    'SLOW': 'Mabagal',
    'BIG': 'Malaki',
    'SMALL': 'Maliit',
    'HOT': 'Mainit',
    'COLD': 'Malamig',
    // School settings additions:
    'COURSE': 'Kurso',
    'WHAT IS YOUR COURSE': 'Ano ang course mo',
    'SCHOOL': 'Paaralan',
    'COLLEGE': 'Kolehiyo',
    'UNIVERSITY': 'Unibersidad',
    'STUDENT': 'Estudyante',
    'TEACHER': 'Guro',
    'PROFESSOR': 'Propesor',
    'CLASS': 'Klase',
    'LESSON': 'Leksiyon',
    'EXAM': 'Pagsusulit',
    'TEST': 'Pagsusulit',
    'GRADE': 'Grado',
    'CLASSROOM': 'Silid-aralan',
    'LIBRARY': 'Aklatan',
    'CANTEEN': 'Kantina',
    'UNIFORM': 'Uniporme',
    'BOOK': 'Libro',
    'PAPER': 'Papel',
    'HOMEWORK': 'Takdang-aralin',
    'PROJECT': 'Proyekto',
};

/**
 * Convert text into natural Filipino/Tagalog for speech synthesis:
 * 1. Checks if the word is an acronym with special letter pronunciation (e.g. BSIT -> B S I T)
 * 2. Checks if the phrase has a direct Tagalog translation in ENGLISH_TO_TAGALOG_MAP
 * 3. Translates individual words into Tagalog if needed
 * 4. Formats all-caps text into Titlecase so Android TTS speaks it as a coherent Tagalog word
 */
const toPronounceableWord = (text: string): string => {
    const trimmed = text.trim();
    if (!trimmed) return '';

    const upperPhrase = trimmed.toUpperCase();
    if (ACRONYM_PRONUNCIATION_MAP[upperPhrase]) {
        return ACRONYM_PRONUNCIATION_MAP[upperPhrase];
    }
    if (ENGLISH_TO_TAGALOG_MAP[upperPhrase]) {
        return ENGLISH_TO_TAGALOG_MAP[upperPhrase];
    }

    return trimmed
        .split(/\s+/)
        .map(word => {
            const upperWord = word.toUpperCase();
            if (ACRONYM_PRONUNCIATION_MAP[upperWord]) {
                return ACRONYM_PRONUNCIATION_MAP[upperWord];
            }
            if (ENGLISH_TO_TAGALOG_MAP[upperWord]) {
                return ENGLISH_TO_TAGALOG_MAP[upperWord];
            }
            if (word.length <= 1) return word;
            if (word === word.toUpperCase()) {
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }
            return word;
        })
        .join(' ');
};
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
        return details.includes('Alphabet model')
            ? details
            : `Alphabet model files are missing or could not be loaded. Please ensure model.tflite, motion.tflite, and labels.json are placed in assets/model/alphabet/. Details: ${details}`;
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

function swapHandsInFrames(frames: Float32Array[]): Float32Array[] {
    return frames.map(frame => {
        const swapped = new Float32Array(WORD_FRAME_SIZE);
        swapped.set(frame.subarray(0, 132), 0); // pose (0..131)
        swapped.set(frame.subarray(195, 258), 132); // RH -> LH (132..194)
        swapped.set(frame.subarray(132, 195), 195); // LH -> RH (195..257)
        return swapped;
    });
}

export default function MainScreen() {
    const PAUSE_SILENCE_MS = 1200;
    const router = useRouter();
    const [isListening, setIsListening] = useState(false);
    const [isAutoListening, setIsAutoListening] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const {
        setSignToPlay, setLetterToPlay, sequenceToPlay, setSequenceToPlay,
        setSpokenText, registerClearHandler
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
        setSpokenText(text);

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
            setSpokenText('');
            speechSessionFinalizedRef.current = false;

            isStoppingVoiceRef.current = true;
            await Voice.stop().catch(() => { });
            await Voice.cancel().catch(() => { });
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
            await Voice.stop().catch(() => { });
            await Voice.cancel().catch(() => { });
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

    const handleClear3DSigning = useCallback(async () => {
        clearPauseTimer();
        clearAutoRestartTimer();
        latestSpeechRef.current = '';
        lastQueuedSpeechRef.current = '';
        speechSessionFinalizedRef.current = false;

        if (Voice && (isListening || isVoiceStartingRef.current)) {
            try {
                isStoppingVoiceRef.current = true;
                await Voice.stop().catch(() => {});
                await Voice.cancel().catch(() => {});
            } catch (err) {
                console.warn('[Voice] Clear stop error:', err);
            } finally {
                isStoppingVoiceRef.current = false;
                setIsListening(false);
            }
        }

        setRecognizedText('');
        setSpokenText('');
        setSequenceToPlay(null);
        setSignToPlay(null);
        setLetterToPlay(null);
        setVoiceErrorMessage(null);
        stopDetectedSpeech();
    }, [clearPauseTimer, clearAutoRestartTimer, isListening, setSequenceToPlay, setSignToPlay, setLetterToPlay, setSpokenText, stopDetectedSpeech]);

    useEffect(() => {
        registerClearHandler(handleClear3DSigning);
    }, [registerClearHandler, handleClear3DSigning]);

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
        setSpokenText(text);
        speechSessionFinalizedRef.current = false;
        resetPauseTimer();
    }, [resetPauseTimer, setSpokenText]);

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

    const alphabetClassifierRef = useRef(globalAlphabetClassifier);
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
    const [spelledText, setSpelledText] = useState('');
    const spelledTextRef = useRef('');
    const wordCompletionTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastSpokenWordRef = useRef('');
    const [speakEachLetter, setSpeakEachLetter] = useState(false);
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

    const wordSequenceLengthRef = useRef(INITIAL_WORD_SEQUENCE_LENGTH);
    const wordFrameBufferRef = useRef<Float32Array[]>([]);
    const previousWordFrameRef = useRef<Float32Array | null>(null);
    const wordGestureMotionSeenRef = useRef(false);
    const wordHandsSeenCountRef = useRef(0);
    const wordStillFrameCountRef = useRef(0);
    const wordCumulativeMotionRef = useRef(0);
    const wordAttemptIdRef = useRef(0);
    const missingHandFrameCountRef = useRef(0);
    const wordGestureMissingGraceRef = useRef(0);
    const lastDetectionRef = useRef<number>(0);
    const resultHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isWordProcessingRef = useRef<boolean>(false);
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

    const clearAlphabetBuffers = useCallback(() => {
        alphabetClassifierRef.current.reset();
    }, []);

    const clearWordBuffers = useCallback(() => {
        wordAttemptIdRef.current += 1;
        wordFrameBufferRef.current = [];
        previousWordFrameRef.current = null;
        wordGestureMotionSeenRef.current = false;
        wordHandsSeenCountRef.current = 0;
        wordStillFrameCountRef.current = 0;
        wordCumulativeMotionRef.current = 0;
        wordGestureMissingGraceRef.current = 0;
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
        wordHandsSeenCountRef.current = 0;
        wordStillFrameCountRef.current = 0;
        wordCumulativeMotionRef.current = 0;
        wordGestureMissingGraceRef.current = 0;
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
        if (wordCompletionTimerRef.current) {
            clearTimeout(wordCompletionTimerRef.current);
            wordCompletionTimerRef.current = null;
        }
        lastSpokenWordRef.current = '';
        spelledTextRef.current = '';
        setSpelledText('');
        setDebugInfo(nextError
            ? `Mode: ${mode === 'alphabet' ? 'Alphabet' : 'Word'} | Err: ${nextError}`
            : `Mode: ${mode === 'alphabet' ? 'Alphabet' : 'Word'} | Ready`
        );
    }, [activeMode, alphabetLoadError, wordLoadError, clearAlphabetBuffers, clearWordBuffers]);

    useEffect(() => {
        if (!isFocused) {
            clearAlphabetBuffers();
            clearWordBuffers();
            if (wordCompletionTimerRef.current) {
                clearTimeout(wordCompletionTimerRef.current);
                wordCompletionTimerRef.current = null;
            }
            lastSpokenWordRef.current = '';
            spelledTextRef.current = '';
            setSpelledText('');
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
            if (resultHideTimeoutRef.current) {
                clearTimeout(resultHideTimeoutRef.current);
            }
            if (wordCompletionTimerRef.current) {
                clearTimeout(wordCompletionTimerRef.current);
                wordCompletionTimerRef.current = null;
            }
            stopDetectedSpeech();
        };
    }, [stopDetectedSpeech]);

    const finalizeAndSpeakCurrentWord = useCallback(() => {
        if (wordCompletionTimerRef.current) {
            clearTimeout(wordCompletionTimerRef.current);
            wordCompletionTimerRef.current = null;
        }

        const currentText = spelledTextRef.current.trim();
        if (!currentText) return;

        // Get the last word currently being spelled
        const words = currentText.split(/\s+/);
        const lastWord = words[words.length - 1];
        if (!lastWord) return;

        // Convert all-caps (e.g. "JAYZEL") to TitleCase ("Jayzel") so TTS pronounces
        // it as a coherent name/word rather than an acronym.
        const pronounceableWord = toPronounceableWord(lastWord);
        if (lastWord !== lastSpokenWordRef.current) {
            lastSpokenWordRef.current = lastWord;
            speakAndLogSign(lastWord, pronounceableWord);
            setStatus(`Salita: ${pronounceableWord}`);
            setDebugInfo(`Alphabet word complete: "${pronounceableWord}"`);
        }

        // Append space to prepare for the next word if not already present
        if (!spelledTextRef.current.endsWith(' ')) {
            const nextText = spelledTextRef.current + ' ';
            spelledTextRef.current = nextText;
            setSpelledText(nextText);
        }
    }, [speakAndLogSign]);

    const handleAlphabetResult = useCallback((result: AlphabetPredictionResult) => {
        if (result.event.type === 'commit') {
            const letter = result.topLabel;
            const label: FSLLabel = {
                id: 200 + letter.charCodeAt(0),
                english: letter,
                filipino: letter,
                category: 'ALPABETO'
            };
            setDetectedLabel(label);
            setConfidence(result.confidence);
            keepResultVisible(2000);
            setStatus(`${letter} (${(result.confidence * 100).toFixed(0)}%)`);
            setDebugInfo(`Alphabet: ${letter} (${(result.confidence * 100).toFixed(0)}%) [${result.source}]`);

            // Accumulate letter into fingerspelled word
            const nextText = spelledTextRef.current + letter;
            spelledTextRef.current = nextText;
            setSpelledText(nextText);

            // If user explicitly enabled letter-by-letter speech, speak it
            if (speakEachLetter) {
                speakAndLogSign(letter, letter);
            }

            // Schedule auto-completion to speak the whole word after 1.8s pause
            if (wordCompletionTimerRef.current) {
                clearTimeout(wordCompletionTimerRef.current);
            }
            wordCompletionTimerRef.current = setTimeout(() => {
                finalizeAndSpeakCurrentWord();
            }, 1800);

        } else if (result.event.type === 'replace') {
            const newLetter = result.event.newLabel;
            const oldLetter = result.event.oldLabel;
            const label: FSLLabel = {
                id: 200 + newLetter.charCodeAt(0),
                english: newLetter,
                filipino: newLetter,
                category: 'ALPABETO'
            };
            setDetectedLabel(label);
            setConfidence(result.confidence);
            keepResultVisible(2000);
            setStatus(`${newLetter} (${(result.confidence * 100).toFixed(0)}%) [Replaced ${oldLetter}]`);
            setDebugInfo(`Alphabet: ${newLetter} replaced ${oldLetter}`);

            // Replace previous letter in fingerspelled text
            const current = spelledTextRef.current;
            const nextText = (current.endsWith(oldLetter) ? current.slice(0, -oldLetter.length) : current) + newLetter;
            spelledTextRef.current = nextText;
            setSpelledText(nextText);

            if (speakEachLetter) {
                speakAndLogSign(newLetter, newLetter);
            }

            // Schedule auto-completion to speak the whole word after 1.8s pause
            if (wordCompletionTimerRef.current) {
                clearTimeout(wordCompletionTimerRef.current);
            }
            wordCompletionTimerRef.current = setTimeout(() => {
                finalizeAndSpeakCurrentWord();
            }, 1800);

        } else if (result.event.type === 'space') {
            setStatus('[Space]');
            setDebugInfo('Alphabet: [Space] emitted (1s no hand)');
            // Hand removed for 1s: immediately finalize and speak the whole word
            finalizeAndSpeakCurrentWord();
        }
}, [keepResultVisible, speakAndLogSign, speakEachLetter, finalizeAndSpeakCurrentWord]);

const handleBackspace = useCallback(() => {
    if (wordCompletionTimerRef.current) {
        clearTimeout(wordCompletionTimerRef.current);
        wordCompletionTimerRef.current = null;
    }
    const next = spelledTextRef.current.slice(0, -1);
    spelledTextRef.current = next;
    setSpelledText(next);
    lastSpokenWordRef.current = '';
}, []);

const handleAddSpace = useCallback(() => {
finalizeAndSpeakCurrentWord();
    }, [finalizeAndSpeakCurrentWord]);

const handleClearSpelling = useCallback(() => {
    if (wordCompletionTimerRef.current) {
        clearTimeout(wordCompletionTimerRef.current);
        wordCompletionTimerRef.current = null;
    }
    lastSpokenWordRef.current = '';
    spelledTextRef.current = '';
    setSpelledText('');
}, []);

const handleSpeakWord = useCallback(() => {
    const text = spelledTextRef.current.trim();
    if (text) {
        const pronounceable = toPronounceableWord(text);
        speakAndLogSign(text, pronounceable);
        setStatus(`Binasa: ${pronounceable}`);
    }
}, [speakAndLogSign]);

const currentPrefix = useMemo(() => {
    if (!spelledText) return '';
    const parts = spelledText.split(/\s+/);
    return parts[parts.length - 1] || '';
}, [spelledText]);

const wordSuggestions = useMemo(() => {
    if (activeMode !== 'alphabet') {
        return [];
    }
    if (!currentPrefix && !recognizedText) {
        return [];
    }
    return getWordSuggestions(currentPrefix, recognizedText, 8);
}, [activeMode, currentPrefix, recognizedText]);

const handleSelectSuggestion = useCallback((chosenWord: string) => {
    if (wordCompletionTimerRef.current) {
        clearTimeout(wordCompletionTimerRef.current);
        wordCompletionTimerRef.current = null;
    }

    const currentText = spelledTextRef.current;
    const lastSpaceIndex = currentText.lastIndexOf(' ');
    const base = lastSpaceIndex >= 0 ? currentText.slice(0, lastSpaceIndex + 1) : '';
    const newText = base + chosenWord + ' ';

    spelledTextRef.current = newText;
    setSpelledText(newText);
    lastSpokenWordRef.current = chosenWord;

    const pronounceable = toPronounceableWord(chosenWord);
    speakAndLogSign(chosenWord, pronounceable);
    setStatus(`Pinili: ${pronounceable}`);
    setDebugInfo(`Suggestion: "${pronounceable}"`);
}, [speakAndLogSign]);

const handleHandLandmarksExtracted = useCallback(async (landmarks: Float32Array, timestamp: number) => {
    if (!canDetect || activeMode !== 'alphabet') return;
    missingHandFrameCountRef.current = 0;
    try {
        const result = await alphabetClassifierRef.current.processLandmarks(landmarks, timestamp);
        if (result) {
            handleAlphabetResult(result);
        }
    } catch (error) {
        const message = modelErrorMessage('alphabet', error);
        console.error('Alphabet Landmarks Error:', error);
        setAlphabetLoadError(message);
        setIsAlphabetModelReady(false);
        setDebugInfo('Mode: Alphabet | Err: ' + message);
    }
}, [canDetect, activeMode, handleAlphabetResult]);

const handleNoHandDetected = useCallback(async (timestamp: number) => {
    if (!canDetect || activeMode !== 'alphabet') return;
    try {
        const result = await alphabetClassifierRef.current.processNoHand(timestamp);
        if (result) {
            handleAlphabetResult(result);
        }
    } catch (error) {
        console.error('Alphabet No Hand Error:', error);
    }
}, [canDetect, activeMode, handleAlphabetResult]);

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

    if (activeMode === 'word') {
        if (!wordGestureMotionSeenRef.current) {
            resetWordPredictionState();
            setShowResult(false);
            setStatus('Walang kamay na nakita.');
        }
        return;
    }

    clearAlphabetBuffers();
}, [activeMode, clearAlphabetBuffers, resetWordPredictionState]);

const handleKeypointsExtracted = useCallback(async (
    keypoints: Float32Array | 'hands-detected' | 'no-hands'
) => {
    if (!canDetect || activeMode !== 'word') return;
    if (keypoints === 'no-hands') {
        handleHandsMissing();
        if (previousWordFrameRef.current) {
            await processWordKeypoints(previousWordFrameRef.current, false);
        }
        return;
    }

    if (keypoints === 'hands-detected') {
        missingHandFrameCountRef.current = 0;
        return;
    }

    const { leftVisible, rightVisible } = getWordHandVisibility(keypoints);
    const handsDetected = leftVisible || rightVisible;

    if (!handsDetected) {
        handleHandsMissing();
        await processWordKeypoints(keypoints, false);
        return;
    }

    missingHandFrameCountRef.current = 0;
    await processWordKeypoints(keypoints, true);
}, [activeMode, canDetect, handleHandsMissing, processWordKeypoints]);

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

    const hasActive3DSigning = Boolean(
        (sequenceToPlay && sequenceToPlay.length > 0) || recognizedText
    );

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
            </View>

            {/* Side Action Buttons inside 3D View */}
            <View style={styles.sideButtonsContainer}>
                {hasActive3DSigning && (
                    <TouchableOpacity
                        style={styles.sideStopButton}
                        onPress={handleClear3DSigning}
                        activeOpacity={0.8}
                        accessibilityLabel="Stop 3D signing"
                    >
                        <MaterialIcons name="stop" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                )}

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
            </View>

            {!hasActive3DSigning && (
                <View style={styles.micContainer}>
                    <MicButton
                        onPress={toggleListening}
                        isListening={isListening}
                        size={92}
                    />
                    <Text style={styles.micHint}>
                        {isListening ? 'LISTENING... TAP TO TRANSLATE' : 'TAP MIC TO SPEAK'}
                    </Text>
                </View>
            )}
        </View>

        <View style={styles.bottomHalf}>
            <View style={StyleSheet.absoluteFillObject}>
                <CameraProcessor
                    ref={cameraRef}
                    style={styles.camera}
                    onKeypointsExtracted={handleKeypointsExtracted}
                    onHandLandmarksExtracted={handleHandLandmarksExtracted}
                    onNoHandDetected={handleNoHandDetected}
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

            {activeMode === 'alphabet' && wordSuggestions.length > 0 && (
                <View style={styles.suggestionsContainer}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.suggestionsScrollContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        {wordSuggestions.map((word) => (
                            <TouchableOpacity
                                key={word}
                                style={styles.suggestionChip}
                                onPress={() => handleSelectSuggestion(word)}
                                activeOpacity={0.7}
                            >
                                <MaterialIcons name="auto-fix-high" size={13} color="#2B9C8E" style={{ marginRight: 4 }} />
                                <Text style={styles.suggestionText}>{word}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            )}

            {activeMode === 'alphabet' && (
                <View style={styles.spellingBar}>
                    <View style={styles.spellingTextContainer}>
                        <Text style={styles.spellingText} numberOfLines={1}>
                            {spelledText || ' '}
                            <Text style={styles.spellingCursor}>|</Text>
                        </Text>
                    </View>
                    <View style={styles.spellingButtons}>
                        <TouchableOpacity
                            style={[styles.spellingButton, speakEachLetter && styles.spellingButtonActive]}
                            onPress={() => setSpeakEachLetter(prev => !prev)}
                            accessibilityLabel="Toggle letter speech"
                        >
                            <Text style={[styles.spellingButtonText, speakEachLetter && styles.spellingButtonTextActive]}>
                                {speakEachLetter ? '🔤' : '💬'}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.spellingButton} onPress={handleBackspace}>
                            <Text style={styles.spellingButtonText}>⌫</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.spellingButton} onPress={handleAddSpace}>
                            <Text style={styles.spellingButtonText}>␣</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.spellingButton} onPress={handleSpeakWord}>
                            <Text style={styles.spellingButtonText}>🔊</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.spellingButton, styles.spellingClearButton]} onPress={handleClearSpelling}>
                            <Text style={[styles.spellingButtonText, styles.spellingClearText]}>✕</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}

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
    textContainer: {
        position: 'absolute',
        top: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 6 : 40,
        left: 14,
        right: 14,
        alignItems: 'center',
        zIndex: 200,
    },
    errorCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF0F0', borderWidth: 1.5, borderColor: '#FFCCCC', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, width: '90%', justifyContent: 'center', marginTop: 8 },
    errorText: { color: '#E57373', fontSize: 13, fontWeight: '600', textAlign: 'center' },
    micContainer: { position: 'absolute', bottom: 36, left: 0, right: 0, alignItems: 'center', zIndex: 105 },
    micHint: { color: '#B0B0C8', fontSize: 11, fontWeight: 'bold', letterSpacing: 1.5, marginTop: 16 },
    bottomWordCardContainer: {
        position: 'absolute',
        bottom: 12,
        left: 14,
        right: 14,
        alignItems: 'center',
        zIndex: 250,
    },
    speechOverlayCard: {
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        borderWidth: 2,
        borderColor: '#9575CD',
        paddingHorizontal: 16,
        paddingVertical: 12,
        shadowColor: '#512DA8',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 10,
        elevation: 12,
    },
    speechMainRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
    },
    voiceIconBubble: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: '#7E57C2',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
        shadowColor: '#7E57C2',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 3,
    },
    speechTextContainer: {
        flex: 1,
        justifyContent: 'center',
        marginRight: 10,
    },
    speechLabelHeading: {
        color: '#7E57C2',
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    speechRecognizedWord: {
        color: '#1A0938',
        fontSize: 22,
        fontWeight: 'bold',
        letterSpacing: 0.4,
    },
    clearSpeechButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFEBEE',
        borderWidth: 1.5,
        borderColor: '#FFCDD2',
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 8,
        shadowColor: '#D32F2F',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
        elevation: 2,
    },
    clearSpeechButtonText: {
        color: '#D32F2F',
        fontSize: 13,
        fontWeight: 'bold',
        marginLeft: 3,
    },
    sequenceBadgesRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 10,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#EDE7F6',
        gap: 6,
    },
    sequenceRowLabel: {
        color: '#9575CD',
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        marginRight: 4,
    },
    sequenceBadge: {
        backgroundColor: '#F3E5F5',
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#CE93D8',
    },
    sequenceText: {
        color: '#4A148C',
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 0.4,
    },
    moreText: { color: '#B0B0C8', fontSize: 11, fontWeight: '600', alignSelf: 'center', marginLeft: 4 },
    topHalf: { height: '50%', width: '100%', position: 'relative' },
    sideButtonsContainer: {
        position: 'absolute',
        top: '50%',
        right: 16,
        transform: [{ translateY: -44 }],
        alignItems: 'center',
        gap: 10,
        zIndex: 120,
    },
    sideStopButton: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FF5252',
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: '#FFCDD2',
        shadowColor: '#FF5252',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 5,
    },
    sideMicButton: {
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
    suggestionsContainer: {
        position: 'absolute',
        bottom: 130,
        left: 16,
        right: 16,
        zIndex: 115,
    },
    suggestionsScrollContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 2,
        paddingVertical: 4,
    },
    suggestionChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#A8E6CF',
        paddingHorizontal: 12,
        paddingVertical: 6,
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 3,
    },
    suggestionText: {
        color: '#2B9C8E',
        fontSize: 12,
        fontWeight: 'bold',
        letterSpacing: 0.6,
    },
    spellingBar: {
        position: 'absolute',
        bottom: 76,
        left: 16,
        right: 16,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: '#A8E6CF',
        paddingHorizontal: 14,
        paddingVertical: 8,
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 4,
        zIndex: 110,
    },
    spellingTextContainer: {
        flex: 1,
        marginRight: 8,
    },
    spellingText: {
        fontSize: 20,
        fontFamily: 'monospace',
        fontWeight: 'bold',
        color: '#2D3561',
        letterSpacing: 3,
    },
    spellingCursor: {
        color: '#5BC4B5',
        fontWeight: '300',
    },
    spellingButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    spellingButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#F0FAF8',
        borderWidth: 1,
        borderColor: '#A8E6CF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    spellingButtonActive: {
        backgroundColor: '#5BC4B5',
        borderColor: '#5BC4B5',
    },
    spellingButtonText: {
        fontSize: 16,
        color: '#5BC4B5',
    },
    spellingButtonTextActive: {
        color: '#FFFFFF',
    },
    spellingClearButton: {
        backgroundColor: '#FFF0F0',
        borderColor: '#FFCCCC',
    },
    spellingClearText: {
        color: '#E57373',
    },
});
