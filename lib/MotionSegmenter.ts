export interface MotionConfig {
    T: number;
    start_speed: number;
    stop_speed: number;
    stop_hold_ms: number;
    pad_ms: number;
    min_ms: number;
    max_ms: number;
    max_missing: number;
    min_confidence: number;
    replace_window_ms: number;
    start_shapes: Record<string, string[]>;
}

export const DEFAULT_MOTION_CONFIG: MotionConfig = {
    T: 32,
    start_speed: 1.0,
    stop_speed: 0.5,
    stop_hold_ms: 200,
    pad_ms: 150,
    min_ms: 300,
    max_ms: 2500,
    max_missing: 0.25,
    min_confidence: 0.7,
    replace_window_ms: 1000,
    start_shapes: {
        J: ['I'],
        Z: []
    }
};

interface TimedFrame {
    landmarks: Float32Array; // 63 floats
    timestamp: number;
}

export class MotionSegmenter {
    private config: MotionConfig;
    private state: 'idle' | 'moving' = 'idle';

    private preRollBuffer: TimedFrame[] = [];
    private segmentFrames: TimedFrame[] = [];
    private prevLandmarks: Float32Array | null = null;
    private prevTimestamp: number = 0;

    private speedHistory: number[] = [];
    private segmentStartTime: number = 0;
    private lowSpeedStartTime: number | null = null;
    private noHandStartTime: number | null = null;
    private totalRecordedFrames = 0;
    private missingFramesCount = 0;

    constructor(config?: Partial<MotionConfig>) {
        this.config = { ...DEFAULT_MOTION_CONFIG, ...config };
    }

    /**
     * Compute hand size s_t = max_{i=1..20} dist(p_i, p_0) in (x, y)
     */
    public static computeHandSize(landmarks: Float32Array): number {
        const x0 = landmarks[0];
        const y0 = landmarks[1];
        let maxDist = 0;
        for (let i = 1; i < 21; i++) {
            const xi = landmarks[i * 3];
            const yi = landmarks[i * 3 + 1];
            const dist = Math.hypot(xi - x0, yi - y0);
            if (dist > maxDist) maxDist = dist;
        }
        return Math.max(maxDist, 0.05); // clamp min to avoid divide by zero
    }

    /**
     * Compute mean landmark displacement between two frames in (x, y)
     */
    public static computeMeanDisplacement(prev: Float32Array, curr: Float32Array): number {
        let total = 0;
        for (let i = 0; i < 21; i++) {
            const dx = curr[i * 3] - prev[i * 3];
            const dy = curr[i * 3 + 1] - prev[i * 3 + 1];
            total += Math.hypot(dx, dy);
        }
        return total / 21;
    }

    /**
     * Resample an arbitrary sequence of frames into exactly T * 63 floats using linear interpolation.
     */
    public static resampleSegment(frames: Float32Array[], targetFrames: number = 32): Float32Array {
        const result = new Float32Array(targetFrames * 63);
        const N = frames.length;
        if (N === 0) return result;
        if (N === 1) {
            for (let i = 0; i < targetFrames; i++) {
                result.set(frames[0], i * 63);
            }
            return result;
        }

        for (let m = 0; m < targetFrames; m++) {
            const u = (m / (targetFrames - 1)) * (N - 1);
            const k0 = Math.floor(u);
            const k1 = Math.min(k0 + 1, N - 1);
            const alpha = u - k0;
            const f0 = frames[k0];
            const f1 = frames[k1];
            const offset = m * 63;
            for (let j = 0; j < 63; j++) {
                result[offset + j] = (1 - alpha) * f0[j] + alpha * f1[j];
            }
        }
        return result;
    }

