import { FSL_LABELS, ALPHABET_LABELS } from './labels';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

// Landmark index offsets matching extractKeypoints.ts order (Standard MediaPipe):
// Pose: 0..131, Face: 132..1535, LH: 1536..1598, RH: 1599..1661
const POSE_START = 0;
const FACE_START = 33 * 4;                        // 132
const LH_START   = FACE_START + 468 * 3;          // 1536
const RH_START   = LH_START + 21 * 3;            // 1599

export class SignClassifier {
    private fslModel: TensorflowModel | null = null;
    private alphabetModel: TensorflowModel | null = null;

    // Helper to ensure the asset is on the local filesystem with a 'file://' URI
    // react-native-fast-tflite's java.net.URL fails on Android if it's an asset:// or res:// URI
    private async getLocalModelUri(module: any, filename: string): Promise<string> {
        const [asset] = await Asset.loadAsync(module);
        if (asset.localUri && asset.localUri.startsWith('file://')) {
            return asset.localUri;
        }
        
        const destPath = (FileSystem as any).documentDirectory + filename;
        const info = await FileSystem.getInfoAsync(destPath);
        if (!info.exists) {
            await FileSystem.downloadAsync(asset.uri, destPath);
        }
        return destPath;
    }

    async loadFSLModel(): Promise<void> {
        try {
            const uri = await this.getLocalModelUri(require('../assets/fsl_model.tflite'), 'fsl_model.tflite');
            this.fslModel = await loadTensorflowModel({ url: uri }, []);
            console.log('[TFLite] FSL model loaded. Inputs:', this.fslModel.inputs);
        } catch (e) {
            console.error('[TFLite] Failed to load FSL model', e);
            throw e; // rethrow to be caught in UI if needed
        }
    }
 
    async loadAlphabetModel(): Promise<void> {
        try {
            const uri = await this.getLocalModelUri(require('../assets/alphabet_model.tflite'), 'alphabet_model.tflite');
            this.alphabetModel = await loadTensorflowModel({ url: uri }, []);
            console.log('[TFLite] Alphabet model loaded. Inputs:', this.alphabetModel.inputs);
        } catch (e) {
            console.error('[TFLite] Failed to load Alphabet model', e);
            throw e; // rethrow to be caught in UI if needed
        }
    }

    isFSLModelLoaded(): boolean { return this.fslModel !== null; }
    isAlphabetModelLoaded(): boolean { return this.alphabetModel !== null; }

    private normalizeToWrist(frame: Float32Array): Float32Array {
        const result = new Float32Array(frame);
 
        // Use the Pose-Face-LH-RH offsets: LH at 1536, RH at 1599
        // 1. Center left hand relative to left wrist
        const lx = result[LH_START];
        const ly = result[LH_START + 1];
        const lz = result[LH_START + 2];
        if (lx !== 0 || ly !== 0) {
            for (let i = LH_START; i < LH_START + 63; i += 3) {
                result[i] -= lx;
                result[i + 1] -= ly;
                result[i + 2] -= lz;
            }
        }
 
        // 2. Center right hand relative to right wrist
        const rx = result[RH_START];
        const ry = result[RH_START + 1];
        const rz = result[RH_START + 2];
        if (rx !== 0 || ry !== 0) {
            for (let i = RH_START; i < RH_START + 63; i += 3) {
                result[i] -= rx;
                result[i + 1] -= ry;
                result[i + 2] -= rz;
            }
        }
 
        return result;
    }

