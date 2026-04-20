import React, { useState, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import CameraProcessor, { CameraProcessorRef } from '../../components/CameraProcessor';
import ResultOverlay from '../../components/ResultOverlay';
import { SignClassifier } from '../../lib/SignClassifier';
import { ModelSwitcher } from '../../lib/ModelSwitcher';
import { getLabelById, FSLLabel, ALPHABET_LABELS } from '../../lib/labels';

const { width, height } = Dimensions.get('window');

export default function DetectScreen() {
    const router = useRouter();
    const classifierRef = useRef(new SignClassifier());
    const modelSwitcherRef = useRef(new ModelSwitcher());
    const cameraRef = useRef<CameraProcessorRef>(null);

    const [detectedLabel, setDetectedLabel] = useState<FSLLabel | null>(null);
    const [confidence, setConfidence] = useState(0);
    const [showResult, setShowResult] = useState(false);

    const frameBufferRef = useRef<Float32Array[]>([]);
    const lastDetectionRef = useRef<number>(0);
    const lastAttemptRef = useRef<number>(0);

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

    const handleKeypointsExtracted = useCallback(async (keypoints: Float32Array) => {
        const now = Date.now();
        if (now - lastDetectionRef.current < 500) return;

        let handsDetected = false;
        const handStartIndex = 1536;
        for (let i = handStartIndex; i < handStartIndex + 126; i++) {
            if (keypoints[i] !== 0) {
                handsDetected = true;
                break;
            }
        }

        if (!handsDetected) {
            return;
        }

        const movementResult = modelSwitcherRef.current.detectMovement(keypoints);

        if (movementResult.isMoving) {
            frameBufferRef.current.push(keypoints);

            if (frameBufferRef.current.length >= 30) {
                if (now - lastAttemptRef.current < 150) return; // Cap inference to ~6 FPS
                lastAttemptRef.current = now;

                try {
                    const result = await classifierRef.current.classifyFSL(frameBufferRef.current.slice(-30));
                    const label = getLabelById(result.labelIndex);

                    if (result.confidence > 0.7) {
                        setDetectedLabel(label);
                        setConfidence(result.confidence);
                        setShowResult(true);
                        
                        cameraRef.current?.speak(label.filipino, 'fil-PH');
                        
                        lastDetectionRef.current = now;
                        frameBufferRef.current = [];

                        setTimeout(() => setShowResult(false), 3000);
                    }
                } catch (error) {
                    console.error('Classification error:', error);
                }
                
                if (frameBufferRef.current.length >= 30) {
                    frameBufferRef.current.shift(); // Remove oldest frame instead of discarding all
                }
            }
        } else if (movementResult.confidence >= 1.0) {
            if (now - lastAttemptRef.current < 200) return; // Cap Alphabet inference to 5 FPS
            lastAttemptRef.current = now;

            try {
                const result = await classifierRef.current.classifyAlphabet(keypoints);
                const letter = ALPHABET_LABELS[result.letterIndex];

                if (result.confidence > 0.6 && letter) {
                    const label: FSLLabel = {
                        id: 200 + result.letterIndex,
                        english: letter,
                        filipino: letter,
                        category: 'ALPABETO'
                    };
                    setDetectedLabel(label);
                    setConfidence(result.confidence);
                    setShowResult(true);
                    
                    cameraRef.current?.speak(letter, 'fil-PH');
                    
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
            <View style={styles.topHalf}>
                <CameraProcessor
                    ref={cameraRef}
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
                    Gumawa ng kumpas
                </Text>
            </View>

            <View style={styles.bottomHalf}>
                <ResultOverlay
                    label={detectedLabel}
                    confidence={confidence}
                    visible={showResult}
                />
                
                <View style={styles.dotPattern}>
                    {Array.from({ length: 20 }).map((_, i) => (
                        <View
                            key={i}
                            style={[
                                styles.dot,
                                { left: (i % 5) * 80 + 20, top: Math.floor(i / 5) * 80 + 20 }
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
        backgroundColor: '#0a0a0a',
    },
    topHalf: {
        height: '50%',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
    },
    bottomHalf: {
        height: '50%',
        width: '100%',
        backgroundColor: '#111111',
        justifyContent: 'center',
        alignItems: 'center',
        borderTopWidth: 2,
        borderTopColor: '#00e5ff',
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
