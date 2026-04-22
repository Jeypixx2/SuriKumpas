import * as THREE from 'three';

export interface VRMHumanoid {
    humanBones: {
        rightUpperArm?: { node: THREE.Object3D };
        rightLowerArm?: { node: THREE.Object3D };
        rightHand?: { node: THREE.Object3D };
        leftUpperArm?: { node: THREE.Object3D };
        leftLowerArm?: { node: THREE.Object3D };
        leftHand?: { node: THREE.Object3D };
        rightThumbProximal?: { node: THREE.Object3D };
        rightIndexProximal?: { node: THREE.Object3D };
        rightMiddleProximal?: { node: THREE.Object3D };
        leftThumbProximal?: { node: THREE.Object3D };
        leftIndexProximal?: { node: THREE.Object3D };
        leftMiddleProximal?: { node: THREE.Object3D };
        spine?: { node: THREE.Object3D };
        chest?: { node: THREE.Object3D };
    };
}

export interface VRM {
    humanoid: VRMHumanoid;
}

export interface SequenceItem {
    type: 'sign' | 'letter';
    value: string;
}

export class AvatarAnimator {
    private vrm: VRM | null = null;
    private mixer: THREE.AnimationMixer | null = null;
    private clock: THREE.Clock = new THREE.Clock();
    private idleAction: THREE.AnimationAction | null = null;
    private currentSignAction: THREE.AnimationAction | null = null;
    private isPlayingSign: boolean = false;

    private queue: SequenceItem[] = [];
    private isProcessingQueue: boolean = false;

    private signAnimations: Map<string, THREE.AnimationClip> = new Map();
    private letterAnimations: Map<string, THREE.AnimationClip> = new Map();
    private idleClip: THREE.AnimationClip | null = null;
    private onSequenceEnd?: () => void;

    // Tracks whether custom GLB animations have finished loading
    private customAnimationsLoaded: boolean = false;
    // If a sequence is requested before GLBs are ready, store it here and replay it once ready
    private pendingSequence: SequenceItem[] | null = null;
    // Increments on every new playSequence call to invalidate stale setTimeout callbacks
    private sequenceId: number = 0;

    setOnSequenceEnd(callback: () => void): void {
        this.onSequenceEnd = callback;
    }

    setVRM(vrm: any): void {
        this.vrm = vrm;
        const rootObject = vrm.scene; // Use the root scene for the mixer
        if (rootObject) {
            this.mixer = new THREE.AnimationMixer(rootObject);
        } else {
            console.warn('[AvatarAnimator] VRM scene is undefined.');
        }
        this.generateAllAnimations();
        this.startIdleAnimation();
    }

    private generateAllAnimations(): void {
        this.generateIdleAnimation();
        this.generateSignAnimations();
        this.generateLetterAnimations();
    }

    setCustomSignAnimation(signName: string, clip: THREE.AnimationClip): void {
        clip.name = signName;
        // Retarget the clip so arbitrary GLB node names (e.g. l_arm_JNT) map to VRM node names natively
        this.retargetClip(clip);
        this.signAnimations.set(signName, clip);
        console.log(`[AvatarAnimator] Custom animation imported for: ${signName}`);
    }

    /** Called by AvatarViewer after all GLBs have finished background-loading. */
    markCustomAnimationsLoaded(): void {
        this.customAnimationsLoaded = true;
        console.log('[AvatarAnimator] All custom GLBs loaded. Checking for pending sequence...');
        if (this.pendingSequence) {
            const seq = this.pendingSequence;
            this.pendingSequence = null;
            this.playSequence(seq);
        }
    }

