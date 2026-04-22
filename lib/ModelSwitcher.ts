const HAND_START_INDEX = 468 * 3 + 33 * 4;
const HAND_END_INDEX = HAND_START_INDEX + 21 * 3 + 21 * 3;

export class ModelSwitcher {
    private previousHandKeypoints: number[] | null = null;
    private movementThreshold: number = 0.02;
    private stillFrameCount: number = 0;
    private movingFrameCount: number = 0;
    private readonly stillThreshold = 10;
    private readonly movingThreshold = 2;

    detectMovement(keypoints: Float32Array): { isMoving: boolean; confidence: number } {
        const currentHandKeypoints = this.extractHandKeypoints(keypoints);

        if (!this.previousHandKeypoints) {
            this.previousHandKeypoints = Array.from(currentHandKeypoints);
            return { isMoving: false, confidence: 0 };
        }

        const movement = this.calculateMovement(currentHandKeypoints, this.previousHandKeypoints);
        this.previousHandKeypoints = Array.from(currentHandKeypoints);

        const isMoving = movement > this.movementThreshold;

        if (isMoving) {
            this.movingFrameCount++;
            this.stillFrameCount = 0;
        } else {
            this.stillFrameCount++;
            this.movingFrameCount = 0;
        }

        const movingConfidence = Math.min(this.movingFrameCount / this.movingThreshold, 1.0);
        const stillConfidence = Math.min(this.stillFrameCount / this.stillThreshold, 1.0);

        return {
            isMoving: movingConfidence >= 1.0,
            confidence: isMoving ? movingConfidence : stillConfidence
        };
    }

    private extractHandKeypoints(keypoints: Float32Array): Float32Array {
        return keypoints.slice(HAND_START_INDEX, HAND_END_INDEX);
    }

    private calculateMovement(current: Float32Array, previous: number[]): number {
        let totalMovement = 0;
        const length = Math.min(current.length, previous.length);

        for (let i = 0; i < length; i++) {
            totalMovement += Math.abs(current[i] - previous[i]);
        }

        return totalMovement / length;
    }

    reset(): void {
        this.previousHandKeypoints = null;
        this.stillFrameCount = 0;
        this.movingFrameCount = 0;
    }
}
