import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

export interface FSLWordPrediction {
    label: string;
    labelIndex: number;
    confidence: number;
    probabilities: number[];
}

export const WORD_MODEL_ASSET_PATH = 'assets/model/sign_model1.tflite';
export const WORD_LABEL_MAPPING_ASSET_PATH = 'assets/model/label_mapping.json';
export const WORD_FRAME_SIZE = 258;
export const DEFAULT_WORD_SEQUENCE_LENGTH = 30;
export const SUPPORTED_WORD_SEQUENCE_LENGTHS = new Set([30]);

const WORD_MODEL_ASSET = require('../assets/model/sign_model1.tflite');
const WORD_LABEL_MAPPING_ASSET = require('../assets/model/label_mapping.json');
const SELECT_TF_OP_PREFIX = 'Flex';
const WORD_CLASSIFIER_LOG_INTERVAL = 10;

interface TfliteModelInspection {
    inputShape: number[];
    customOps: string[];
}

export class SignClassifier {
    private fslModel: TensorflowModel | null = null;
    private fslLoadPromise: Promise<void> | null = null;
    private wordLabels: string[] = [];
    private wordSequenceLength = DEFAULT_WORD_SEQUENCE_LENGTH;
    private wordInputShape: number[] = [];
    private inferenceLogCounter = 0;

    private getCachedAssetFilename(asset: Asset, filename: string): string {
        if (!asset.hash) return filename;

        const extensionIndex = filename.lastIndexOf('.');
        if (extensionIndex <= 0) return `${filename}-${asset.hash}`;

        return `${filename.slice(0, extensionIndex)}-${asset.hash}${filename.slice(extensionIndex)}`;
    }

    // react-native-fast-tflite needs a local file:// URI on Android.
    private async getLocalAssetUri(module: number, filename: string): Promise<string> {
        const [asset] = await Asset.loadAsync(module);
        if (asset.localUri && asset.localUri.startsWith('file://')) {
            return asset.localUri;
        }

        const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
        if (!baseDir) {
            throw new Error('No writable directory is available for bundled model assets.');
        }

        const destination = baseDir + this.getCachedAssetFilename(asset, filename);
        const info = await FileSystem.getInfoAsync(destination);
        if (info.exists && !asset.hash) {
            await FileSystem.deleteAsync(destination, { idempotent: true });
        }
        if (!info.exists || !asset.hash) {
            await FileSystem.downloadAsync(asset.uri, destination);
        }
        return destination;
    }

    private async readTextAsset(module: number, filename: string): Promise<string> {
        const uri = await this.getLocalAssetUri(module, filename);
        return FileSystem.readAsStringAsync(uri);
    }

    private async readJsonAsset(module: unknown, filename: string): Promise<unknown> {
        if (typeof module === 'number') {
            const text = await this.readTextAsset(module, filename);
            return JSON.parse(text);
        }

        if (typeof module === 'string') {
            return JSON.parse(module);
        }

        const maybeDefault = (module as any)?.default;
        if (maybeDefault && typeof maybeDefault === 'object') {
            return maybeDefault;
        }

        return module;
    }

    async loadFSLModel(): Promise<void> {
        if (this.fslModel && this.wordLabels.length > 0) {
            console.log('[SignClassifier] Word SignClassifier already loaded.');
            return;
        }

        if (!this.fslLoadPromise) {
            this.fslLoadPromise = (async () => {
                try {
                    console.log(`[SignClassifier] Loading word model from ${WORD_MODEL_ASSET_PATH}`);
                    const [modelUri, labelMapping] = await Promise.all([
                        this.getLocalAssetUri(WORD_MODEL_ASSET, 'sign_model1.tflite'),
                        this.readJsonAsset(WORD_LABEL_MAPPING_ASSET, 'label_mapping.json'),
                    ]);

                    this.wordLabels = this.parseLabelMapping(labelMapping);
                    const modelInspection = await this.inspectLocalTfliteModel(modelUri);
                    this.applyWordInputShape(modelInspection.inputShape, 'preflight');
                    this.validateSupportedCustomOps(modelInspection.customOps);

                    console.log(
                        `[SignClassifier] label_mapping loaded from ${WORD_LABEL_MAPPING_ASSET_PATH} ` +
                        `(${this.wordLabels.length}): ${this.wordLabels.join(' | ')}`
                    );

                    this.fslModel = await loadTensorflowModel({ url: modelUri }, []);
                    this.validateWordModelContract();
                    console.log('[SignClassifier] Word FSL model loaded.', {
                        modelPath: WORD_MODEL_ASSET_PATH,
                        labelMappingPath: WORD_LABEL_MAPPING_ASSET_PATH,
                        inputShape: this.wordInputShape,
                        maxSequenceLength: this.wordSequenceLength,
                        inputs: this.fslModel.inputs,
                        outputs: this.fslModel.outputs,
                    });
                } catch (error: any) {
                    console.error('[SignClassifier] Failed to load word FSL model.', error);
                    throw new Error(
                        `Word model could not be loaded from ${WORD_MODEL_ASSET_PATH}. ` +
                        `Make sure ${WORD_LABEL_MAPPING_ASSET_PATH} is present and matches the model output. ` +
                        `Details: ${error?.message || String(error)}`
                    );
                } finally {
                    this.fslLoadPromise = null;
                }
            })();
        }

        return this.fslLoadPromise;
    }

