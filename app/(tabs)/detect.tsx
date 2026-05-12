import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import CameraProcessor, { CameraProcessorRef } from '../../components/CameraProcessor';
import ResultOverlay from '../../components/ResultOverlay';
import { SignClassifier } from '../../lib/SignClassifier';
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
    const classifierRef = useRef(new SignClassifier());
    const modelSwitcherRef = useRef(new ModelSwitcher());
    const cameraRef = useRef<CameraProcessorRef>(null);
    const isFocused = useIsFocused();
    const { setSequenceToPlay, setLetterToPlay, setSignToPlay } = useAvatarContext();

    const [detectedLabel, setDetectedLabel] = useState<FSLLabel | null>(null);
    const [confidence, setConfidence] = useState(0);
    const [showResult, setShowResult] = useState(false);
    const [status, setStatus] = useState('Paghahanda...');
    const [debugInfo, setDebugInfo] = useState('');
    const [isMirrored, setIsMirrored] = useState(true); // Default to selfie mode
 
    const frameBufferRef = useRef<Float32Array[]>([]);
    const predictionHistoryRef = useRef<string[]>([]); // Rolling buffer for stability
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
            
            // CRITICAL: Pad buffer with 0s to maintain sequence timing instead of clearing it
            frameBufferRef.current.push(new Float32Array(1662));
            if (frameBufferRef.current.length > 30) frameBufferRef.current.shift();
            
            predictionHistoryRef.current = [];
            modelSwitcherRef.current.reset();
            return;
        }
 
        const now = Date.now();
        // Allow slightly faster processing
        if (now - lastDetectionRef.current < 100) return;
 
        // Check for hands at the correct new indices
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
            
            // CRITICAL: Pad buffer with 0s to maintain sequence timing
            frameBufferRef.current.push(new Float32Array(1662));
            if (frameBufferRef.current.length > 30) frameBufferRef.current.shift();
            
            modelSwitcherRef.current.reset();
            return;
        }
 
        const movementResult = modelSwitcherRef.current.detectMovement(keypoints);
        
        // APPLY MIRRORING FIX IF NEEDED
        // We modify keypoints in-place to avoid allocations (it's a fresh copy from the WebView bridge anyway)
        if (!isMirrored) {
            // Combine all loops into one for better performance
            // 1. Pose (0..131)
            for (let i = 0; i < 132; i += 4) {
                if (keypoints[i] !== 0) keypoints[i] = 1.0 - keypoints[i];
            }
            // 2. Face (132..1535)
            for (let i = 132; i < 1536; i += 3) {
                if (keypoints[i] !== 0) keypoints[i] = 1.0 - keypoints[i];
            }
            // 3. Hands (1536..1661)
            for (let i = 1536; i < 1662; i += 3) {
                if (keypoints[i] !== 0) keypoints[i] = 1.0 - keypoints[i];
            }

            // IMPORTANT: Swapping LH and RH data because flipping X turns a left hand into a right hand
            // We use a small temporary buffer for the swap
            const tempLH = keypoints.slice(1536, 1599);
            const tempRH = keypoints.slice(1599, 1662);
            keypoints.set(tempRH, 1536);
            keypoints.set(tempLH, 1599);
        }

        const processedKeypoints = keypoints;

        // UNCONDITIONALLY maintain 30 frame window for temporal consistency
        frameBufferRef.current.push(processedKeypoints);
        if (frameBufferRef.current.length > 30) frameBufferRef.current.shift();

        const movStr = `Mov:${movementResult.confidence.toFixed(2)}`;
 
        // Prevent concurrent TFLite inferences which cause native crashes
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;

        try {
            // If the hand is completely still, run the Alphabet model
            if (movementResult.confidence >= 1.0) {
            setStatus('Sinusuri ang letra...');
            
            try {
                const result = await classifierRef.current.classifyAlphabet(processedKeypoints);
                const letter = ALPHABET_LABELS[result.letterIndex];
                setDebugInfo(`${movStr} | Letra: ${letter} (${(result.confidence * 100).toFixed(0)}%)`);
 
                if (result.confidence > 0.15 && letter) {
                    // Rolling average for letters
                    predictionHistoryRef.current.push(letter);
                    if (predictionHistoryRef.current.length > 5) predictionHistoryRef.current.shift();

                    // Count occurrences
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
            // Hand is moving or transitioning, run the FSL model
                setStatus('Kumukumpas...');
                
                if (frameBufferRef.current.length === 30) {
                    try {
                        const result = await classifierRef.current.classifyFSL(frameBufferRef.current);
                        const label = getLabelById(result.labelIndex);
                        
                        setDebugInfo(`${movStr} | FSL: ${label.english} (${(result.confidence * 100).toFixed(0)}%)`);
     
                        // Lowered threshold to 0.40 to ensure signs trigger reliably
                        if (result.confidence > 0.40) { 
                            setStatus(`Natukoy: ${label.filipino} (${(result.confidence * 100).toFixed(0)}%)`);
                            
                            predictionHistoryRef.current.push(label.english);
                            if (predictionHistoryRef.current.length > 2) predictionHistoryRef.current.shift();
     
                            // Require 2 consecutive frames of the exact same prediction
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
                            // Break the consistency chain if confidence drops
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
                    <MaterialIcons name="arrow-back" size={28} color="#ffffff" />
                </TouchableOpacity>
            </View>

            <View style={styles.bottomHalf}>
                <Text style={styles.statusText}>{status}</Text>
                {!!debugInfo && <Text style={styles.debugText}>{debugInfo}</Text>}
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
                    <MaterialIcons name="flip" size={24} color="#00e5ff" />
                    <Text style={styles.mirrorText}>{isMirrored ? 'Mirrored' : 'Normal'}</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0a0a0a' },
    topHalf: { height: '50%', width: '100%', position: 'relative' },
    bottomHalf: { 
        height: '50%', width: '100%', backgroundColor: '#111111', 
        justifyContent: 'center', alignItems: 'center',
        borderTopWidth: 2, borderTopColor: '#00e5ff' 
    },
    camera: { flex: 1 },
    backButton: {
        position: 'absolute', top: 50, left: 20, width: 44, height: 44,
        borderRadius: 22, backgroundColor: 'rgba(0, 0, 0, 0.5)',
        alignItems: 'center', justifyContent: 'center', zIndex: 10,
    },
    statusText: {
        position: 'absolute', top: 30, color: '#00e5ff', fontSize: 13,
        fontWeight: '600', textTransform: 'uppercase', letterSpacing: 2,
    },
    debugText: {
        position: 'absolute', top: 60, color: '#ffffff', fontSize: 11,
        backgroundColor: 'rgba(0, 0, 0, 0.6)', padding: 6, borderRadius: 4,
    },
    mirrorToggle: {
        position: 'absolute', bottom: 30, right: 20, 
        flexDirection: 'row', alignItems: 'center', 
        backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 20,
        borderWidth: 1, borderColor: '#00e5ff'
    },
    mirrorText: { color: '#00e5ff', marginLeft: 8, fontSize: 12, fontWeight: 'bold' },
    dotPattern: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' },
    dot: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: 'rgba(0, 229, 255, 0.15)' },
});
