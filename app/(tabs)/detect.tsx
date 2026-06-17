import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import CameraProcessor, { CameraProcessorRef } from '../../components/CameraProcessor';
import ResultOverlay from '../../components/ResultOverlay';
import { globalClassifier } from '../../lib/SignClassifier';
import { ModelSwitcher } from '../../lib/ModelSwitcher';
import { getLabelById, FSLLabel, ALPHABET_LABELS, tokenizeSentence } from '../../lib/labels';
import { useAvatarContext } from '../../lib/AvatarContext';
import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// Aligned with Pose-Face-LH-RH order:
// Pose: 0..131, Face: 132..1535, LH: 1536..1598, RH: 1599..1661
const LH_START = 1536;
const RH_START = 1599;

export default function DetectScreen() {
    const router = useRouter();
    const classifierRef = useRef(globalClassifier);
    const modelSwitcherRef = useRef(new ModelSwitcher());
    const cameraRef = useRef<CameraProcessorRef>(null);
    const isFocused = useIsFocused();
    const { setSequenceToPlay, setLetterToPlay, setSignToPlay } = useAvatarContext();

    const [detectedLabel, setDetectedLabel] = useState<FSLLabel | null>(null);
    const [confidence, setConfidence] = useState(0);
    const [showResult, setShowResult] = useState(false);
    const [status, setStatus] = useState('Paghahanda...');
    const [debugInfo, setDebugInfo] = useState('');
    const [isMirrored, setIsMirrored] = useState(true);
 
    const frameBufferRef = useRef<Float32Array[]>([]);
    const predictionHistoryRef = useRef<string[]>([]);
    const lastDetectionRef = useRef<number>(0);
    const isProcessingRef = useRef<boolean>(false);
    const lastAttemptRef = useRef<number>(0);
 
    useEffect(() => {
        if (!isFocused) {
            frameBufferRef.current = [];
            predictionHistoryRef.current = [];
            modelSwitcherRef.current.reset();
        }
    }, [isFocused]);

    // Pulse animation for active dot
    const pulseDot = useRef(new Animated.Value(0.4)).current;

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
    }, []);

    useEffect(() => {
        const loadModels = async () => {
            try {
                await classifierRef.current.loadFSLModel();
                await classifierRef.current.loadAlphabetModel();
                setStatus('Handa na. Itapat ang kamay.');
            } catch (error: any) {
                console.error('Error loading models:', error);
                setStatus('Error sa pagload ng model.');
                Alert.alert('Model Load Error', error.message || String(error));
            }
        };
        loadModels();
    }, []);
 
    const handleKeypointsExtracted = useCallback(async (keypoints: Float32Array | 'no-hands') => {
        if (!isFocused) return;
        if (keypoints === 'no-hands') {
            setStatus('Walang kamay na nakita.');
            
            frameBufferRef.current.push(new Float32Array(1662));
            if (frameBufferRef.current.length > 30) frameBufferRef.current.shift();
            
            predictionHistoryRef.current = [];
            modelSwitcherRef.current.reset();
            return;
        }
 
        const now = Date.now();
        if (now - lastDetectionRef.current < 100) return;
 
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
            setStatus('Walang kamay na nakita.');
            
            frameBufferRef.current.push(new Float32Array(1662));
            if (frameBufferRef.current.length > 30) frameBufferRef.current.shift();
            
            modelSwitcherRef.current.reset();
            return;
        }
 
        const movementResult = modelSwitcherRef.current.detectMovement(keypoints);
        
        if (!isMirrored) {
            for (let i = 0; i < 132; i += 4) {
                if (keypoints[i] !== 0) keypoints[i] = 1.0 - keypoints[i];
            }
            for (let i = 132; i < 1536; i += 3) {
                if (keypoints[i] !== 0) keypoints[i] = 1.0 - keypoints[i];
            }
            for (let i = 1536; i < 1662; i += 3) {
                if (keypoints[i] !== 0) keypoints[i] = 1.0 - keypoints[i];
            }

            const tempLH = keypoints.slice(1536, 1599);
            const tempRH = keypoints.slice(1599, 1662);
            keypoints.set(tempRH, 1536);
            keypoints.set(tempLH, 1599);
        }

        const processedKeypoints = keypoints;

        frameBufferRef.current.push(processedKeypoints);
        if (frameBufferRef.current.length > 30) frameBufferRef.current.shift();

        const movStr = `Mov:${movementResult.confidence.toFixed(2)}`;
 
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;

        try {
            if (movementResult.confidence >= 1.0) {
            setStatus('Sinusuri ang letra...');
            
            try {
                const result = await classifierRef.current.classifyAlphabet(processedKeypoints);
                const letter = ALPHABET_LABELS[result.letterIndex];
                setDebugInfo(`${movStr} | Letra: ${letter} (${(result.confidence * 100).toFixed(0)}%)`);
 
                if (result.confidence > 0.15 && letter) {
                    predictionHistoryRef.current.push(letter);
                    if (predictionHistoryRef.current.length > 5) predictionHistoryRef.current.shift();

                    const counts: { [key: string]: number } = {};
                    predictionHistoryRef.current.forEach(l => counts[l] = (counts[l] || 0) + 1);
                    const mostFrequent = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);

                    if (counts[mostFrequent] >= 3) {
                        const label: FSLLabel = { id: 200, english: mostFrequent, filipino: mostFrequent, category: 'ALPABETO' };
                        setDetectedLabel(label);
                        setConfidence(result.confidence);
                        setShowResult(true);
                        cameraRef.current?.speak(mostFrequent, 'fil-PH');
                        setLetterToPlay(mostFrequent);
    
                        lastDetectionRef.current = now;
                        predictionHistoryRef.current = [];
                        setTimeout(() => setShowResult(false), 2000);
                    }
                } else {
                    predictionHistoryRef.current = [];
                }
            } catch (e: any) {
                console.error("Alphabet Error:", e);
                setDebugInfo("Alphabet Err: " + (e.message || String(e)));
            }
        } else {
                setStatus('Kumukumpas...');
                
                if (frameBufferRef.current.length === 30) {
                    try {
                        const result = await classifierRef.current.classifyFSL(frameBufferRef.current);
                        const label = getLabelById(result.labelIndex);
                        
                        setDebugInfo(`${movStr} | FSL: ${label.english} (${(result.confidence * 100).toFixed(0)}%)`);
     
                        if (result.confidence > 0.40) { 
                            setStatus(`Natukoy: ${label.filipino} (${(result.confidence * 100).toFixed(0)}%)`);
                            
                            predictionHistoryRef.current.push(label.english);
                            if (predictionHistoryRef.current.length > 2) predictionHistoryRef.current.shift();
     
                            const isConsistent = predictionHistoryRef.current.length === 2 && 
                                                 predictionHistoryRef.current[0] === label.english &&
                                                 predictionHistoryRef.current[1] === label.english;
                            
                            if (isConsistent) {
                                setDetectedLabel(label);
                                setConfidence(result.confidence);
                                setShowResult(true);
                                cameraRef.current?.speak(label.filipino, 'fil-PH');
                                
                                const sequence = tokenizeSentence(label.english);
                                if (sequence.length > 0) setSequenceToPlay(sequence);
        
                                lastDetectionRef.current = now;
                                frameBufferRef.current = [];
                                predictionHistoryRef.current = [];
                                modelSwitcherRef.current.reset();
                                setTimeout(() => setShowResult(false), 2000);
                            }
                        } else {
                            predictionHistoryRef.current = [];
                        }
                    } catch (e: any) {
                        console.error("FSL Error:", e);
                        setDebugInfo("FSL Err: " + (e.message || String(e)));
                    }
                }
            }
        } finally {
            isProcessingRef.current = false;
        }
    }, [isMirrored, setLetterToPlay, setSequenceToPlay, isFocused]);

    return (
        <View style={styles.container}>
            <View style={styles.topHalf}>
                <CameraProcessor
                    ref={cameraRef}
                    style={styles.camera}
                    onKeypointsExtracted={handleKeypointsExtracted}
                    active={isFocused}
                />
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <MaterialIcons name="arrow-back" size={22} color="#2D3561" />
                </TouchableOpacity>
            </View>

            <View style={styles.bottomHalf}>
                {/* Custom Pulsing Status Pill */}
                <View style={styles.statusPill}>
                    <Animated.View style={[
                        styles.statusDot, 
                        { 
                            opacity: pulseDot,
                            backgroundColor: status.includes('Walang') ? '#FF8A65' : 
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
                    {useMemo(() => Array.from({ length: 15 }).map((_, i) => (
                        <View key={i} style={[styles.dot, { left: (i % 5) * 80 + 40, top: Math.floor(i / 5) * 80 + 40 }]} />
                    )), [])}
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