    async classifyFSL(frames: Float32Array[]): Promise<{ labelIndex: number; confidence: number }> {
        if (!this.fslModel) throw new Error('FSL model not loaded');
        
        // Match the training sequence length (30 frames)
        const SEQ_LENGTH = 30;
        const FRAME_SIZE = 1662;
        
        if (frames.length !== SEQ_LENGTH) {
            console.warn(`[TFLite] Expected ${SEQ_LENGTH} frames, got ${frames.length}. Model might misbehave.`);
        }

        const flatInput = new Float32Array(SEQ_LENGTH * FRAME_SIZE);
        for (let i = 0; i < Math.min(frames.length, SEQ_LENGTH); i++) {
            // NOTE: Normalization disabled to match training script logic
            // const normalized = this.normalizeToWrist(frames[i]);
            const normalized = frames[i];
            flatInput.set(normalized.slice(0, FRAME_SIZE), i * FRAME_SIZE);
        }

        const outputTensor = await this.fslModel.run([flatInput.buffer as ArrayBuffer]);
        const dataType = this.fslModel.outputs[0].dataType;
        const outputData = dataType === 'uint8' 
            ? new Uint8Array(outputTensor[0]) 
            : new Float32Array(outputTensor[0]);
        
        let predictedIdx = 0;
        let maxConfidence = 0;
        for (let i = 0; i < outputData.length; i++) {
            if (outputData[i] > maxConfidence) {
                maxConfidence = outputData[i];
                predictedIdx = i;
            }
        }

        // Auto-scale if model returns 0-255 instead of 0-1
        if (dataType === 'uint8' || maxConfidence > 1.0) maxConfidence = maxConfidence / 255.0;

        console.log(`[TFLite Debug] FSL Prediction: Index ${predictedIdx}, Confidence: ${maxConfidence.toFixed(4)}`);
        return { labelIndex: predictedIdx, confidence: maxConfidence };
    }

    async classifyAlphabet(frame: Float32Array): Promise<{ letterIndex: number; confidence: number }> {
        if (!this.alphabetModel) throw new Error('Alphabet model not loaded');

        // Check expected input size
        const shape = this.alphabetModel.inputs[0].shape;
        const expectedSize = shape.reduce((a, b) => a * b, 1);
        const FRAME_SIZE = 1662;
        let input: Float32Array;

        if (expectedSize === 63 || expectedSize === 126) {
            // Model only expects HAND landmarks (common for Alphabet/Fingerspelling)
            // Try to find the active hand
            const lh = frame.slice(LH_START, LH_START + 63);
            const rh = frame.slice(RH_START, RH_START + 63);
            
            const isLhActive = lh[0] !== 0 || lh[1] !== 0;
            const isRhActive = rh[0] !== 0 || rh[1] !== 0;

            if (expectedSize === 63) {
                // Single hand model — pick the one that's active
                const activeHand = isRhActive ? rh : (isLhActive ? lh : new Float32Array(63));
                input = this.normalizeHand(activeHand);
            } else {
                // Two hand model (126 features)
                input = new Float32Array(126);
                input.set(this.normalizeHand(lh), 0);
                input.set(this.normalizeHand(rh), 63);
            }
        } else {
            // Holistic model (expects 1662 features)
            input = frame.slice(0, FRAME_SIZE);
        }

        const outputTensor = await this.alphabetModel.run([input.buffer as ArrayBuffer]);
        const dataType = this.alphabetModel.outputs[0].dataType;
        const outputData = dataType === 'uint8' 
            ? new Uint8Array(outputTensor[0]) 
            : new Float32Array(outputTensor[0]);

        let predictedIdx = 0;
        let maxConfidence = 0;
        for (let i = 0; i < outputData.length; i++) {
            if (outputData[i] > maxConfidence) {
                maxConfidence = outputData[i];
                predictedIdx = i;
            }
        }

        if (dataType === 'uint8' || maxConfidence > 1.0) maxConfidence = maxConfidence / 255.0;
        console.log(`[TFLite Debug] Alphabet: Expected ${expectedSize}, Result: Index ${predictedIdx}, Conf: ${maxConfidence.toFixed(4)}`);
        return { letterIndex: predictedIdx, confidence: maxConfidence };
    }

    private normalizeHand(hand: Float32Array): Float32Array {
        const result = new Float32Array(hand);
        const wx = result[0];
        const wy = result[1];
        const wz = result[2];
        if (wx !== 0 || wy !== 0) {
            for (let i = 0; i < 63; i += 3) {
                result[i] -= wx;
                result[i + 1] -= wy;
                result[i + 2] -= wz;
            }
        }
        return result;
    }
}