    isFSLModelLoaded(): boolean { return this.fslModel !== null; }

    getSequenceLength(): number {
        return this.wordSequenceLength;
    }

    getInputShape(): number[] {
        return [...this.wordInputShape];
    }

    async classifyFSL(frames: Float32Array[]): Promise<FSLWordPrediction> {
        await this.loadFSLModel();

        if (!this.fslModel) {
            throw new Error('Word FSL model is not loaded.');
        }

        if (frames.length !== this.wordSequenceLength) {
            throw new Error(`Word inference requires exactly ${this.wordSequenceLength} frames, got ${frames.length}.`);
        }

        for (let i = 0; i < frames.length; i++) {
            if (frames[i].length !== WORD_FRAME_SIZE) {
                throw new Error(`Word frame ${i} must contain exactly ${WORD_FRAME_SIZE} values, got ${frames[i].length}.`);
            }
        }

        const inputSize = this.wordSequenceLength * WORD_FRAME_SIZE;
        const input = new Float32Array(inputSize);
        for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
            input.set(frames[frameIndex], frameIndex * WORD_FRAME_SIZE);
        }
        this.inferenceLogCounter += 1;
        const shouldLogInference = this.inferenceLogCounter <= 5 ||
            this.inferenceLogCounter % WORD_CLASSIFIER_LOG_INTERVAL === 0;
        if (shouldLogInference) {
            console.log(`[SignClassifier] Word input tensor length before inference: ${input.length}`);
        }

        const outputTensor = await this.fslModel.run([input.buffer as ArrayBuffer]);
        const probabilities = this.readOutputProbabilities(outputTensor[0], this.fslModel.outputs?.[0]?.dataType);
        const topPredictions = this.getTopPredictions(probabilities, 3);
        const bestPrediction = topPredictions[0] ?? { label: 'CLASS_0', confidence: 0, index: 0 };
        if (shouldLogInference) {
            console.log(
                '[SignClassifier] Word top 3 predictions: ' +
                topPredictions
                    .map(item => `${item.label}:${item.confidence.toFixed(4)}`)
                    .join(' | ')
            );
            console.log(`[SignClassifier] Word prediction: ${bestPrediction.label} (${bestPrediction.confidence.toFixed(4)})`);
        }