    private retargetClip(clip: THREE.AnimationClip): void {
        if (!this.vrm) return;

        // Common mapping from Rokoko/Mixamo/Custom JNT to standard VRM humanBone names
        const boneMap: Record<string, string> = {
            // --- _JNT convention (existing GLBs) ---
            'hips_JNT': 'hips',
            'spine_JNT': 'spine',
            'spine1_JNT': 'chest',
            'spine2_JNT': 'upperChest',
            'neck_JNT': 'neck',
            'head_JNT': 'head',
            'l_shoulder_JNT': 'leftShoulder',
            'l_arm_JNT': 'leftUpperArm',
            'l_forearm_JNT': 'leftLowerArm',
            'l_hand_JNT': 'leftHand',
            'l_handThumb1_JNT': 'leftThumbProximal',
            'l_handThumb2_JNT': 'leftThumbDistal',
            'l_handThumb3_JNT': '', // Ignore tip joint
            'l_handIndex1_JNT': 'leftIndexProximal',
            'l_handIndex2_JNT': 'leftIndexIntermediate',
            'l_handIndex3_JNT': 'leftIndexDistal',
            'l_handMiddle1_JNT': 'leftMiddleProximal',
            'l_handMiddle2_JNT': 'leftMiddleIntermediate',
            'l_handMiddle3_JNT': 'leftMiddleDistal',
            'l_handRing1_JNT': 'leftRingProximal',
            'l_handRing2_JNT': 'leftRingIntermediate',
            'l_handRing3_JNT': 'leftRingDistal',
            'l_handPinky1_JNT': 'leftLittleProximal',
            'l_handPinky2_JNT': 'leftLittleIntermediate',
            'l_handPinky3_JNT': 'leftLittleDistal',
            'r_shoulder_JNT': 'rightShoulder',
            'r_arm_JNT': 'rightUpperArm',
            'r_forearm_JNT': 'rightLowerArm',
            'r_hand_JNT': 'rightHand',
            'r_handThumb1_JNT': 'rightThumbProximal',
            'r_handThumb2_JNT': 'rightThumbDistal',
            'r_handThumb3_JNT': '', // Ignore tip joint
            'r_handIndex1_JNT': 'rightIndexProximal',
            'r_handIndex2_JNT': 'rightIndexIntermediate',
            'r_handIndex3_JNT': 'rightIndexDistal',
            'r_handMiddle1_JNT': 'rightMiddleProximal',
            'r_handMiddle2_JNT': 'rightMiddleIntermediate',
            'r_handMiddle3_JNT': 'rightMiddleDistal',
            'r_handRing1_JNT': 'rightRingProximal',
            'r_handRing2_JNT': 'rightRingIntermediate',
            'r_handRing3_JNT': 'rightRingDistal',
            'r_handPinky1_JNT': 'rightLittleProximal',
            'r_handPinky2_JNT': 'rightLittleIntermediate',
            'r_handPinky3_JNT': 'rightLittleDistal',
            'l_upleg_JNT': 'leftUpperLeg',
            'l_leg_JNT': 'leftLowerLeg',
            'l_foot_JNT': 'leftFoot',
            'l_toebase_JNT': 'leftToes',
            'r_upleg_JNT': 'rightUpperLeg',
            'r_leg_JNT': 'rightLowerLeg',
            'r_foot_JNT': 'rightFoot',
            'r_toebase_JNT': 'rightToes',

            // --- hello.glb / friendly-name convention ---
            'Hip': 'hips',
            'Spine': 'spine',
            'Chest': 'chest',
            'UpperChest': 'upperChest',
            'Neck': 'neck',
            'Head': 'head',
            'LeftCollar': 'leftShoulder',
            'LeftUpArm': 'leftUpperArm',
            'LeftLowArm': 'leftLowerArm',
            'LeftHand': 'leftHand',
            'LeftThumb1': 'leftThumbProximal',
            'LeftThumb2': 'leftThumbIntermediate',
            'LeftThumb3': 'leftThumbDistal',
            'LeftIndex1': 'leftIndexProximal',
            'LeftIndex2': 'leftIndexIntermediate',
            'LeftIndex3': 'leftIndexDistal',
            'LeftMiddle1': 'leftMiddleProximal',
            'LeftMiddle2': 'leftMiddleIntermediate',
            'LeftMiddle3': 'leftMiddleDistal',
            'LeftRing1': 'leftRingProximal',
            'LeftRing2': 'leftRingIntermediate',
            'LeftRing3': 'leftRingDistal',
            'LeftPinky1': 'leftLittleProximal',
            'LeftPinky2': 'leftLittleIntermediate',
            'LeftPinky3': 'leftLittleDistal',
            'RightCollar': 'rightShoulder',
            'RightUpArm': 'rightUpperArm',
            'RightLowArm': 'rightLowerArm',
            'RightHand': 'rightHand',
            'RightThumb1': 'rightThumbProximal',
            'RightThumb2': 'rightThumbIntermediate',
            'RightThumb3': 'rightThumbDistal',
            'RightIndex1': 'rightIndexProximal',
            'RightIndex2': 'rightIndexIntermediate',
            'RightIndex3': 'rightIndexDistal',
            'RightMiddle1': 'rightMiddleProximal',
            'RightMiddle2': 'rightMiddleIntermediate',
            'RightMiddle3': 'rightMiddleDistal',
            'RightRing1': 'rightRingProximal',
            'RightRing2': 'rightRingIntermediate',
            'RightRing3': 'rightRingDistal',
            'RightPinky1': 'rightLittleProximal',
            'RightPinky2': 'rightLittleIntermediate',
            'RightPinky3': 'rightLittleDistal',
            'LeftUpLeg': 'leftUpperLeg',
            'LeftLowLeg': 'leftLowerLeg',
            'LeftFoot': 'leftFoot',
            'LeftToe': 'leftToes',
            'RightUpLeg': 'rightUpperLeg',
            'RightLowLeg': 'rightLowerLeg',
            'RightFoot': 'rightFoot',
            'RightToe': 'rightToes',
        };

        const tracksToKeep: THREE.KeyframeTrack[] = [];

        clip.tracks.forEach(track => {
            const trackParts = track.name.split('.');
            const nodeName = trackParts[0];
            const propertyName = trackParts[1];

            // 1. Is this node known in our map?
            let vrmBoneName = boneMap[nodeName];

            if (vrmBoneName) {
                const humanoid = (this.vrm as any).humanoid;
                const humanBone = humanoid.getBoneNode?.(vrmBoneName) || humanoid.getRawBoneNode?.(vrmBoneName) || humanoid.humanBones?.[vrmBoneName]?.node;
                
                if (humanBone) {
                    // Update track name to the actual unique Three.js node name of the VRM bone
                    track.name = `${humanBone.name}.${propertyName}`;
                    tracksToKeep.push(track);
                }
            } else {
                // Fallback: If it's already a valid name or unknown, keep it for safety
                tracksToKeep.push(track);
            }
        });

        clip.tracks = tracksToKeep;
    }

