import React, { useState, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import CameraProcessor from '../../components/CameraProcessor';
import AvatarViewer from '../../components/AvatarViewer';
import ResultOverlay from '../../components/ResultOverlay';
import { SignClassifier } from '../../lib/SignClassifier';
import { ModelSwitcher } from '../../lib/ModelSwitcher';
import { getLabelById, FSLLabel, ALPHABET_LABELS } from '../../lib/labels';

const { width, height } = Dimensions.get('window');

export default function DetectScreen() {
    const router = useRouter();
    const classifierRef = useRef(new SignClassifier());
    const modelSwitcherRef = useRef(new ModelSwitcher());

    const [detectedLabel, setDetectedLabel] = useState<FSLLabel | null>(null);
    const [confidence, setConfidence] = useState(0);
    const [showResult, setShowResult] = useState(false);
    const [signToPlay, setSignToPlay] = useState<string | null>(null);
    const [letterToPlay, setLetterToPlay] = useState<string | null>(null);

    const frameBufferRef = useRef<Float32Array[]>([]);
    const lastDetectionRef = useRef<number>(0);

    useEffect(() => {
        const loadModels = async () => {
            try {
                await classifierRef.current.loadFSLModel();
                await classifierRef.current.loadAlphabetModel();
            } catch (error) {
                console.error('Error loading models:', error);
            }
        };
        loadModels();
    }, []);

    const handleKeypointsExtracted = useCallback((keypoints: Float32Array) => {
        const now = Date.now();
        if (now - lastDetectionRef.current < 500) return;

        const movementResult = modelSwitcherRef.current.detectMovement(keypoints);

        if (movementResult.isMoving) {
            frameBufferRef.current.push(keypoints);

            if (frameBufferRef.current.length >= 30) {
                try {
                    const result = classifierRef.current.classifyFSL(frameBufferRef.current.slice(-30));
                    const label = getLabelById(result.labelIndex);

                    if (result.confidence > 0.7) {
                        setDetectedLabel(label);
                        setConfidence(result.confidence);
                        setShowResult(true);
                        setSignToPlay(label.english);
                        setLetterToPlay(null);
                        lastDetectionRef.current = now;

                        setTimeout(() => setShowResult(false), 3000);
                    }
                } catch (error) {
                    console.error('Classification error:', error);
                }

                frameBufferRef.current = [];
            }
        } else if (movementResult.confidence >= 1.0) {
            try {
                const result = classifierRef.current.classifyAlphabet(keypoints);
                const letter = ALPHABET_LABELS[result.letterIndex];

                if (result.confidence > 0.6 && letter) {
                    const label: FSLLabel = {
                        id: 200 + result.letterIndex,
                        english: letter,
                        filipino: letter,
                        category: 'ALPHABET'
                    };
                    setDetectedLabel(label);
                    setConfidence(result.confidence);
                    setShowResult(true);
                    setLetterToPlay(letter);
                    setSignToPlay(null);
                    lastDetectionRef.current = now;

                    setTimeout(() => setShowResult(false), 3000);
                }
            } catch (error) {
                console.error('Alphabet classification error:', error);
            }
        }
    }, []);

    return (
        <View style={styles.container}>
            <CameraProcessor
                style={styles.camera}
                onKeypointsExtracted={handleKeypointsExtracted}
            />

            <TouchableOpacity
                style={styles.backButton}
                onPress={() => router.back()}
            >
                <MaterialIcons name="arrow-back" size={28} color="#ffffff" />
            </TouchableOpacity>

            <Text style={styles.instructionText}>
                Show a sign to detect
            </Text>

            <ResultOverlay
                label={detectedLabel}
                confidence={confidence}
                visible={showResult}
            />

            <View style={styles.avatarContainer}>
                <AvatarViewer
                    style={styles.avatar}
                    signToPlay={signToPlay}
                    letterToPlay={letterToPlay}
                    onVRMLoaded={() => {}}
                    onError={(error) => console.error('Avatar error:', error)}
                />
            </View>

            <View style={styles.dotPattern}>
                {Array.from({ length: 20 }).map((_, i) => (
                    <View
                        key={i}
                        style={[
                            styles.dot,
                            { left: (i % 5) * 80 + 20, top: Math.floor(i / 5) * 80 + 100 }
                        ]}
                    />
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0a',
    },
    camera: {
        flex: 1,
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
    instructionText: {
        position: 'absolute',
        top: 120,
        left: 0,
        right: 0,
        textAlign: 'center',
        color: 'rgba(255, 255, 255, 0.7)',
        fontSize: 16,
        zIndex: 5,
    },
    avatarContainer: {
        position: 'absolute',
        bottom: 100,
        right: 20,
        width: 200,
        height: 250,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: '#00e5ff',
        backgroundColor: 'rgba(10, 10, 10, 0.8)',
        shadowColor: '#00e5ff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
    },
    avatar: {
        flex: 1,
    },
    dotPattern: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
    },
    dot: {
        position: 'absolute',
        width: 2,
        height: 2,
        borderRadius: 1,
        backgroundColor: 'rgba(0, 229, 255, 0.1)',
    },
});