    /**
     * Feed a new hand landmarks frame (63 floats).
     * Returns a resampled Float32Array of (T * 63) if a valid motion gesture just completed, or null.
     */
    public processFrame(landmarks: Float32Array, timestamp: number = Date.now()): Float32Array | null {
        const handSize = MotionSegmenter.computeHandSize(landmarks);
        let speed = 0;

        if (this.prevLandmarks && this.prevTimestamp > 0) {
            const dt = Math.max((timestamp - this.prevTimestamp) / 1000, 0.005);
            const displacement = MotionSegmenter.computeMeanDisplacement(this.prevLandmarks, landmarks);
            const rawSpeed = displacement / handSize / dt;

            this.speedHistory.push(rawSpeed);
            if (this.speedHistory.length > 3) {
                this.speedHistory.shift();
            }
            speed = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;
        }

        this.prevLandmarks = landmarks;
        this.prevTimestamp = timestamp;

        if (this.state === 'idle') {
            // Keep rolling pre-roll buffer for pad_ms
            this.preRollBuffer.push({ landmarks, timestamp });
            while (
                this.preRollBuffer.length > 0 &&
                timestamp - this.preRollBuffer[0].timestamp > this.config.pad_ms
            ) {
                this.preRollBuffer.shift();
            }

            // Check if speed exceeds start threshold
            if (speed > this.config.start_speed) {
                this.state = 'moving';
                this.segmentFrames = [...this.preRollBuffer];
                this.segmentStartTime = this.segmentFrames.length > 0
                    ? this.segmentFrames[0].timestamp
                    : timestamp;
                this.segmentFrames.push({ landmarks, timestamp });
                this.lowSpeedStartTime = null;
                this.noHandStartTime = null;
                this.totalRecordedFrames = this.segmentFrames.length;
                this.missingFramesCount = 0;
            }
            return null;
        }

        // Currently in 'moving' state
        this.segmentFrames.push({ landmarks, timestamp });
        this.totalRecordedFrames++;
        this.noHandStartTime = null;

        const duration = timestamp - this.segmentStartTime;

        // Check if movement stopped
        if (speed < this.config.stop_speed) {
            if (this.lowSpeedStartTime === null) {
                this.lowSpeedStartTime = timestamp;
            } else if (timestamp - this.lowSpeedStartTime >= this.config.stop_hold_ms) {
                return this.finishSegment(timestamp);
            }
        } else {
            this.lowSpeedStartTime = null;
        }

        // Check max duration
        if (duration >= this.config.max_ms) {
            return this.finishSegment(timestamp);
        }

        return null;
    }

    /**
     * Notify segmenter that no hand was detected in this frame.
     * If currently moving, tracks missing hand and may finish or abort the motion segment.
     */
    public processNoHand(timestamp: number = Date.now()): Float32Array | null {
        this.prevLandmarks = null;
        this.prevTimestamp = 0;
        this.speedHistory = [];

        if (this.state === 'idle') {
            this.preRollBuffer = [];
            return null;
        }

        this.totalRecordedFrames++;
        this.missingFramesCount++;

        if (this.noHandStartTime === null) {
            this.noHandStartTime = timestamp;
        } else if (timestamp - this.noHandStartTime >= this.config.stop_hold_ms) {
            return this.finishSegment(timestamp);
        }

        return null;
    }

    private finishSegment(endTime: number): Float32Array | null {
        const duration = endTime - this.segmentStartTime;
        const frames = this.segmentFrames;

        this.state = 'idle';
        this.segmentFrames = [];
        this.preRollBuffer = [];
        this.lowSpeedStartTime = null;
        this.noHandStartTime = null;

        // Validation checks
        if (duration < this.config.min_ms || duration > this.config.max_ms) {
            return null;
        }

        if (this.totalRecordedFrames > 0) {
            const missingRatio = this.missingFramesCount / this.totalRecordedFrames;
            if (missingRatio > this.config.max_missing) {
                return null;
            }
        }

        if (frames.length < 4) {
            return null;
        }

        const rawArrays = frames.map(f => f.landmarks);
        return MotionSegmenter.resampleSegment(rawArrays, this.config.T);
    }

    public isMoving(): boolean {
        return this.state === 'moving';
    }

    public reset(): void {
        this.state = 'idle';
        this.preRollBuffer = [];
        this.segmentFrames = [];
        this.prevLandmarks = null;
        this.prevTimestamp = 0;
        this.speedHistory = [];
        this.lowSpeedStartTime = null;
        this.noHandStartTime = null;
    }
}

