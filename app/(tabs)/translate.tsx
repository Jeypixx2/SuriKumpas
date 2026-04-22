import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@dev-amirzubair/react-native-voice';
import { useAvatarContext } from '../../lib/AvatarContext';
import MicButton from '../../components/MicButton';
import { matchSpeechToLabel, FSLLabel, SequenceItem, tokenizeSentence } from '../../lib/labels';

const { width, height } = Dimensions.get('window');

export default function TranslateScreen() {
    const router = useRouter();
    const [isListening, setIsListening] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const {
        setSignToPlay, setLetterToPlay, sequenceToPlay, setSequenceToPlay, isAvatarLoaded
    } = useAvatarContext();

    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const onSpeechResults = useCallback((e: SpeechResultsEvent) => {
        const text = e.value?.[0] || '';
        setRecognizedText(text);
        setIsListening(false);

        const sequence = tokenizeSentence(text);

        if (sequence.length > 0) {
            setSequenceToPlay(sequence);
            setSignToPlay(null);
            setLetterToPlay(null);
            setErrorMessage(null);
        } else {
            setErrorMessage('Sign not available');
            setSequenceToPlay(null);
            setSignToPlay(null);
            setLetterToPlay(null);

            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                setErrorMessage(null);
            }, 3000);
        }
    }, [setSequenceToPlay, setSignToPlay, setLetterToPlay]);

    const onSpeechError = useCallback((e: SpeechErrorEvent) => {
        console.warn('Speech error:', e.error);
        
        // Error 7 is "No match" - just means silence. Don't complain to user.
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
    }, []);

    useEffect(() => {
        // Re-register listeners every time the callbacks update (avoids stale closures)
        Voice.onSpeechResults = onSpeechResults;
        Voice.onSpeechError = onSpeechError;
    }, [onSpeechResults, onSpeechError]);

    useEffect(() => {
        return () => {
            Voice.destroy().then(() => Voice.removeAllListeners());
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const toggleListening = useCallback(async () => {
        if (!Voice) {
            console.error("Voice module not linked natively");
            setErrorMessage("Voice module not linked natively. Rebuild the app using npx expo run:android");
            return;
        }

        if (!isAvatarLoaded) {
            setErrorMessage("Please wait for the 3D Avatar to finish loading.");
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                setErrorMessage(null);
            }, 3000);
            return;
        }

        if (isListening) {
            try {
                await Voice.stop();
                setIsListening(false);
            } catch (error) {
                console.error('Error stopping voice:', error);
            }
        } else {
            try {
                setRecognizedText('');
                setErrorMessage(null);
                setSequenceToPlay(null);
                setSignToPlay(null);
                setLetterToPlay(null);
                // ALWAYS enforce en-US on OEM devices to prevent Error 11 language pack rejects
                await Voice.start('en-US'); 
                setIsListening(true);
            } catch (error) {
                console.error('Error starting voice:', error);
                setErrorMessage('Could not start speech recognition. Check microphone permissions.');
            }
        }
    }, [isListening, isAvatarLoaded]);

    return (
        <View style={styles.container}>
            <View style={styles.topHalf}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                >
                    <MaterialIcons name="arrow-back" size={28} color="#ffffff" />
                </TouchableOpacity>
            </View>

            <View style={styles.bottomHalf}>
                <View style={styles.textContainer}>
                    {recognizedText ? (
                        <Text style={styles.recognizedText}>
                            "{recognizedText}"
                        </Text>
                    ) : null}

                    {errorMessage ? (
                        <Text style={styles.errorText}>{errorMessage}</Text>
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
                        {isListening ? 'Listening...' : 'Tap to speak'}
                    </Text>
                </View>

                <View style={styles.dotPatternBackground}>
                    {Array.from({ length: 20 }).map((_, i) => (
                        <View
                            key={i}
                            style={[
                                styles.bgDot,
                                {
                                    // Use absolute numbers similar to detect layout
                                    left: (i % 5) * 80 + 20,
                                    top: Math.floor(i / 5) * 80 + 20
                                }
                            ]}
                        />
                    ))}
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
        backgroundColor: '#0a0a0a', // Solid dark background to hide any native Tab artifacting!
    },
    bottomHalf: {
        height: '50%',
        width: '100%',
        backgroundColor: '#111111',
        alignItems: 'center',
        borderTopWidth: 2,
        borderTopColor: '#00e5ff',
        position: 'relative',
        overflow: 'hidden',
    },
    backButton: {
        position: 'absolute',
        top: 50,
        left: 20,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
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
        width: 2,
        height: 2,
        borderRadius: 1,
        backgroundColor: 'rgba(0, 229, 255, 0.1)',
    },
    textContainer: {
        position: 'absolute',
        top: 30, // Position text near the top of the bottom half
        left: 20,
        right: 20,
        alignItems: 'center',
        zIndex: 5,
    },
    recognizedText: {
        color: '#ffffff',
        fontSize: 18,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    errorText: {
        color: '#ff4444',
        fontSize: 16,
        textAlign: 'center',
        marginTop: 10,
    },
    micContainer: {
        position: 'absolute',
        bottom: 50,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    micHint: {
        color: '#888888',
        fontSize: 14,
        marginTop: 15,
    },
    sequenceContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginTop: 15,
        gap: 8,
    },
    sequenceBadge: {
        backgroundColor: 'rgba(0, 229, 255, 0.15)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(0, 229, 255, 0.5)',
    },
    sequenceText: {
        color: '#00e5ff',
        fontSize: 12,
        fontWeight: 'bold',
    },
    moreText: {
        color: '#888888',
        fontSize: 12,
        alignSelf: 'center',
    },
    debugInfo: {
        marginTop: 5,
        opacity: 0.6,
    },
    debugText: {
        color: '#00e5ff',
        fontSize: 10,
        fontFamily: 'monospace',
    },
});
