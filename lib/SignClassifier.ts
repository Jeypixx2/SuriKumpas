// TODO: Replace with real TFLite inference when using custom Expo build
// This is a mock implementation for Expo Go compatibility
// Real TFLite models require react-native-fast-tflite which needs custom native builds

import { FSL_LABELS, ALPHABET_LABELS } from './labels';

export class SignClassifier {
    private fslModelLoaded: boolean = false;
    private alphabetModelLoaded: boolean = false;

    async loadFSLModel(): Promise<void> {
        // Simulate model loading delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.fslModelLoaded = true;
        console.log('[Mock] FSL model loaded');
    }

    async loadAlphabetModel(): Promise<void> {
        // Simulate model loading delay
        await new Promise(resolve => setTimeout(resolve, 800));
        this.alphabetModelLoaded = true;
        console.log('[Mock] Alphabet model loaded');
    }

    isFSLModelLoaded(): boolean {
        return this.fslModelLoaded;
    }

    isAlphabetModelLoaded(): boolean {
        return this.alphabetModelLoaded;
    }

    classifyFSL(frames: Float32Array[]): { labelIndex: number; confidence: number } {
        if (!this.fslModelLoaded) {
            throw new Error('FSL model not loaded');
        }

        if (frames.length !== 30) {
            throw new Error(`Expected 30 frames, got ${frames.length}`);
        }

        // Return random label with 70-99% confidence
        const randomIndex = Math.floor(Math.random() * FSL_LABELS.length);
        const confidence = 0.70 + Math.random() * 0.29; // 0.70 to 0.99

        return { labelIndex: randomIndex, confidence };
    }

    classifyAlphabet(frame: Float32Array): { letterIndex: number; confidence: number } {
        if (!this.alphabetModelLoaded) {
            throw new Error('Alphabet model not loaded');
        }

        if (frame.length !== 1662) {
            throw new Error(`Expected 1662 keypoints, got ${frame.length}`);
        }

        // Return random letter with 70-99% confidence
        const randomIndex = Math.floor(Math.random() * ALPHABET_LABELS.length);
        const confidence = 0.70 + Math.random() * 0.29; // 0.70 to 0.99

        return { letterIndex: randomIndex, confidence };
    }
}
