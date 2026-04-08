interface HolisticResults {
    poseLandmarks?: { x: number; y: number; z: number; visibility?: number }[];
    faceLandmarks?: { x: number; y: number; z: number }[];
    leftHandLandmarks?: { x: number; y: number; z: number }[];
    rightHandLandmarks?: { x: number; y: number; z: number }[];
}

export function extractKeypoints(results: HolisticResults): Float32Array {
    const keypoints: number[] = [];

    const poseLandmarks = results.poseLandmarks || [];
    for (let i = 0; i < 33; i++) {
        if (i < poseLandmarks.length) {
            const lm = poseLandmarks[i];
            keypoints.push(lm.x, lm.y, lm.z, lm.visibility ?? 1.0);
        } else {
            keypoints.push(0, 0, 0, 0);
        }
    }

    const faceLandmarks = results.faceLandmarks || [];
    for (let i = 0; i < 468; i++) {
        if (i < faceLandmarks.length) {
            const lm = faceLandmarks[i];
            keypoints.push(lm.x, lm.y, lm.z);
        } else {
            keypoints.push(0, 0, 0);
        }
    }

    const leftHandLandmarks = results.leftHandLandmarks || [];
    for (let i = 0; i < 21; i++) {
        if (i < leftHandLandmarks.length) {
            const lm = leftHandLandmarks[i];
            keypoints.push(lm.x, lm.y, lm.z);
        } else {
            keypoints.push(0, 0, 0);
        }
    }

    const rightHandLandmarks = results.rightHandLandmarks || [];
    for (let i = 0; i < 21; i++) {
        if (i < rightHandLandmarks.length) {
            const lm = rightHandLandmarks[i];
            keypoints.push(lm.x, lm.y, lm.z);
        } else {
            keypoints.push(0, 0, 0);
        }
    }

    return new Float32Array(keypoints);
}

export function areHandsPresent(results: HolisticResults): { left: boolean; right: boolean } {
    return {
        left: !!results.leftHandLandmarks && results.leftHandLandmarks.length > 0,
        right: !!results.rightHandLandmarks && results.rightHandLandmarks.length > 0
    };
}
