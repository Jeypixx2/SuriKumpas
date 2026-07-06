// Aligned with Pose-Face-LH-RH order:
// Pose: 0..131, Face: 132..1535, LH: 1536..1598, RH: 1599..1661
const LH_START = 1536;
const LH_END   = 1599;
const RH_START = 1599;
const RH_END   = 1662;

export type DetectionMode = 'alphabet' | 'sign' | 'waiting';

export class ModelSwitcher {
    private previousHandKeypoints: Float32Array | null = null;
    private smoothedHandKeypoints: Float32Array | null = null;
    private smoothedMovement: number = 0;
    private currentMode: DetectionMode = 'waiting';
    private readonly landmarkSmoothingAlpha = 0.55;
    private readonly movementSmoothingAlpha = 0.35;
    private readonly enterMovementThreshold = 0.008;
    private readonly exitMovementThreshold = 0.004;
    private stillFrameCount: number = 0;
    private movingFrameCount: number = 0;
    private readonly stillThreshold = 4;
    private readonly movingThreshold = 4;
    private readonly signReleaseThreshold = 7;

    detectMovement(currentKeypoints: Float32Array): { isMoving: boolean; confidence: number; mode: DetectionMode } {
        const currentHands = this.extractHands(currentKeypoints);
        const stableHands = this.smoothHands(currentHands);

        if (!this.previousHandKeypoints) {
            this.previousHandKeypoints = stableHands;
            return { isMoving: false, confidence: 0, mode: 'waiting' };
        }

        const movement = this.calculateMovement(this.previousHandKeypoints, stableHands);
        this.previousHandKeypoints = stableHands;
        this.smoothedMovement = this.smoothedMovement === 0
            ? movement
            : this.smoothedMovement + (movement - this.smoothedMovement) * this.movementSmoothingAlpha;

        const threshold = this.currentMode === 'sign'
            ? this.exitMovementThreshold
            : this.enterMovementThreshold;
        const movementFrame = this.smoothedMovement > threshold;

        if (movementFrame) {
            this.movingFrameCount++;
            this.stillFrameCount = 0;
        } else {
            this.stillFrameCount++;
            this.movingFrameCount = Math.max(0, this.movingFrameCount - 1);
        }

        if (this.currentMode === 'sign') {
            if (this.stillFrameCount >= this.signReleaseThreshold) {
                this.currentMode = 'alphabet';
                this.movingFrameCount = 0;
            }
        } else if (this.movingFrameCount >= this.movingThreshold) {
            this.currentMode = 'sign';
            this.stillFrameCount = 0;
        } else if (this.stillFrameCount >= this.stillThreshold) {
            this.currentMode = 'alphabet';
        }

        const confidence = Math.max(
            0,
            Math.min(1, 1 - (this.smoothedMovement / this.enterMovementThreshold))
        );

        return {
            isMoving: this.currentMode === 'sign',
            confidence,
            mode: this.currentMode,
        };
    }

    private extractHands(currentKeypoints: Float32Array): Float32Array {
        const currentHands = new Float32Array(126);
        let idx = 0;
        for (let i = LH_START; i < LH_END; i++) currentHands[idx++] = currentKeypoints[i];
        for (let i = RH_START; i < RH_END; i++) currentHands[idx++] = currentKeypoints[i];
        return currentHands;
    }

    private smoothHands(current: Float32Array): Float32Array {
        if (!this.smoothedHandKeypoints) {
            this.smoothedHandKeypoints = current;
            return current;
        }

        const smoothed = new Float32Array(current.length);
        for (let i = 0; i < current.length; i += 3) {
            const hasCurrent = this.hasLandmark(current, i);
            const hasPrevious = this.hasLandmark(this.smoothedHandKeypoints, i);

            if (hasCurrent && hasPrevious) {
                smoothed[i] = this.smoothedHandKeypoints[i] + (current[i] - this.smoothedHandKeypoints[i]) * this.landmarkSmoothingAlpha;
                smoothed[i + 1] = this.smoothedHandKeypoints[i + 1] + (current[i + 1] - this.smoothedHandKeypoints[i + 1]) * this.landmarkSmoothingAlpha;
                smoothed[i + 2] = this.smoothedHandKeypoints[i + 2] + (current[i + 2] - this.smoothedHandKeypoints[i + 2]) * this.landmarkSmoothingAlpha;
            } else {
                smoothed[i] = current[i];
                smoothed[i + 1] = current[i + 1];
                smoothed[i + 2] = current[i + 2];
            }
        }

        this.smoothedHandKeypoints = smoothed;
        return smoothed;
    }

    private calculateMovement(prev: Float32Array, curr: Float32Array): number {
        let totalDiff = 0;
        let count = 0;

        for (let i = 0; i < prev.length; i += 3) {
            if (this.hasLandmark(prev, i) && this.hasLandmark(curr, i)) {
                const dx = prev[i] - curr[i];
                const dy = prev[i+1] - curr[i+1];
                totalDiff += Math.sqrt(dx*dx + dy*dy);
                count++;
            }
        }

        return count > 0 ? totalDiff / count : 0;
    }

    private hasLandmark(values: Float32Array, index: number): boolean {
        return values[index] !== 0 || values[index + 1] !== 0 || values[index + 2] !== 0;
    }

    reset() {
        this.previousHandKeypoints = null;
        this.smoothedHandKeypoints = null;
        this.smoothedMovement = 0;
        this.currentMode = 'waiting';
        this.stillFrameCount = 0;
        this.movingFrameCount = 0;
    }
}
