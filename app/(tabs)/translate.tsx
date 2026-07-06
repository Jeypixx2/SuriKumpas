import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@dev-amirzubair/react-native-voice';
import { useAvatarContext } from '../../lib/AvatarContext';
import MicButton from '../../components/MicButton';
import { tokenizeSentence } from '../../lib/labels';

const normalizeSpeechText = (text: string) => text.trim().replace(/\s+/g, ' ');
const SIGN_PARTIAL_DEBOUNCE_MS = 120;
const FINGERSPELL_PARTIAL_DEBOUNCE_MS = 700;

export default function TranslateScreen() {
    const router = useRouter();
    const [isListening, setIsListening] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const {
        setSignToPlay, setLetterToPlay, sequenceToPlay, setSequenceToPlay
    } = useAvatarContext();

    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const partialTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastQueuedSpeechRef = useRef('');

    const clearPartialTimeout = useCallback(() => {
        if (partialTimeoutRef.current) {
            clearTimeout(partialTimeoutRef.current);
            partialTimeoutRef.current = null;
        }
    }, []);

    const queueSpeechForSigning = useCallback((rawText: string, isFinal: boolean) => {
        const text = normalizeSpeechText(rawText);
        if (!text) return;

        setRecognizedText(text);
        if (text === lastQueuedSpeechRef.current) {
            if (isFinal) setErrorMessage(null);
            return;
        }

        const sequence = tokenizeSentence(text);
        if (sequence.length > 0) {
            setSequenceToPlay(sequence);
            setSignToPlay(null);
            setLetterToPlay(null);
            setErrorMessage(null);
            lastQueuedSpeechRef.current = text;
        } else {
            if (!isFinal) return;

            setErrorMessage('Sign not available');
            setSequenceToPlay(null);
            setSignToPlay(null);
            setLetterToPlay(null);
            lastQueuedSpeechRef.current = '';

            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                setErrorMessage(null);
            }, 3000);
        }
    }, [setSequenceToPlay, setSignToPlay, setLetterToPlay]);

    const onSpeechPartialResults = useCallback((e: SpeechResultsEvent) => {
        const text = normalizeSpeechText(e.value?.[0] || '');
        if (!text) return;

        setRecognizedText(text);
        clearPartialTimeout();

        const partialSequence = tokenizeSentence(text);
        if (partialSequence.length === 0) return;

        const hasFingerspellingFallback = partialSequence.some(item => item.type === 'letter');
        const debounceMs = hasFingerspellingFallback
            ? FINGERSPELL_PARTIAL_DEBOUNCE_MS
            : SIGN_PARTIAL_DEBOUNCE_MS;
        partialTimeoutRef.current = setTimeout(() => {
            queueSpeechForSigning(text, false);
        }, debounceMs);
    }, [clearPartialTimeout, queueSpeechForSigning]);

    const onSpeechResults = useCallback((e: SpeechResultsEvent) => {
        const text = e.value?.[0] || '';
        clearPartialTimeout();
        setIsListening(false);
        queueSpeechForSigning(text, true);
    }, [clearPartialTimeout, queueSpeechForSigning]);

    const onSpeechError = useCallback((e: SpeechErrorEvent) => {
        console.warn('Speech error:', e.error);
        clearPartialTimeout();
        
        if (e.error && (e.error as any).code === '7') {
           setIsListening(false);
           return;
        }

        setIsListening(false);
        setErrorMessage('Speech recognition timeout. Speak closer to the Mic.');

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
            setErrorMessage(null);
        }, 3000);
    }, [clearPartialTimeout]);

    useEffect(() => {
        Voice.onSpeechResults = onSpeechResults;
        Voice.onSpeechPartialResults = onSpeechPartialResults;
        Voice.onSpeechError = onSpeechError;
    }, [onSpeechResults, onSpeechPartialResults, onSpeechError]);

    useEffect(() => {
        return () => {
            Voice.destroy().then(() => Voice.removeAllListeners());
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            clearPartialTimeout();
        };
    }, [clearPartialTimeout]);

    const toggleListening = useCallback(async () => {
        if (!Voice) {
            console.error("Voice module not linked natively");
            setErrorMessage("Voice module not linked natively. Rebuild the app using npx expo run:android");
            return;
        }

        if (isListening) {
            try {
                await Voice.stop();
                clearPartialTimeout();
                setIsListening(false);
            } catch (error) {
                console.error('Error stopping voice:', error);
            }
        } else {
            try {
                clearPartialTimeout();
                lastQueuedSpeechRef.current = '';
                setRecognizedText('');
                setErrorMessage(null);
                setSequenceToPlay(null);
                setSignToPlay(null);
                setLetterToPlay(null);
                await Voice.start('en-US');
                setIsListening(true);
            } catch (error) {
                console.error('Error starting voice:', error);
                setErrorMessage('Could not start speech recognition. Check microphone permissions.');
            }
        }
    }, [isListening, clearPartialTimeout]);

    return (
        <View style={styles.container}>
            <View style={styles.topHalf}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                >
                    <MaterialIcons name="arrow-back" size={22} color="#2D3561" />
                </TouchableOpacity>
            </View>

            <View style={styles.bottomHalf}>
                <View style={styles.textContainer}>
                    {recognizedText ? (
                        <View style={styles.recognizedCard}>
                            <Text style={styles.recognizedText}>
                                "{recognizedText}"
                            </Text>
                        </View>
                    ) : null}

                    {errorMessage ? (
                        <View style={styles.errorCard}>
                            <MaterialIcons name="error-outline" size={18} color="#E57373" style={{ marginRight: 6 }} />
                            <Text style={styles.errorText}>{errorMessage}</Text>
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

                <View style={styles.micContainer}>
                    <MicButton
                        onPress={toggleListening}
                        isListening={isListening}
                        size={100}
                    />
                    <Text style={styles.micHint}>
                        {isListening ? 'LISTENING...' : 'TAP TO SPEAK'}
                    </Text>
                </View>

                <View style={styles.dotPatternBackground}>
                    {useMemo(() => Array.from({ length: 20 }).map((_, i) => (
                        <View
                            key={i}
                            style={[
                                styles.bgDot,
                                {
                                    left: (i % 5) * 80 + 20,
                                    top: Math.floor(i / 5) * 80 + 20
                                }
                            ]}
                        />
                    )), [])}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'column',
    },
    topHalf: {
        height: '50%',
        width: '100%',
        position: 'relative',
        backgroundColor: '#F5F5FF',
    },
    bottomHalf: {
        height: '50%',
        width: '100%',
        backgroundColor: '#FAFAFE',
        alignItems: 'center',
        borderTopWidth: 2,
        borderTopColor: '#C9B8F0',
        position: 'relative',
        overflow: 'hidden',
        shadowColor: '#9575CD',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 10,
    },
    backButton: {
        position: 'absolute',
        top: 50,
        left: 20,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        borderWidth: 1.5,
        borderColor: '#C9B8F0',
        shadowColor: '#9575CD',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 4,
    },
    dotPatternBackground: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: 0,
    },
    bgDot: {
        position: 'absolute',
        width: 3,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: 'rgba(126, 87, 194, 0.12)',
    },
    textContainer: {
        position: 'absolute',
        top: 24,
        left: 20,
        right: 20,
        alignItems: 'center',
        zIndex: 5,
    },
    recognizedCard: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1.5,
        borderColor: '#C9B8F0',
        borderRadius: 18,
        paddingHorizontal: 20,
        paddingVertical: 14,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#9575CD',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
    },
    recognizedText: {
        color: '#2D3561',
        fontSize: 15,
        textAlign: 'center',
        fontWeight: '600',
        lineHeight: 22,
    },
    errorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF0F0',
        borderWidth: 1.5,
        borderColor: '#FFCCCC',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 10,
        width: '100%',
        justifyContent: 'center',
        marginTop: 8,
    },
    errorText: {
        color: '#E57373',
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
    },
    micContainer: {
        position: 'absolute',
        bottom: 36,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 5,
    },
    micHint: {
        color: '#B0B0C8',
        fontSize: 11,
        fontWeight: 'bold',
        letterSpacing: 1.5,
        marginTop: 16,
    },
    sequenceContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginTop: 12,
        gap: 8,
    },
    sequenceBadge: {
        backgroundColor: '#F0EDFB',
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#C9B8F0',
        shadowColor: '#9575CD',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    sequenceText: {
        color: '#5E35B1',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 0.4,
    },
    moreText: {
        color: '#B0B0C8',
        fontSize: 11,
        fontWeight: '600',
        alignSelf: 'center',
        marginLeft: 4,
    },
    debugInfo: {
        marginTop: 5,
        opacity: 0.6,
    },
    debugText: {
        color: '#9575CD',
        fontSize: 10,
        fontFamily: 'monospace',
    },
});
