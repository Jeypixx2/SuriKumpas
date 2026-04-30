// Aligned with Pose-Face-LH-RH order:
// Pose: 0..131, Face: 132..1535, LH: 1536..1598, RH: 1599..1661
const LH_START = 1536;
const LH_END   = 1599;
const RH_START = 1599;
const RH_END   = 1662;

export class ModelSwitcher {
    private previousHandKeypoints: number[] | null = null;
    private movementThreshold: number = 0.003; // More sensitive
    private stillFrameCount: number = 0;
    private movingFrameCount: number = 0;
    private readonly stillThreshold = 3; // Faster transition
    private readonly movingThreshold = 2; // Faster transition

    detectMovement(currentKeypoints: Float32Array): { isMoving: boolean; confidence: number } {
        // Extract hand keypoints from both hands
        const currentHands: number[] = [];
        for (let i = LH_START; i < LH_END; i++) currentHands.push(currentKeypoints[i]);
        for (let i = RH_START; i < RH_END; i++) currentHands.push(currentKeypoints[i]);

        if (!this.previousHandKeypoints) {
            this.previousHandKeypoints = currentHands;
            return { isMoving: false, confidence: 0 };
        }

        const movement = this.calculateMovement(this.previousHandKeypoints, currentHands);
        this.previousHandKeypoints = currentHands;

        if (movement > this.movementThreshold) {
            this.movingFrameCount++;
            this.stillFrameCount = 0;
        } else {
            this.stillFrameCount++;
            this.movingFrameCount = 0;
        }

        const isMoving = this.movingFrameCount >= this.movingThreshold;
        const isStill = this.stillFrameCount >= this.stillThreshold;

        // Confidence: 1.0 = Still, 0.0 = Moving
        let confidence = 0.5;
        if (isStill) confidence = 1.0;
        if (isMoving) confidence = 0.0;

        return { isMoving, confidence };
    }

    private calculateMovement(prev: number[], curr: number[]): number {
        let totalDiff = 0;
        let count = 0;

        for (let i = 0; i < prev.length; i += 3) {
            // Only compare if the landmark is detected (not 0,0,0)
            if (prev[i] !== 0 && curr[i] !== 0) {
                const dx = prev[i] - curr[i];
                const dy = prev[i+1] - curr[i+1];
                totalDiff += Math.sqrt(dx*dx + dy*dy);
                count++;
            }
        }

        return count > 0 ? totalDiff / count : 0;
    }

    reset() {
        this.previousHandKeypoints = null;
        this.stillFrameCount = 0;
        this.movingFrameCount = 0;
    }
}
