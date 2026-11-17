import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { MotionSegmenter, MotionConfig, DEFAULT_MOTION_CONFIG } from './MotionSegmenter';
import { PredictionStabilizer, StabilizerEvent, DEFAULT_STABILIZER_CONFIG } from './PredictionStabilizer';

const STATIC_MODEL_ASSET = require('../assets/model/alphabet/model.tflite');
const MOTION_MODEL_ASSET = require('../assets/model/alphabet/motion.tflite');
const LABELS_ASSET = require('../assets/model/alphabet/labels.json');
const MOTION_LABELS_ASSET = require('../assets/model/alphabet/motion_labels.json');
const MOTION_CONFIG_ASSET = require('../assets/model/alphabet/motion_config.json');

export interface AlphabetPredictionResult {
    event: StabilizerEvent;
    topLabel: string;
    confidence: number;
    source: 'static' | 'motion' | 'space';
}

function softmax(output: Float32Array | number[]): number[] {
    let max = -Infinity;
    for (let i = 0; i < output.length; i++) {
        if (output[i] > max) max = output[i];
    }
    let sum = 0;
    const exp = new Float32Array(output.length);
    for (let i = 0; i < output.length; i++) {
        exp[i] = Math.exp(output[i] - max);
        sum += exp[i];
    }
    const probs: number[] = new Array(output.length);
    for (let i = 0; i < output.length; i++) {
        probs[i] = sum > 0 ? exp[i] / sum : 0;
    }
    return probs;
}

function getProbabilities(rawOutput: Float32Array | number[]): number[] {
    let sum = 0;
    let allNonNegative = true;
    for (let i = 0; i < rawOutput.length; i++) {
        const val = rawOutput[i];
        if (val < 0) allNonNegative = false;
        sum += val;
    }
    if (allNonNegative && Math.abs(sum - 1.0) < 0.05) {
        return Array.from(rawOutput);
    }
    return softmax(rawOutput);
}

export class AlphabetClassifier {
    private staticModel: TensorflowModel | null = null;
    private motionModel: TensorflowModel | null = null;
    private labels: string[] = [];
    private motionLabels: string[] = [];
    private motionConfig: MotionConfig = DEFAULT_MOTION_CONFIG;

    private motionSegmenter: MotionSegmenter | null = null;
    private stabilizer: PredictionStabilizer | null = null;
    private loadPromise: Promise<void> | null = null;
    private isProcessing: boolean = false;

    private getCachedAssetFilename(asset: Asset, filename: string): string {
        if (!asset.hash) return filename;
        const extensionIndex = filename.lastIndexOf('.');
        if (extensionIndex <= 0) return `${filename}-${asset.hash}`;
        return `${filename.slice(0, extensionIndex)}-${asset.hash}${filename.slice(extensionIndex)}`;
    }

    private async getLocalAssetUri(module: number, filename: string): Promise<string> {
        const [asset] = await Asset.loadAsync(module);
        if (asset.localUri && asset.localUri.startsWith('file://')) {
            return asset.localUri;
        }

        const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
        if (!baseDir) {
            throw new Error('No writable directory is available for bundled model assets.');
        }

        const targetPath = `${baseDir}${this.getCachedAssetFilename(asset, filename)}`;
        const fileInfo = await FileSystem.getInfoAsync(targetPath);
        if (!fileInfo.exists) {
            await FileSystem.copyAsync({
                from: asset.localUri || asset.uri,
                to: targetPath
            });
        }

        return targetPath.startsWith('file://') ? targetPath : `file://${targetPath}`;
    }

    public async load(): Promise<void> {
        if (this.staticModel && this.motionModel && this.labels.length > 0) return;

        if (!this.loadPromise) {
            this.loadPromise = (async () => {
                try {
                    console.log('[AlphabetClassifier] Loading alphabet models...');

                    this.labels = Array.isArray(LABELS_ASSET) ? LABELS_ASSET : [];
                    this.motionLabels = Array.isArray(MOTION_LABELS_ASSET) ? MOTION_LABELS_ASSET : [];
                    this.motionConfig = { ...DEFAULT_MOTION_CONFIG, ...(MOTION_CONFIG_ASSET || {}) };

                    this.motionSegmenter = new MotionSegmenter(this.motionConfig);
                    this.stabilizer = new PredictionStabilizer({
                        startShapes: this.motionConfig.start_shapes,
                        replaceWindowMs: this.motionConfig.replace_window_ms,
                        minConfidence: this.motionConfig.min_confidence ?? 0.70,
                    });

                    const [staticModelUri, motionModelUri] = await Promise.all([
                        this.getLocalAssetUri(STATIC_MODEL_ASSET, 'alphabet_static_model.tflite'),
                        this.getLocalAssetUri(MOTION_MODEL_ASSET, 'alphabet_motion_model.tflite'),
                    ]);

                    const [staticM, motionM] = await Promise.all([
                        loadTensorflowModel({ url: staticModelUri }, []),
                        loadTensorflowModel({ url: motionModelUri }, []),
                    ]);

                    this.staticModel = staticM;
                    this.motionModel = motionM;

                    console.log('[AlphabetClassifier] Successfully loaded alphabet models:', {
                        staticClasses: this.labels.length,
                        motionClasses: this.motionLabels.length,
                    });
                } catch (error) {
                    this.staticModel = null;
                    this.motionModel = null;
                    this.loadPromise = null;
                    throw error;
                }
            })();
        }

        return this.loadPromise;
    }

