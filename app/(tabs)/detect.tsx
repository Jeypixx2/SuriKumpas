import React, { useState, useCallback, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
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
    const lastAttemptRef = useRef<number>(0);
 
    useEffect(() => {
        const loadModels = async () => {
            try {
                await classifierRef.current.loadFSLModel();
                await classifierRef.current.loadAlphabetModel();
                setStatus('Handa na. Itapat ang kamay.');
            } catch (error) {
                console.error('Error loading models:', error);
                setStatus('Error sa pagload ng model.');
            }
        };
        loadModels();
    }, []);
 
    const handleKeypointsExtracted = useCallback(async (keypoints: Float32Array | 'no-hands') => {
        if (keypoints === 'no-hands') {
            setStatus('Walang kamay na nakita.');
            setDebugInfo('');
            frameBufferRef.current = [];
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
            setDebugInfo('');
            frameBufferRef.current = [];
            predictionHistoryRef.current = [];
            modelSwitcherRef.current.reset();
            return;
        }
 
        const movementResult = modelSwitcherRef.current.detectMovement(keypoints);
        
        // APPLY MIRRORING FIX IF NEEDED
        let processedKeypoints = keypoints;
        if (!isMirrored) {
            processedKeypoints = new Float32Array(keypoints);
            
            // 1. Flip Pose (0..131, 4 values per landmark: x, y, z, v)
            for (let i = 0; i < 132; i += 4) {
                if (processedKeypoints[i] !== 0) processedKeypoints[i] = 1.0 - processedKeypoints[i];
            }
            
            // 2. Flip Face (132..1535, 3 values per landmark: x, y, z)
            for (let i = 132; i < 1536; i += 3) {
                if (processedKeypoints[i] !== 0) processedKeypoints[i] = 1.0 - processedKeypoints[i];
            }
            
            // 3. Flip Left Hand (1536..1598, 3 values per landmark: x, y, z)
            for (let i = 1536; i < 1599; i += 3) {
                if (processedKeypoints[i] !== 0) processedKeypoints[i] = 1.0 - processedKeypoints[i];
            }

            // 4. Flip Right Hand (1599..1661, 3 values per landmark: x, y, z)
            for (let i = 1599; i < 1662; i += 3) {
                if (processedKeypoints[i] !== 0) processedKeypoints[i] = 1.0 - processedKeypoints[i];
            }

            // IMPORTANT: Swapping LH and RH data might be needed if the model expects 
            // a specific hand, but usually the Alphabet model checks both.
        }

        const movStr = `Mov:${movementResult.confidence.toFixed(2)}`;
 
        if (movementResult.isMoving) {
            setStatus('Kumukumpas...');
            frameBufferRef.current.push(processedKeypoints);
            // Maintain 30 frame window
            if (frameBufferRef.current.length > 30) frameBufferRef.current.shift();
 
            if (frameBufferRef.current.length === 30) {
                if (now - lastAttemptRef.current < 80) return;
                lastAttemptRef.current = now;
 
                try {
                    const result = await classifierRef.current.classifyFSL(frameBufferRef.current);
                    const label = getLabelById(result.labelIndex);
                    
                    setDebugInfo(`${movStr} | FSL: ${label.english} (${(result.confidence * 100).toFixed(0)}%)`);
                    setStatus(`Natukoy: ${label.filipino} (${(result.confidence * 100).toFixed(0)}%)`);
 
                    if (result.confidence > 0.80) { 
                        // Push to history for stability (Temporal Filter)
                        predictionHistoryRef.current.push(label.english);
                        if (predictionHistoryRef.current.length > 2) predictionHistoryRef.current.shift();

                        // Only 'confirm' a sign if the same class is predicted for 2 consecutive windows
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
                    }
                } catch (e) {}
            }
        } else if (movementResult.confidence >= 1.0) {
            setStatus('Sinusuri ang letra...');
            if (now - lastAttemptRef.current < 150) return;
            lastAttemptRef.current = now;
 
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
                }
            } catch (e) {}
        } else {
            setStatus('I-steady ang kamay para sa letra.');
            setDebugInfo(movStr);
        }
    }, [isMirrored, setLetterToPlay, setSequenceToPlay]);

    return (
        <View style={styles.container}>
            <View style={styles.topHalf}>
                <CameraProcessor
                    ref={cameraRef}
                    style={styles.camera}
                    onKeypointsExtracted={handleKeypointsExtracted}
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
                    {Array.from({ length: 15 }).map((_, i) => (
                        <View key={i} style={[styles.dot, { left: (i % 5) * 80 + 40, top: Math.floor(i / 5) * 80 + 40 }]} />
                    ))}
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
