import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';

export interface AlphabetImageFrame {
    width: number;
    height: number;
    rgb: Uint8Array | number[] | Float32Array;
    channels?: 3 | 4;
}

export interface AlphabetImagePrediction {
    label: string;
    confidence: number;
    index: number;
}

const IMAGE_SIZE = 160;
const RGB_CHANNELS = 3;
const INPUT_PIXEL_COUNT = IMAGE_SIZE * IMAGE_SIZE * RGB_CHANNELS;

const MODEL_ASSET = require('../assets/fsl_alphabet_model.tflite');
const LABEL_ASSET = require('../assets/labels.txt');

export class AlphabetImageClassifier {
    private model: TensorflowModel | null = null;
    private labels: string[] = [];
    private loadPromise: Promise<void> | null = null;

    async load(): Promise<void> {
        if (this.model && this.labels.length > 0) return;

        if (!this.loadPromise) {
            this.loadPromise = (async () => {
                const [modelUri, labelsText] = await Promise.all([
                    this.getLocalAssetUri(MODEL_ASSET, 'fsl_alphabet_model.tflite'),
                    this.readTextAsset(LABEL_ASSET, 'labels.txt'),
                ]);

                this.labels = labelsText
                    .split(/\r?\n/)
                    .map(label => label.trim())
                    .filter(Boolean);

                if (this.labels.length === 0) {
                    throw new Error('labels.txt is empty. Add one label per line.');
                }

                this.model = await loadTensorflowModel({ url: modelUri }, []);
            })().finally(() => {
                this.loadPromise = null;
            });
        }

        return this.loadPromise;
    }

    async classify(frame: AlphabetImageFrame): Promise<AlphabetImagePrediction> {
        await this.load();

        if (!this.model) {
            throw new Error('Alphabet image model is not loaded.');
        }

        const rgb160 = this.resizeToModelInput(frame);
        const inputTensor = this.createInputTensor(rgb160);
        const outputTensor = await this.model.run([inputTensor.buffer as ArrayBuffer]);
        const probabilities = this.readOutputProbabilities(outputTensor[0]);

        let bestIndex = 0;
        let bestConfidence = -Infinity;
        for (let i = 0; i < probabilities.length; i++) {
            if (probabilities[i] > bestConfidence) {
                bestConfidence = probabilities[i];
                bestIndex = i;
            }
        }

        return {
            label: this.labels[bestIndex] ?? `CLASS_${bestIndex}`,
            confidence: bestConfidence,
            index: bestIndex,
        };
    }

    private async getLocalAssetUri(module: number, filename: string): Promise<string> {
        const [asset] = await Asset.loadAsync(module);
        if (asset.localUri && asset.localUri.startsWith('file://')) {
            return asset.localUri;
        }

        const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
        if (!baseDir) {
            throw new Error('No writable directory is available for bundled assets.');
        }

        const destination = baseDir + filename;
        const info = await FileSystem.getInfoAsync(destination);
        if (!info.exists) {
            await FileSystem.downloadAsync(asset.uri, destination);
        }
        return destination;
    }

    private async readTextAsset(module: number, filename: string): Promise<string> {
        const uri = await this.getLocalAssetUri(module, filename);
        return FileSystem.readAsStringAsync(uri);
    }

    private resizeToModelInput(frame: AlphabetImageFrame): Uint8Array {
        const channels = frame.channels ?? 3;
        const source = frame.rgb;

        if (frame.width === IMAGE_SIZE && frame.height === IMAGE_SIZE && channels === 3) {
            return this.toUint8Rgb(source);
        }

        const resized = new Uint8Array(INPUT_PIXEL_COUNT);
        for (let y = 0; y < IMAGE_SIZE; y++) {
            const sourceY = Math.min(frame.height - 1, Math.floor((y / IMAGE_SIZE) * frame.height));

            for (let x = 0; x < IMAGE_SIZE; x++) {
                const sourceX = Math.min(frame.width - 1, Math.floor((x / IMAGE_SIZE) * frame.width));
                const sourceIndex = (sourceY * frame.width + sourceX) * channels;
                const targetIndex = (y * IMAGE_SIZE + x) * RGB_CHANNELS;

                resized[targetIndex] = this.clampByte(source[sourceIndex]);
                resized[targetIndex + 1] = this.clampByte(source[sourceIndex + 1]);
                resized[targetIndex + 2] = this.clampByte(source[sourceIndex + 2]);
            }
        }

        return resized;
    }

    private toUint8Rgb(source: Uint8Array | number[] | Float32Array): Uint8Array {
        if (
            source instanceof Uint8Array &&
            source.length === INPUT_PIXEL_COUNT &&
            source.byteOffset === 0 &&
            source.byteLength === source.buffer.byteLength
        ) {
            return source;
        }

        const result = new Uint8Array(INPUT_PIXEL_COUNT);
        for (let i = 0; i < INPUT_PIXEL_COUNT; i++) {
            result[i] = this.clampByte(source[i]);
        }
        return result;
    }

    private createInputTensor(rgb: Uint8Array): Uint8Array | Float32Array | Int8Array {
        const inputType = this.getInputDataType();

        if (inputType === 'uint8') {
            return rgb;
        }

        if (inputType === 'int8') {
            const tensor = new Int8Array(INPUT_PIXEL_COUNT);
            for (let i = 0; i < rgb.length; i++) {
                tensor[i] = rgb[i] - 128;
            }
            return tensor;
        }

        const tensor = new Float32Array(INPUT_PIXEL_COUNT);
        for (let i = 0; i < rgb.length; i++) {
            // The model already contains MobileNetV2 preprocess_input.
            // Feed raw RGB values in the normal 0..255 range.
            tensor[i] = rgb[i];
        }
        return tensor;
    }

    private readOutputProbabilities(output: ArrayBuffer): Float32Array {
        if (!this.model) {
            throw new Error('Alphabet image model is not loaded.');
        }

        const outputType = String((this.model.outputs?.[0] as any)?.dataType ?? 'float32').toLowerCase();

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

    private getInputDataType(): string {
        return String((this.model?.inputs?.[0] as any)?.dataType ?? 'float32').toLowerCase();
    }

    private clampByte(value: number): number {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(255, Math.round(value)));
    }
}

export const globalAlphabetImageClassifier = new AlphabetImageClassifier();