        return {
            label: bestPrediction.label,
            labelIndex: bestPrediction.index,
            confidence: bestPrediction.confidence,
            probabilities: Array.from(probabilities),
        };
    }

    private parseLabelMapping(parsed: unknown): string[] {
        const data = (parsed as any)?.default ?? parsed;
        const labels: string[] = [];

        if (Array.isArray(data)) {
            data.forEach((value, index) => {
                labels[index] = this.parseLabelValue(value, index);
            });
        } else if (data && typeof data === 'object') {
            Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
                const index = Number(key);
                if (!Number.isInteger(index) || index < 0) {
                    throw new Error(`${WORD_LABEL_MAPPING_ASSET_PATH} contains a non-numeric key: ${key}`);
                }
                labels[index] = this.parseLabelValue(value, index);
            });
        } else {
            throw new Error(`${WORD_LABEL_MAPPING_ASSET_PATH} must be a JSON object mapping output index to label.`);
        }

        if (labels.length === 0 || labels.every(label => !label)) {
            throw new Error(`${WORD_LABEL_MAPPING_ASSET_PATH} is empty. Add output-index-to-label entries.`);
        }

        return labels;
    }

    private parseLabelValue(value: unknown, index: number): string {
        const label = String(value ?? '').trim();
        if (!label) {
            throw new Error(`${WORD_LABEL_MAPPING_ASSET_PATH} contains an empty label at index ${index}.`);
        }
        return label;
    }

    private async inspectLocalTfliteModel(uri: string): Promise<TfliteModelInspection> {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
        const inspection = this.inspectTfliteModel(bytes);

        console.log(
            `[SignClassifier] Word model preflight input shape: [${inspection.inputShape.join(', ')}], ` +
            `custom ops: ${inspection.customOps.join(', ') || 'none'}`
        );

        return inspection;
    }

    private inspectTfliteModel(bytes: Uint8Array): TfliteModelInspection {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const readInt8 = (offset: number) => view.getInt8(offset);
        const readUint16 = (offset: number) => view.getUint16(offset, true);
        const readInt32 = (offset: number) => view.getInt32(offset, true);
        const readUint32 = (offset: number) => view.getUint32(offset, true);
        const rootTable = readUint32(0);

        const getFieldOffset = (tableOffset: number, fieldIndex: number): number => {
            const vtableOffset = tableOffset - readInt32(tableOffset);
            const vtableLength = readUint16(vtableOffset);
            const slotOffset = 4 + fieldIndex * 2;
            if (slotOffset >= vtableLength) return 0;

            const fieldOffset = readUint16(vtableOffset + slotOffset);
            return fieldOffset ? tableOffset + fieldOffset : 0;
        };

        const readVector = (fieldOffset: number): { start: number; length: number } => {
            const vectorOffset = fieldOffset + readUint32(fieldOffset);
            return {
                start: vectorOffset + 4,
                length: readUint32(vectorOffset),
            };
        };

        const readVectorObject = (fieldOffset: number, index: number): number => {
            const vector = readVector(fieldOffset);
            const objectRef = vector.start + index * 4;
            return objectRef + readUint32(objectRef);
        };

        const readInt32Vector = (fieldOffset: number): number[] => {
            const vector = readVector(fieldOffset);
            const values: number[] = [];
            for (let i = 0; i < vector.length; i++) {
                values.push(readInt32(vector.start + i * 4));
            }
            return values;
        };

        const readString = (fieldOffset: number): string => {
            const stringOffset = fieldOffset + readUint32(fieldOffset);
            const length = readUint32(stringOffset);
            let value = '';
            for (let i = 0; i < length; i++) {
                value += String.fromCharCode(view.getUint8(stringOffset + 4 + i));
            }
            return value;
        };

        const operatorCodesField = getFieldOffset(rootTable, 1);
        const customOps = new Set<string>();
        if (operatorCodesField) {
            const operatorCodes = readVector(operatorCodesField);
            for (let i = 0; i < operatorCodes.length; i++) {
                const operatorCodeTable = readVectorObject(operatorCodesField, i);
                const customCodeField = getFieldOffset(operatorCodeTable, 1);
                if (customCodeField) {
                    customOps.add(readString(customCodeField));
                } else {
                    const deprecatedBuiltinField = getFieldOffset(operatorCodeTable, 0);
                    const builtinCodeField = getFieldOffset(operatorCodeTable, 3);
                    const builtinCode = builtinCodeField
                        ? readInt32(builtinCodeField)
                        : deprecatedBuiltinField
                            ? readInt8(deprecatedBuiltinField)
                            : 0;
                    if (builtinCode === 32) customOps.add('CUSTOM');
                }
            }
        }

        const subgraphsField = getFieldOffset(rootTable, 2);
        if (!subgraphsField) {
            return { inputShape: [], customOps: Array.from(customOps) };
        }

        const subgraphTable = readVectorObject(subgraphsField, 0);
        const tensorsField = getFieldOffset(subgraphTable, 0);
        const inputsField = getFieldOffset(subgraphTable, 1);
        if (!tensorsField || !inputsField) {
            return { inputShape: [], customOps: Array.from(customOps) };
        }

        const inputTensorIndexes = readInt32Vector(inputsField);
        if (inputTensorIndexes.length === 0) {
            return { inputShape: [], customOps: Array.from(customOps) };
        }

        const tensors = readVector(tensorsField);
        const inputTensorRef = tensors.start + inputTensorIndexes[0] * 4;
        const inputTensorTable = inputTensorRef + readUint32(inputTensorRef);
        const shapeField = getFieldOffset(inputTensorTable, 0);

        return {
            inputShape: shapeField ? readInt32Vector(shapeField) : [],
            customOps: Array.from(customOps),
        };
    }

    private validateSupportedCustomOps(customOps: string[]): void {
        if (customOps.length === 0) return;

        const selectTfOps = customOps.filter(op => op.startsWith(SELECT_TF_OP_PREFIX));
        const operatorDescription = selectTfOps.length > 0
            ? `Select TF Ops/Flex operators: ${selectTfOps.join(', ')}`
            : `custom operators: ${customOps.join(', ')}`;
        throw new Error(
            `${WORD_MODEL_ASSET_PATH} uses unsupported ${operatorDescription}. ` +
            'react-native-fast-tflite in this app is built with LiteRT built-in ops only, so this model cannot allocate tensors on device. ' +
            'Re-export the model with TFLITE_BUILTINS only, for example by avoiding dynamic LSTM/TensorList conversion or using a mobile-friendly sequence layer.'
        );
    }

    private applyWordInputShape(inputShape: number[], source: string): void {
        this.wordInputShape = inputShape;
        console.log(`[SignClassifier] Word model input shape (${source}): [${inputShape.join(', ')}]`);

        if (inputShape.length >= 3) {
            const [batchSize, sequenceLength, frameSize] = inputShape.slice(-3);

            if (batchSize !== 1) {
                console.warn(`[SignClassifier] Word model batch size is ${batchSize}; expected 1.`);
            }

            if (!SUPPORTED_WORD_SEQUENCE_LENGTHS.has(sequenceLength)) {
                throw new Error(
                    `Word model input shape [${inputShape.join(', ')}] has unsupported sequence length ${sequenceLength}. ` +
                    'Expected 30.'
                );
            }

            if (frameSize !== WORD_FRAME_SIZE) {
                throw new Error(
                    `Word model input shape [${inputShape.join(', ')}] expects ${frameSize} values per frame, ` +
                    `but word mode provides ${WORD_FRAME_SIZE} pose+hands values.`
                );
            }

            this.wordSequenceLength = sequenceLength;
        } else {
            console.warn(
                `[SignClassifier] Word model input shape was unavailable from ${source}; ` +
                `defaulting to ${DEFAULT_WORD_SEQUENCE_LENGTH} frames.`
            );
            this.wordSequenceLength = DEFAULT_WORD_SEQUENCE_LENGTH;
        }
    }

    private validateWordModelContract(): void {
        if (!this.fslModel) return;

        const inputShape = this.getTensorShape(this.fslModel.inputs?.[0]);
        const outputShape = this.getTensorShape(this.fslModel.outputs?.[0]);
        const inputType = String((this.fslModel.inputs?.[0] as any)?.dataType ?? 'float32').toLowerCase();
        this.applyWordInputShape(inputShape, 'runtime');

        if (inputType && inputType !== 'float32') {
            console.warn(`[SignClassifier] Word model input dtype is ${inputType}; expected float32.`);
        }

        const outputCount = this.getElementCount(outputShape);
        if (outputCount > 0 && outputCount !== this.wordLabels.length) {
            console.warn(
                `[SignClassifier] Word model outputs ${outputCount} classes, but ${WORD_LABEL_MAPPING_ASSET_PATH} has ${this.wordLabels.length} labels.`
            );
        }
    }

    private readOutputProbabilities(output: ArrayBuffer, dataType?: string): Float32Array {
        const outputType = String(dataType ?? 'float32').toLowerCase();

        if (outputType === 'uint8') {
            const data = new Uint8Array(output);
            const probabilities = new Float32Array(data.length);
            for (let i = 0; i < data.length; i++) probabilities[i] = data[i] / 255;
            return probabilities;
        }

        if (outputType === 'int8') {
            const data = new Int8Array(output);
            const probabilities = new Float32Array(data.length);
            for (let i = 0; i < data.length; i++) probabilities[i] = (data[i] + 128) / 255;
            return probabilities;
        }

        return new Float32Array(output);
    }

    private getTopPredictions(probabilities: Float32Array, limit: number): Array<{ label: string; confidence: number; index: number }> {
        const top: Array<{ label: string; confidence: number; index: number }> = [];

        for (let i = 0; i < probabilities.length; i++) {
            const candidate = {
                label: this.wordLabels[i] ?? `CLASS_${i}`,
                confidence: probabilities[i],
                index: i,
            };
            const insertAt = top.findIndex(item => candidate.confidence > item.confidence);

            if (insertAt === -1) {
                if (top.length < limit) top.push(candidate);
            } else {
                top.splice(insertAt, 0, candidate);
                if (top.length > limit) top.pop();
            }
        }

        return top;
    }

    private getTensorShape(tensor: { shape?: number[] } | undefined): number[] {
        if (!Array.isArray(tensor?.shape)) return [];
        return tensor.shape
            .map(dim => Number(dim))
            .filter(dim => Number.isFinite(dim));
    }

    private getElementCount(shape: number[]): number {
        if (shape.length === 0 || shape.some(dim => dim <= 0)) return 0;
        return shape.reduce((count, dim) => count * dim, 1);
    }
}

export const globalClassifier = new SignClassifier();
