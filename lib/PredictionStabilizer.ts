export type StabilizerEvent =
    | { type: 'commit'; label: string; confidence: number }
    | { type: 'replace'; oldLabel: string; newLabel: string; confidence: number }
    | { type: 'space' };

export interface StabilizerConfig {
    windowSize: number;
    requiredVotes: number;
    minConfidence: number;
    spaceHoldMs: number;
    replaceWindowMs: number;
    startShapes: Record<string, string[]>;
}

export const DEFAULT_STABILIZER_CONFIG: StabilizerConfig = {
    windowSize: 10,
    requiredVotes: 8,
    minConfidence: 0.70,
    spaceHoldMs: 1000,
    replaceWindowMs: 1000,
    startShapes: {
        J: ['I'],
        Z: []
    }
};

interface StaticVote {
    label: string;
    confidence: number;
    timestamp: number;
}

export class PredictionStabilizer {
    private config: StabilizerConfig;
    private window: StaticVote[] = [];

    private lastCommittedLetter: string | null = null;
    private lastCommittedTime: number = 0;
    private noHandStartTime: number | null = null;
    private spaceEmitted: boolean = false;

    constructor(config?: Partial<StabilizerConfig>) {
        this.config = { ...DEFAULT_STABILIZER_CONFIG, ...config };
    }

    /**
     * Process a static prediction from model.tflite (label, confidence).
     * Returns an event if a letter should be committed, or null.
     */
    public processStaticPrediction(
        label: string,
        confidence: number,
        timestamp: number = Date.now()
    ): StabilizerEvent | null {
        // Hand is visible; reset no-hand timer
        if (this.noHandStartTime !== null) {
            // Hand was removed and returned; allow signing the same letter again
            this.lastCommittedLetter = null;
            this.noHandStartTime = null;
            this.spaceEmitted = false;
        }

        // Add to sliding window
        this.window.push({ label, confidence, timestamp });
        if (this.window.length > this.config.windowSize) {
            this.window.shift();
        }

        // Count votes per letter in window
        const counts: Record<string, { count: number; totalConf: number }> = {};
        for (const vote of this.window) {
            if (!counts[vote.label]) {
                counts[vote.label] = { count: 0, totalConf: 0 };
            }
            counts[vote.label].count += 1;
            counts[vote.label].totalConf += vote.confidence;
        }

        // Check if any letter meets voting criteria
        for (const candidate of Object.keys(counts)) {
            const entry = counts[candidate];
            if (entry.count >= this.config.requiredVotes) {
                const avgConfidence = entry.totalConf / entry.count;
                if (avgConfidence >= this.config.minConfidence) {
                    // Prevent repeating the same letter without hand removal or intervening letter
                    if (candidate !== this.lastCommittedLetter) {
                        this.lastCommittedLetter = candidate;
                        this.lastCommittedTime = timestamp;
                        this.window = []; // Reset window after commit

                        return {
                            type: 'commit',
                            label: candidate,
                            confidence: avgConfidence
                        };
                    }
                }
            }
        }

        return null;
    }

    /**
     * Process a motion prediction from motion.tflite ('J', 'Z').
     * Checks if it should replace a recent start shape (e.g. 'I' -> 'J')
     * or commit as a new letter.
     */
    public processMotionPrediction(
        motionLabel: string,
        confidence: number,
        timestamp: number = Date.now()
    ): StabilizerEvent | null {
        if (confidence < this.config.minConfidence) {
            return null;
        }

        // Check replacement rule (e.g., 'J' replaces 'I')
        const allowedStartShapes = this.config.startShapes[motionLabel] || [];
        const isWithinReplaceWindow = (timestamp - this.lastCommittedTime) <= this.config.replaceWindowMs;

        if (
            this.lastCommittedLetter &&
            allowedStartShapes.includes(this.lastCommittedLetter) &&
            isWithinReplaceWindow
        ) {
            const oldLabel = this.lastCommittedLetter;
            this.lastCommittedLetter = motionLabel;
            this.lastCommittedTime = timestamp;
            this.window = [];

            return {
                type: 'replace',
                oldLabel,
                newLabel: motionLabel,
                confidence
            };
        }

        // Otherwise commit as regular letter if different from last
        if (motionLabel !== this.lastCommittedLetter) {
            this.lastCommittedLetter = motionLabel;
            this.lastCommittedTime = timestamp;
            this.window = [];

            return {
                type: 'commit',
                label: motionLabel,
                confidence
            };
        }

        return null;
    }

    /**
     * Process frame with no hand detected.
     * Emits space if hand is absent for >= spaceHoldMs (1000 ms).
     */
    public processNoHand(timestamp: number = Date.now()): StabilizerEvent | null {
        this.window = []; // Clear voting window when no hand

        if (this.noHandStartTime === null) {
            this.noHandStartTime = timestamp;
            return null;
        }

        const elapsed = timestamp - this.noHandStartTime;
        if (elapsed >= this.config.spaceHoldMs && !this.spaceEmitted) {
            this.spaceEmitted = true;
            this.lastCommittedLetter = ' ';
            this.lastCommittedTime = timestamp;

            return { type: 'space' };
        }

        return null;
    }

    public getLastCommittedLetter(): string | null {
        return this.lastCommittedLetter;
    }

    public reset(): void {
        this.window = [];
        this.lastCommittedLetter = null;
        this.lastCommittedTime = 0;
        this.noHandStartTime = null;
        this.spaceEmitted = false;
    }
}