    public isReady(): boolean {
        return !!(this.staticModel && this.motionModel && this.labels.length > 0);
    }

    /**
     * Process 21 hand landmarks (63 floats: [x0, y0, z0, ..., x20, y20, z20]).
     */
    public async processLandmarks(
        landmarks: Float32Array,
        timestamp: number = Date.now()
    ): Promise<AlphabetPredictionResult | null> {
        if (!this.staticModel || !this.motionModel || !this.motionSegmenter || !this.stabilizer) {
            return null;
        }

        if (this.isProcessing) {
            return null;
        }

        if (landmarks.length !== 63) {
            console.warn(`[AlphabetClassifier] Expected 63 landmarks, got ${landmarks.length}`);
            return null;
        }

        this.isProcessing = true;
        try {
            // 1. Process with MotionSegmenter
            const completedMotionSegment = this.motionSegmenter.processFrame(landmarks, timestamp);

            if (completedMotionSegment) {
                // Run motion model: input float32[1, 32, 63], output float32[1, 3]
                const motionOutputs = await this.motionModel.run([completedMotionSegment.buffer as ArrayBuffer]);
                const rawMotionOutput = new Float32Array(motionOutputs[0]);
                const probs = getProbabilities(rawMotionOutput);

                let bestIndex = 0;
                let maxProb = -1;
                for (let i = 0; i < probs.length; i++) {
                    if (probs[i] > maxProb) {
                        maxProb = probs[i];
                        bestIndex = i;
                    }
                }

                const motionLabel = this.motionLabels[bestIndex] || '_none';
                if (motionLabel !== '_none' && maxProb >= (this.motionConfig.min_confidence ?? 0.70)) {
                    const event = this.stabilizer.processMotionPrediction(motionLabel, maxProb, timestamp);
                    if (event) {
                        return {
                            event,
                            topLabel: motionLabel,
                            confidence: maxProb,
                            source: 'motion'
                        };
                    }
                }
            }

            // 2. If actively moving, don't trigger static predictions
            if (this.motionSegmenter.isMoving()) {
                return null;
            }

            // 3. Static inference: input float32[1, 63], output float32[1, 24]
            // DO NOT manually normalize the coordinates. The model internally
            // subtracts the wrist (landmark 0) and scales by hand size.
            const staticOutputs = await this.staticModel.run([landmarks.buffer as ArrayBuffer]);
            const rawStaticOutput = new Float32Array(staticOutputs[0]);
            const probs = getProbabilities(rawStaticOutput);

            let bestIndex = 0;
            let maxProb = -1;
            for (let i = 0; i < probs.length; i++) {
                if (probs[i] > maxProb) {
                    maxProb = probs[i];
                    bestIndex = i;
                }
            }

            const staticLabel = this.labels[bestIndex] || '';
            const event = this.stabilizer.processStaticPrediction(staticLabel, maxProb, timestamp);

            if (event) {
                return {
                    event,
                    topLabel: staticLabel,
                    confidence: maxProb,
                    source: 'static'
                };
            }

            return null;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Process no hand detected in the frame.
     */
    public async processNoHand(timestamp: number = Date.now()): Promise<AlphabetPredictionResult | null> {
        if (!this.motionModel || !this.motionSegmenter || !this.stabilizer) {
            return null;
        }

        if (this.isProcessing) {
            return null;
        }

        this.isProcessing = true;
        try {
            // 1. Notify motion segmenter (it might finish an in-progress gesture)
            const completedMotionSegment = this.motionSegmenter.processNoHand(timestamp);
            if (completedMotionSegment) {
                const motionOutputs = await this.motionModel.run([completedMotionSegment.buffer as ArrayBuffer]);
                const rawMotionOutput = new Float32Array(motionOutputs[0]);
                const probs = getProbabilities(rawMotionOutput);

                let bestIndex = 0;
                let maxProb = -1;
                for (let i = 0; i < probs.length; i++) {
                    if (probs[i] > maxProb) {
                        maxProb = probs[i];
                        bestIndex = i;
                    }
                }

                const motionLabel = this.motionLabels[bestIndex] || '_none';
                if (motionLabel !== '_none' && maxProb >= (this.motionConfig.min_confidence ?? 0.70)) {
                    const event = this.stabilizer.processMotionPrediction(motionLabel, maxProb, timestamp);
                    if (event) {
                        return {
                            event,
                            topLabel: motionLabel,
                            confidence: maxProb,
                            source: 'motion'
                        };
                    }
                }
            }

            // 2. Notify stabilizer (may emit space after 1s)
            const event = this.stabilizer.processNoHand(timestamp);
            if (event) {
                return {
                    event,
                    topLabel: ' ',
                    confidence: 1.0,
                    source: 'space'
                };
            }

            return null;
        } finally {
            this.isProcessing = false;
        }
    }

    public reset(): void {
        this.motionSegmenter?.reset();
        this.stabilizer?.reset();
    }
}

export const globalAlphabetClassifier = new AlphabetClassifier();
