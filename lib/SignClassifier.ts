import { FSL_LABELS, ALPHABET_LABELS } from './labels';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';

export class SignClassifier {
    private fslModel: TensorflowModel | null = null;
    private alphabetModel: TensorflowModel | null = null;

    async loadFSLModel(): Promise<void> {
        try {
            this.fslModel = await loadTensorflowModel(require('../assets/fsl_model.tflite'), []);
            console.log('[TFLite] FSL model loaded successfully');
        } catch (e) {
            console.error('[TFLite] Failed to load FSL model', e);
        }
    }

    async loadAlphabetModel(): Promise<void> {
        try {
            this.alphabetModel = await loadTensorflowModel(require('../assets/alphabet_model.tflite'), []);
            console.log('[TFLite] Alphabet model loaded successfully');
        } catch (e) {
            console.error('[TFLite] Failed to load Alphabet model', e);
        }
    }

    isFSLModelLoaded(): boolean {
        return this.fslModel !== null;
    }

    isAlphabetModelLoaded(): boolean {
        return this.alphabetModel !== null;
    }

    async classifyFSL(frames: Float32Array[]): Promise<{ labelIndex: number; confidence: number }> {
        if (!this.fslModel) {
            throw new Error('FSL model not loaded');
        }
        if (frames.length !== 30) {
            throw new Error(`Expected 30 frames, got ${frames.length}`);
        }

        // Flatten the 30 frames into a 1D array
        const inputSize = 30 * 1662;
        const flatInput = new Float32Array(inputSize);
        for (let i = 0; i < 30; i++) {
            flatInput.set(frames[i], i * 1662);
        }

        // Run the model asynchronously using the ArrayBuffer to prevent UI lag
        const outputTensor = await this.fslModel.run([flatInput.buffer]);
        const outputData = new Float32Array(outputTensor[0]);
        
        let predictedIdx = 0;
        let maxConfidence = 0;
        
        for (let i = 0; i < outputData.length; i++) {
            const conf = outputData[i];
            if (conf > maxConfidence) {
                maxConfidence = conf;
                predictedIdx = i;
            }
        }

        if (maxConfidence > 1.0) {
            maxConfidence = maxConfidence / 255.0;
        }

        return { labelIndex: predictedIdx, confidence: maxConfidence };
    }

    async classifyAlphabet(frame: Float32Array): Promise<{ letterIndex: number; confidence: number }> {
        if (!this.alphabetModel) {
            throw new Error('Alphabet model not loaded');
        }
        if (frame.length !== 1662) {
            throw new Error(`Expected 1662 keypoints, got ${frame.length}`);
        }

        const outputTensor = await this.alphabetModel.run([frame.buffer as ArrayBuffer]);
        const outputData = new Float32Array(outputTensor[0]);
        
        let predictedIdx = 0;
        let maxConfidence = 0;
        
        for (let i = 0; i < outputData.length; i++) {
            const conf = outputData[i];
            if (conf > maxConfidence) {
                maxConfidence = conf;
                predictedIdx = i;
            }
        }

        if (maxConfidence > 1.0) {
            maxConfidence = maxConfidence / 255.0;
        }

        return { letterIndex: predictedIdx, confidence: maxConfidence };
    }
}
