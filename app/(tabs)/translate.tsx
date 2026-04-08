import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, View, Text, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@dev-amirzubair/react-native-voice';
import AvatarViewer from '../../components/AvatarViewer';
import MicButton from '../../components/MicButton';
import { matchSpeechToLabel, FSLLabel } from '../../lib/labels';

const { width, height } = Dimensions.get('window');

export default function TranslateScreen() {
    const router = useRouter();
    const [isListening, setIsListening] = useState(false);
    const [recognizedText, setRecognizedText] = useState('');
    const [signToPlay, setSignToPlay] = useState<string | null>(null);
    const [letterToPlay, setLetterToPlay] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        Voice.onSpeechResults = onSpeechResults;
        Voice.onSpeechError = onSpeechError;

        return () => {
            Voice.destroy().then(Voice.removeAllListeners);
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const onSpeechResults = useCallback((e: SpeechResultsEvent) => {
        const text = e.value?.[0] || '';
        setRecognizedText(text);
        setIsListening(false);

        const matchedLabel = matchSpeechToLabel(text);

        if (matchedLabel) {
            setSignToPlay(matchedLabel.english);
            setLetterToPlay(null);
            setErrorMessage(null);
        } else {
            setErrorMessage('Sign not available');
            setSignToPlay(null);
            setLetterToPlay(null);

            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                setErrorMessage(null);
            }, 3000);
        }
    }, []);

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

    const toggleListening = useCallback(async () => {
        if (!Voice) {
            console.error("Voice module not linked natively");
            setErrorMessage("Voice module not linked natively. Rebuild the app using npx expo run:android");
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
    }, [isListening]);

    return (
        <View style={styles.container}>
            <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.back()}
            >
                <MaterialIcons name="arrow-back" size={28} color="#ffffff" />
            </TouchableOpacity>

            <View style={styles.avatarContainer}>
                <AvatarViewer
                    style={styles.avatar}
                    signToPlay={signToPlay}
                    letterToPlay={letterToPlay}
                    onVRMLoaded={() => {}}
                    onError={(error) => console.error('Avatar error:', error)}
                />

                <View style={styles.dotPatternBackground}>
                    {Array.from({ length: 50 }).map((_, i) => (
                        <View
                            key={i}
                            style={[
                                styles.bgDot,
                                {
                                    left: (i % 10) * (width / 10) + 20,
                                    top: Math.floor(i / 10) * (height / 10) + 50
                                }
                            ]}
                        />
                    ))}
                </View>
            </View>

            <View style={styles.textContainer}>
                {recognizedText ? (
                    <Text style={styles.recognizedText}>
                        "{recognizedText}"
                    </Text>
                ) : null}

                {errorMessage ? (
                    <Text style={styles.errorText}>{errorMessage}</Text>
                ) : null}
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0a',
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
    avatarContainer: {
        position: 'absolute',
        top: 100,
        left: 20,
        right: 20,
        bottom: 250,
        borderRadius: 24,
        overflow: 'hidden',
        backgroundColor: '#0a0a0a',
        borderWidth: 2,
        borderColor: '#00e5ff',
        shadowColor: '#00e5ff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 30,
        elevation: 10,
    },
    avatar: {
        flex: 1,
    },
    dotPatternBackground: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
    },
    bgDot: {
        position: 'absolute',
        width: 3,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: 'rgba(0, 229, 255, 0.15)',
    },
    textContainer: {
        position: 'absolute',
        bottom: 180,
        left: 20,
        right: 20,
        alignItems: 'center',
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
});