    private generateIdleAnimation(): void {
        if (!this.vrm) return;

        const humanoid = (this.vrm as any).humanoid;
        const spine = humanoid.getBoneNode?.('spine') || humanoid.humanBones?.spine?.node;
        const chest = humanoid.getBoneNode?.('chest') || humanoid.humanBones?.chest?.node;

        const times = [0, 1.5, 3];
        const spineValues: number[] = [];
        const chestValues: number[] = [];

        for (let i = 0; i < times.length; i++) {
            const breathPhase = Math.sin((times[i] / 3) * Math.PI * 2) * 0.02;
            spineValues.push(0, breathPhase, 0, 1);
            chestValues.push(0, breathPhase * 0.5, 0, 1);
        }

        const tracks: THREE.KeyframeTrack[] = [];
        if (spine) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                spine.name + '.quaternion',
                times,
                spineValues
            ));
        }
        if (chest) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                chest.name + '.quaternion',
                times,
                chestValues
            ));
        }

        this.idleClip = new THREE.AnimationClip('idle', 3, tracks);
    }

    private generateSignAnimations(): void {
        const signNames = [
            'GOOD MORNING', 'GOOD AFTERNOON', 'GOOD EVENING', 'HELLO', 'HOW ARE YOU',
            'IM FINE', 'NICE TO MEET YOU', 'THANK YOU', 'YOURE WELCOME', 'SEE YOU TOMORROW',
            'UNDERSTAND', 'DON\'T UNDERSTAND', 'KNOW', 'DON\'T KNOW', 'NO', 'YES',
            'WRONG', 'CORRECT', 'SLOW', 'FAST',
            'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
            'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
            'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
            'TODAY', 'TOMORROW', 'YESTERDAY',
            'FATHER', 'MOTHER', 'SON', 'DAUGHTER', 'GRANDFATHER', 'GRANDMOTHER', 'UNCLE', 'AUNTIE', 'COUSIN', 'PARENTS',
            'BOY', 'GIRL', 'MAN', 'WOMAN', 'DEAF', 'HARD OF HEARING', 'WHEELCHAIR PERSON', 'BLIND', 'DEAF BLIND', 'MARRIED',
            'BLUE', 'GREEN', 'RED', 'BROWN', 'BLACK', 'WHITE', 'YELLOW', 'ORANGE', 'GRAY', 'PINK', 'VIOLET', 'LIGHT', 'DARK',
            'BREAD', 'EGG', 'FISH', 'MEAT', 'CHICKEN', 'SPAGHETTI', 'RICE', 'LONGANISA', 'SHRIMP', 'CRAB',
            'HOT', 'COLD', 'JUICE', 'MILK', 'COFFEE', 'TEA', 'BEER', 'WINE', 'SUGAR', 'NO SUGAR'
        ];

        signNames.forEach((signName, index) => {
            const clip = this.createUniqueSignAnimation(signName, index);
            this.signAnimations.set(signName, clip);
        });
    }

    private generateLetterAnimations(): void {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        for (let i = 0; i < letters.length; i++) {
            const letter = letters[i];
            const clip = this.createUniqueLetterAnimation(letter, i);
            this.letterAnimations.set(letter, clip);
        }
    }

    private createUniqueSignAnimation(signName: string, index: number): THREE.AnimationClip {
        if (!this.vrm) return new THREE.AnimationClip(signName, 1, []);

        const seed = index * 137.5;
        const tracks: THREE.KeyframeTrack[] = [];

        const bones = this.getAnimationBones();
        if (!bones) return new THREE.AnimationClip(signName, 1, []);

        const { rightUpperArm, rightLowerArm, rightHand, leftUpperArm, leftLowerArm, leftHand,
                rightThumb, rightIndex, rightMiddle, leftThumb, leftIndex, leftMiddle } = bones;

        const duration = 1.5;
        const times = [0, duration * 0.3, duration * 0.6, duration];

        const ruaValues = this.generateArmKeyframes(seed, 0, times.length);
        const rlaValues = this.generateArmKeyframes(seed + 10, 1, times.length);
        const rhValues = this.generateHandKeyframes(seed + 20, times.length);
        const luaValues = this.generateArmKeyframes(seed + 30, 2, times.length);
        const llaValues = this.generateArmKeyframes(seed + 40, 3, times.length);
        const lhValues = this.generateHandKeyframes(seed + 50, times.length);

        const fingerTimes = [0, duration * 0.2, duration * 0.5, duration * 0.8, duration];
        const rtValues = this.generateFingerKeyframes(seed + 60, fingerTimes.length);
        const riValues = this.generateFingerKeyframes(seed + 70, fingerTimes.length);
        const rmValues = this.generateFingerKeyframes(seed + 80, fingerTimes.length);
        const ltValues = this.generateFingerKeyframes(seed + 90, fingerTimes.length);
        const liValues = this.generateFingerKeyframes(seed + 100, fingerTimes.length);
        const lmValues = this.generateFingerKeyframes(seed + 110, fingerTimes.length);

        if (rightUpperArm) tracks.push(new THREE.QuaternionKeyframeTrack(rightUpperArm.name + '.quaternion', times, ruaValues));
        if (rightLowerArm) tracks.push(new THREE.QuaternionKeyframeTrack(rightLowerArm.name + '.quaternion', times, rlaValues));
        if (rightHand) tracks.push(new THREE.QuaternionKeyframeTrack(rightHand.name + '.quaternion', times, rhValues));
        if (leftUpperArm) tracks.push(new THREE.QuaternionKeyframeTrack(leftUpperArm.name + '.quaternion', times, luaValues));
        if (leftLowerArm) tracks.push(new THREE.QuaternionKeyframeTrack(leftLowerArm.name + '.quaternion', times, llaValues));
        if (leftHand) tracks.push(new THREE.QuaternionKeyframeTrack(leftHand.name + '.quaternion', times, lhValues));

        // Animate all joints in the finger arrays for full motion
        const animateFinger = (boneArray: (THREE.Object3D | null)[], values: number[], trackTimes: number[]) => {
            boneArray.forEach(bone => {
                if (bone) {
                    tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', trackTimes, values));
                }
            });
        };

        animateFinger(rightThumb, rtValues, fingerTimes);
        animateFinger(rightIndex, riValues, fingerTimes);
        animateFinger(rightMiddle, rmValues, fingerTimes);
        animateFinger(leftThumb, ltValues, fingerTimes);
        animateFinger(leftIndex, liValues, fingerTimes);
        animateFinger(leftMiddle, lmValues, fingerTimes);

        return new THREE.AnimationClip(signName, duration, tracks);
    }

    private createUniqueLetterAnimation(letter: string, index: number): THREE.AnimationClip {
        if (!this.vrm) return new THREE.AnimationClip(letter, 1, []);

        const seed = index * 89.7 + 1000;
        const tracks: THREE.KeyframeTrack[] = [];

        const bones = this.getAnimationBones();
        if (!bones) return new THREE.AnimationClip(letter, 1, []);

        const duration = 1.0;
        const times = [0, duration * 0.5, duration];

        // 🚀 STABLE POSITION: Instead of random movement, we move to a clear, forward-facing fingerspelling pose
        const isRightHanded = index % 2 === 0;

        if (isRightHanded) {
            const { rightUpperArm, rightLowerArm, rightHand, 
                    rightThumb, rightIndex, rightMiddle, rightRing, rightLittle } = bones as any;
            
            if (rightUpperArm) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.2, 0.2));
                tracks.push(new THREE.QuaternionKeyframeTrack(rightUpperArm.name + '.quaternion', [0, duration], [0,0,0,1, q.x, q.y, q.z, q.w]));
            }
            if (rightLowerArm) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.8, 0, 0));
                tracks.push(new THREE.QuaternionKeyframeTrack(rightLowerArm.name + '.quaternion', [0, duration], [0,0,0,1, q.x, q.y, q.z, q.w]));
            }
            if (rightHand) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.5));
                tracks.push(new THREE.QuaternionKeyframeTrack(rightHand.name + '.quaternion', [0, duration], [0,0,0,1, q.x, q.y, q.z, q.w]));
            }
            
            // Curl all fingers slightly for a natural "ready" pose
            [rightThumb, rightIndex, rightMiddle, rightRing, rightLittle].forEach(fingerArray => {
                fingerArray?.forEach((bone: any) => {
                    if (bone) {
                        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0));
                        tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', [0, duration], [0,0,0,1, q.x, q.y, q.z, q.w]));
                    }
                });
            });
        } else {
            const { leftUpperArm, leftLowerArm, leftHand,
                    leftThumb, leftIndex, leftMiddle, leftRing, leftLittle } = bones as any;
            
            if (leftUpperArm) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, -0.2, -0.2));
                tracks.push(new THREE.QuaternionKeyframeTrack(leftUpperArm.name + '.quaternion', [0, duration], [0,0,0,1, q.x, q.y, q.z, q.w]));
            }
            if (leftLowerArm) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.8, 0, 0));
                tracks.push(new THREE.QuaternionKeyframeTrack(leftLowerArm.name + '.quaternion', [0, duration], [0,0,0,1, q.x, q.y, q.z, q.w]));
            }
            if (leftHand) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.5));
                tracks.push(new THREE.QuaternionKeyframeTrack(leftHand.name + '.quaternion', [0, duration], [0,0,0,1, q.x, q.y, q.z, q.w]));
            }

            [leftThumb, leftIndex, leftMiddle, leftRing, leftLittle].forEach(fingerArray => {
                fingerArray?.forEach((bone: any) => {
                    if (bone) {
                        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0));
                        tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', [0, duration], [0,0,0,1, q.x, q.y, q.z, q.w]));
                    }
                });
            });
        }

        return new THREE.AnimationClip(letter, duration, tracks);
    }

    private getAnimationBones() {
        if (!this.vrm) return null;

        const h = (this.vrm as any).humanoid;
        const get = (name: string) => h.getBoneNode?.(name) || h.humanBones?.[name]?.node;

        return {
            rightUpperArm: get('rightUpperArm'),
            rightLowerArm: get('rightLowerArm'),
            rightHand: get('rightHand'),
            leftUpperArm: get('leftUpperArm'),
            leftLowerArm: get('leftLowerArm'),
            leftHand: get('leftHand'),
            
            // All finger joints for better quality
            rightThumb: [get('rightThumbProximal'), get('rightThumbIntermediate'), get('rightThumbDistal')],
            rightIndex: [get('rightIndexProximal'), get('rightIndexIntermediate'), get('rightIndexDistal')],
            rightMiddle: [get('rightMiddleProximal'), get('rightMiddleIntermediate'), get('rightMiddleDistal')],
            rightRing: [get('rightRingProximal'), get('rightRingIntermediate'), get('rightRingDistal')],
            rightLittle: [get('rightLittleProximal'), get('rightLittleIntermediate'), get('rightLittleDistal')],
            
            leftThumb: [get('leftThumbProximal'), get('leftThumbIntermediate'), get('leftThumbDistal')],
            leftIndex: [get('leftIndexProximal'), get('leftIndexIntermediate'), get('leftIndexDistal')],
            leftMiddle: [get('leftMiddleProximal'), get('leftMiddleIntermediate'), get('leftMiddleDistal')],
            leftRing: [get('leftRingProximal'), get('leftRingIntermediate'), get('leftRingDistal')],
            leftLittle: [get('leftLittleProximal'), get('leftLittleIntermediate'), get('leftLittleDistal')]
        };
    }

    private resetFingers(): void {
        if (!this.vrm) return;
        const bones = this.getAnimationBones();
        if (!bones) return;

        const allFingers = [
            bones.rightThumb, bones.rightIndex, bones.rightMiddle, bones.rightRing, bones.rightLittle,
            bones.leftThumb, bones.leftIndex, bones.leftMiddle, bones.leftRing, bones.leftLittle
        ];

        allFingers.forEach(fingerArray => {
            fingerArray?.forEach((bone: any) => {
                if (bone) {
                    bone.quaternion.set(0, 0, 0, 1);
                }
            });
        });
    }

    private generateArmKeyframes(seed: number, variation: number, count: number): number[] {
        const values: number[] = [];
        const pseudoRandom = (n: number) => {
            const x = Math.sin(seed + n * 12.9898) * 43758.5453;
            return x - Math.floor(x);
        };

        for (let i = 0; i < count; i++) {
            const x = (pseudoRandom(i) - 0.5) * 1.5;
            const y = (pseudoRandom(i + 100) - 0.5) * 1.2 + (variation % 2 === 0 ? 0.3 : -0.2);
            const z = (pseudoRandom(i + 200) - 0.5) * 1.0;
            const w = 1.0;

            const q = new THREE.Quaternion();
            const euler = new THREE.Euler(x, y, z);
            q.setFromEuler(euler);
            values.push(q.x, q.y, q.z, q.w);
        }
        return values;
    }

    private generateHandKeyframes(seed: number, count: number): number[] {
        const values: number[] = [];
        const pseudoRandom = (n: number) => {
            const x = Math.sin(seed + n * 12.9898) * 43758.5453;
            return x - Math.floor(x);
        };

        for (let i = 0; i < count; i++) {
            const x = (pseudoRandom(i) - 0.5) * 0.8;
            const y = (pseudoRandom(i + 100) - 0.5) * 0.8;
            const z = (pseudoRandom(i + 200) - 0.5) * 1.5;
            const w = 1.0;

            const q = new THREE.Quaternion();
            const euler = new THREE.Euler(x, y, z);
            q.setFromEuler(euler);
            values.push(q.x, q.y, q.z, q.w);
        }
        return values;
    }

    private generateFingerKeyframes(seed: number, count: number, precise: boolean = false): number[] {
        const values: number[] = [];
        const pseudoRandom = (n: number) => {
            const x = Math.sin(seed + n * 12.9898) * 43758.5453;
            return x - Math.floor(x);
        };

        const range = precise ? 0.5 : 1.0;

        for (let i = 0; i < count; i++) {
            const x = (pseudoRandom(i) - 0.5) * range;
            const y = (pseudoRandom(i + 100) - 0.5) * range;
            const z = (pseudoRandom(i + 200) - 0.5) * range;
            const w = 1.0;

            const q = new THREE.Quaternion();
            const euler = new THREE.Euler(x, y, z);
            q.setFromEuler(euler);
            values.push(q.x, q.y, q.z, q.w);
        }
        return values;
    }

    startIdleAnimation(): void {
        if (!this.mixer || !this.idleClip) return;

        this.idleAction = this.mixer.clipAction(this.idleClip);
        this.idleAction.setLoop(THREE.LoopRepeat, Infinity);
        this.idleAction.play();
    }

    /**
     * Entry point for playing a full sequence of animations.
     * Restarts the queue if not already processing.
     */
    /**
     * Entry point for playing a full sequence of animations.
     * Simple recursive process to avoid async lag.
     */
    playSequence(sequence: SequenceItem[]): void {
        // If custom GLBs haven't loaded yet, park the request and replay it when they arrive
        if (!this.customAnimationsLoaded) {
            console.log('[AvatarAnimator] GLBs not ready yet — queuing sequence for later.');
            this.pendingSequence = [...sequence];
            return;
        }

        // Bump the ID to invalidate any stale setTimeout callbacks from previous animations
        this.sequenceId++;
        const myId = this.sequenceId;

        // Replace the queue and start processing.
        // 🚀 SMOOTH INTERRUPT: We no longer call currentSignAction.stop().
        // Instead, we let processNextInQueue handle the smooth crossfade from the previous state.
        this.queue = [...sequence];
        this.isProcessingQueue = false;
        
        this.processNextInQueue(myId);
    }

    private processNextInQueue(id: number = this.sequenceId): void {
        // If a newer sequence has started, this callback is stale — bail out
        if (id !== this.sequenceId) {
            console.log('[AvatarAnimator] Stale timer callback ignored.');
            return;
        }

        if (!this.mixer || this.queue.length === 0) {
            console.log(`[AvatarAnimator] Sequence #${id} finished.`);
            this.isProcessingQueue = false;
            this.isPlayingSign = false;
            this.currentSignAction = null;

            // Restart idle cleanly with a fade in
            if (this.idleAction) {
                this.idleAction.reset();
                this.idleAction.setEffectiveWeight(1.0);
                this.idleAction.fadeIn(0.3);
                this.idleAction.play();
            } else {
                this.startIdleAnimation();
            }

            // Notify UI that the sequence is done so state can be cleared
            if (this.onSequenceEnd) {
                this.onSequenceEnd();
            }
            return;
        }

        this.isProcessingQueue = true;
        const nextItem = this.queue.shift();
        if (!nextItem) return;

        const clip = nextItem.type === 'sign'
            ? this.signAnimations.get(nextItem.value)
            : this.letterAnimations.get(nextItem.value.toUpperCase());

        if (!clip) {
            console.warn(`[AvatarAnimator] No clip found for "${nextItem.value}". Known signs:`, [...this.signAnimations.keys()]);
            this.processNextInQueue(id);
            return;
        }

        console.log(`[AvatarAnimator] Playing "${nextItem.value}", duration=${clip.duration.toFixed(2)}s, tracks=${clip.tracks.length}`);

        const nextAction = this.mixer.clipAction(clip);
        nextAction.setLoop(THREE.LoopOnce, 1);
        nextAction.clampWhenFinished = true;
        
        // 🚀 BONE RESET: If we are transitioning from a fingerspelling letter (curled fingers) 
        // to a sign that might not have finger tracks, we MUST ensure the bones reset.
        this.resetFingers(); 

        if (this.currentSignAction) {
            nextAction.reset().play();
            nextAction.crossFadeFrom(this.currentSignAction, 0.15, true);
        } else {
            // If starting fresh, fade out idle and any other lingering actions
            this.mixer.stopAllAction(); // Heavy reset to clear any "stuck" finger weights
            if (this.idleAction) {
                this.idleAction.reset().play();
                nextAction.reset().play();
                nextAction.crossFadeFrom(this.idleAction, 0.15, true);
            } else {
                nextAction.reset().play();
            }
        }

        this.currentSignAction = nextAction;
        this.isPlayingSign = true;

        const delay = (clip.duration * 1000) + 150;
        setTimeout(() => {
            this.processNextInQueue(id);
        }, delay);
    }

    playSignAnimation(signName: string): void {
        this.playSequence([{ type: 'sign', value: signName }]);
    }

    playLetterAnimation(letter: string): void {
        this.playSequence([{ type: 'letter', value: letter }]);
    }

    stopSignAnimation(): void {
        console.log('[AvatarAnimator] Resetting whole queue');
        this.queue = [];
        this.isProcessingQueue = false;
        if (this.currentSignAction) {
            this.currentSignAction.stop();
            this.currentSignAction = null;
        }
        this.isPlayingSign = false;

        if (this.idleAction) {
            this.idleAction.reset();
            this.idleAction.play();
        }
    }

    update(): void {
        if (this.mixer) {
            const delta = this.clock.getDelta();
            this.mixer.update(delta);
        }
    }

    dispose(): void {
        if (this.mixer) {
            this.mixer.stopAllAction();
            this.mixer = null;
        }
        this.idleAction = null;
        this.currentSignAction = null;
        this.signAnimations.clear();
        this.letterAnimations.clear();
        this.idleClip = null;
        this.vrm = null;
        this.isPlayingSign = false;
    }
}
