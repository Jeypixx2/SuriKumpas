import * as THREE from 'three';

const ANIMATOR_DEBUG = false;
const debugLog = (...args: unknown[]) => {
    if (ANIMATOR_DEBUG) console.log(...args);
};

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
        upperChest?: { node: THREE.Object3D };
    };
}

export interface VRM {
    humanoid: VRMHumanoid;
}

export interface SequenceItem {
    type: 'sign' | 'letter';
    value: string;
    display?: string;
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
    private restQuaternions: Map<string, THREE.Quaternion> = new Map();

    // Increments on every new playSequence call to invalidate stale setTimeout callbacks
    private sequenceId: number = 0;

    setOnSequenceEnd(callback: () => void): void {
        this.onSequenceEnd = callback;
    }

    private getBoneNode(name: string): THREE.Object3D | null {
        if (!this.vrm) return null;
        const humanoid = (this.vrm as any).humanoid;
        if (humanoid) {
            const bone = humanoid.getNormalizedBoneNode?.(name) ||
                         humanoid.getRawBoneNode?.(name) ||
                         humanoid.getBoneNode?.(name) ||
                         humanoid.humanBones?.[name]?.node ||
                         humanoid.humanBones?.[name];

            if (bone) {
                if (bone instanceof THREE.Object3D) return bone;
                if (typeof bone === 'object' && bone.node instanceof THREE.Object3D) return bone.node;
            }
        }

        // Fallback for standard GLTF/GLB models (or if humanoid is not defined)
        const sceneRoot = (this.vrm as any).scene || this.vrm;
        if (!sceneRoot || !(sceneRoot instanceof THREE.Object3D)) return null;

        const standardToJBipMap: Record<string, string> = {
            'hips': 'J_Bip_C_Hips',
            'spine': 'J_Bip_C_Spine',
            'chest': 'J_Bip_C_Chest',
            'upperChest': 'J_Bip_C_UpperChest',
            'neck': 'J_Bip_C_Neck',
            'head': 'J_Bip_C_Head',
            'leftShoulder': 'J_Bip_L_Shoulder',
            'leftUpperArm': 'J_Bip_L_UpperArm',
            'leftLowerArm': 'J_Bip_L_LowerArm',
            'leftHand': 'J_Bip_L_Hand',
            'leftThumbProximal': 'J_Bip_L_Thumb1',
            'leftThumbIntermediate': 'J_Bip_L_Thumb2',
            'leftThumbDistal': 'J_Bip_L_Thumb3',
            'leftIndexProximal': 'J_Bip_L_Index1',
            'leftIndexIntermediate': 'J_Bip_L_Index2',
            'leftIndexDistal': 'J_Bip_L_Index3',
            'leftMiddleProximal': 'J_Bip_L_Middle1',
            'leftMiddleIntermediate': 'J_Bip_L_Middle2',
            'leftMiddleDistal': 'J_Bip_L_Middle3',
            'leftRingProximal': 'J_Bip_L_Ring1',
            'leftRingIntermediate': 'J_Bip_L_Ring2',
            'leftRingDistal': 'J_Bip_L_Ring3',
            'leftLittleProximal': 'J_Bip_L_Little1',
            'leftLittleIntermediate': 'J_Bip_L_Little2',
            'leftLittleDistal': 'J_Bip_L_Little3',
            'rightShoulder': 'J_Bip_R_Shoulder',
            'rightUpperArm': 'J_Bip_R_UpperArm',
            'rightLowerArm': 'J_Bip_R_LowerArm',
            'rightHand': 'J_Bip_R_Hand',
            'rightThumbProximal': 'J_Bip_R_Thumb1',
            'rightThumbIntermediate': 'J_Bip_R_Thumb2',
            'rightThumbDistal': 'J_Bip_R_Thumb3',
            'rightIndexProximal': 'J_Bip_R_Index1',
            'rightIndexIntermediate': 'J_Bip_R_Index2',
            'rightIndexDistal': 'J_Bip_R_Index3',
            'rightMiddleProximal': 'J_Bip_R_Middle1',
            'rightMiddleIntermediate': 'J_Bip_R_Middle2',
            'rightMiddleDistal': 'J_Bip_R_Middle3',
            'rightRingProximal': 'J_Bip_R_Ring1',
            'rightRingIntermediate': 'J_Bip_R_Ring2',
            'rightRingDistal': 'J_Bip_R_Ring3',
            'rightLittleProximal': 'J_Bip_R_Little1',
            'rightLittleIntermediate': 'J_Bip_R_Little2',
            'rightLittleDistal': 'J_Bip_R_Little3',
            'leftUpperLeg': 'J_Bip_L_UpperLeg',
            'leftLowerLeg': 'J_Bip_L_LowerLeg',
            'leftFoot': 'J_Bip_L_Foot',
            'leftToes': 'J_Bip_L_ToeBase',
            'rightUpperLeg': 'J_Bip_R_UpperLeg',
            'rightLowerLeg': 'J_Bip_R_LowerLeg',
            'rightFoot': 'J_Bip_R_Foot',
            'rightToes': 'J_Bip_R_ToeBase',
        };

        const targetNodeName = standardToJBipMap[name] || name;
        let foundBone: THREE.Object3D | null = null;
        sceneRoot.traverse((child: THREE.Object3D) => {
            if (child.name === targetNodeName) {
                foundBone = child;
            }
        });
        return foundBone;
    }

    private captureRestPose(): void {
        this.restQuaternions.clear();

        const addBone = (bone: THREE.Object3D | null | undefined) => {
            if (bone && !this.restQuaternions.has(bone.name)) {
                this.restQuaternions.set(bone.name, bone.quaternion.clone());
            }
        };

        addBone(this.getBoneNode('spine'));
        addBone(this.getBoneNode('chest'));
        addBone(this.getBoneNode('upperChest'));

        const bones = this.getAnimationBones();
        if (!bones) return;

        addBone(bones.leftUpperArm);
        addBone(bones.rightUpperArm);
        addBone(bones.leftLowerArm);
        addBone(bones.rightLowerArm);
        addBone(bones.leftHand);
        addBone(bones.rightHand);

        [
            bones.leftThumb, bones.leftIndex, bones.leftMiddle, bones.leftRing, bones.leftLittle,
            bones.rightThumb, bones.rightIndex, bones.rightMiddle, bones.rightRing, bones.rightLittle
        ].forEach(finger => finger.forEach(addBone));
    }

    private getRestQuaternion(bone: THREE.Object3D): THREE.Quaternion {
        return this.restQuaternions.get(bone.name)?.clone() ?? bone.quaternion.clone();
    }

    private withRestOffset(bone: THREE.Object3D, euler: THREE.Euler): THREE.Quaternion {
        return this.getRestQuaternion(bone).multiply(new THREE.Quaternion().setFromEuler(euler));
    }

    private getRelaxedUpperArmQuaternion(bone: THREE.Object3D, _side: 'left' | 'right'): THREE.Quaternion {
        return this.withRestOffset(bone, new THREE.Euler(-1.35, 0, 0));
    }

    setVRM(vrm: any): void {
        this.vrm = vrm;
        const rootObject = vrm.scene; // Use the root scene for the mixer
        if (rootObject) {
            this.mixer = new THREE.AnimationMixer(rootObject);
        } else {
            console.warn('[AvatarAnimator] VRM scene is undefined.');
        }
        this.captureRestPose();
        this.generateAllAnimations();
        this.resetAllBonesToRest();
        this.startIdleAnimation();
    }

    private generateAllAnimations(): void {
        this.generateIdleAnimation();
        this.generateLetterAnimations();
    }

    setCustomSignAnimation(signName: string, clip: THREE.AnimationClip): void {
        clip.name = signName;
        // Retarget the clip so arbitrary GLB node names (e.g. l_arm_JNT) map to VRM node names natively
        this.retargetClip(clip);
        this.signAnimations.set(signName, clip);
        debugLog(`[AvatarAnimator] Custom animation imported for: ${signName}`);
    }

    setCustomLetterAnimation(letter: string, clip: THREE.AnimationClip): void {
        clip.name = letter;
        this.retargetClip(clip);
        this.injectThumbOverride(clip, letter.toUpperCase());
        this.letterAnimations.set(letter.toUpperCase(), clip);
        debugLog(`[AvatarAnimator] Custom letter animation imported for: ${letter}`);
    }

    private injectThumbOverride(clip: THREE.AnimationClip, letter: string): void {
        if (!this.vrm) return;
        const get = (name: string) => this.getBoneNode(name);

        const thumbProxR = get('rightThumbProximal');
        const thumbDistR = get('rightThumbDistal');
        if (!thumbProxR) {
            console.warn('[AvatarAnimator] injectThumbOverride: rightThumbProximal bone not found — thumb override skipped.');
            return;
        }
        debugLog(`[AvatarAnimator] injectThumbOverride: found proximal=${thumbProxR.name} distal=${thumbDistR?.name}`);


        // ── Per-letter thumb position table ─────────────────────────────────────────
        // 'tucked'   → thumb folded flat across the palm (B, M, N, S, E, A, T, etc.)
        // 'neutral'  → natural rest (slightly out) — trust the GLB as-is
        // 'extended' → thumb pointing up/out (L, Y, etc.)
        type ThumbPose = 'tucked' | 'neutral' | 'extended';
        const thumbPoseMap: Record<string, ThumbPose> = {
            A: 'tucked', B: 'tucked', C: 'neutral', D: 'neutral',
            E: 'tucked', F: 'neutral', G: 'neutral', H: 'tucked',
            I: 'neutral', J: 'neutral', K: 'neutral', L: 'extended',
            M: 'tucked', N: 'tucked', O: 'neutral', P: 'neutral',
            Q: 'neutral', R: 'neutral', S: 'tucked', T: 'tucked',
            U: 'neutral', V: 'neutral', W: 'neutral', X: 'neutral',
            Y: 'extended', Z: 'neutral',
        };

        const pose: ThumbPose = thumbPoseMap[letter] ?? 'neutral';
        if (pose === 'neutral') return; // let the GLB data drive it as-is

        // Build the target quaternion for the thumb proximal bone
        // These Euler values were chosen for VRM's thumb rest orientation.
        // Adjust X/Y/Z angles here if you need fine-tuning per letter.
        let thumbQ: THREE.Quaternion;
        if (pose === 'tucked') {
            // Rotate thumb inward toward palm: ~55° on X, ~30° on Z
            thumbQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.95, 0.0, 0.52));
        } else {
            // Extended: rotate thumb upward/outward
            thumbQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.0, -0.4));
        }

        // Remove any existing track for this bone and replace with our override
        const removeTrack = (boneName: string, node: THREE.Object3D) => {
            clip.tracks = clip.tracks.filter(t => t.name !== `${node.name}.quaternion`);
        };
        removeTrack('rightThumbProximal', thumbProxR);

        const duration = clip.duration;
        const times = [0, duration];
        const vals = [thumbQ.x, thumbQ.y, thumbQ.z, thumbQ.w,
        thumbQ.x, thumbQ.y, thumbQ.z, thumbQ.w];
        clip.tracks.push(new THREE.QuaternionKeyframeTrack(
            `${thumbProxR.name}.quaternion`, times, vals
        ));

        // Also curl the distal joint slightly for a more natural tuck
        if (thumbDistR && pose === 'tucked') {
            const distQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 0, 0));
            clip.tracks = clip.tracks.filter(t => t.name !== `${thumbDistR.name}.quaternion`);
            clip.tracks.push(new THREE.QuaternionKeyframeTrack(
                `${thumbDistR.name}.quaternion`, times,
                [distQ.x, distQ.y, distQ.z, distQ.w, distQ.x, distQ.y, distQ.z, distQ.w]
            ));
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
            'l_handThumb2_JNT': 'leftThumbIntermediate', // static in DeepMotion export, keeps rest pose
            'l_handThumb3_JNT': 'leftThumbDistal',       // only animated curl joint — drives main thumb bend
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
            'r_handThumb2_JNT': 'rightThumbIntermediate', // static in DeepMotion export, keeps rest pose
            'r_handThumb3_JNT': 'rightThumbDistal',       // only animated curl joint — drives main thumb bend
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

            // --- VRoid / J_Bip convention (for new hello.glb) ---
            'J_Bip_C_Hips': 'hips',
            'J_Bip_C_Spine': 'spine',
            'J_Bip_C_Chest': 'chest',
            'J_Bip_C_UpperChest': 'upperChest',
            'J_Bip_C_Neck': 'neck',
            'J_Bip_C_Head': 'head',
            'J_Bip_L_Shoulder': 'leftShoulder',
            'J_Bip_L_UpperArm': 'leftUpperArm',
            'J_Bip_L_LowerArm': 'leftLowerArm',
            'J_Bip_L_Hand': 'leftHand',
            'J_Bip_L_Thumb1': 'leftThumbProximal',
            'J_Bip_L_Thumb2': 'leftThumbIntermediate',
            'J_Bip_L_Thumb3': 'leftThumbDistal',
            'J_Bip_L_Index1': 'leftIndexProximal',
            'J_Bip_L_Index2': 'leftIndexIntermediate',
            'J_Bip_L_Index3': 'leftIndexDistal',
            'J_Bip_L_Middle1': 'leftMiddleProximal',
            'J_Bip_L_Middle2': 'leftMiddleIntermediate',
            'J_Bip_L_Middle3': 'leftMiddleDistal',
            'J_Bip_L_Ring1': 'leftRingProximal',
            'J_Bip_L_Ring2': 'leftRingIntermediate',
            'J_Bip_L_Ring3': 'leftRingDistal',
            'J_Bip_L_Little1': 'leftLittleProximal',
            'J_Bip_L_Little2': 'leftLittleIntermediate',
            'J_Bip_L_Little3': 'leftLittleDistal',
            'J_Bip_R_Shoulder': 'rightShoulder',
            'J_Bip_R_UpperArm': 'rightUpperArm',
            'J_Bip_R_LowerArm': 'rightLowerArm',
            'J_Bip_R_Hand': 'rightHand',
            'J_Bip_R_Thumb1': 'rightThumbProximal',
            'J_Bip_R_Thumb2': 'rightThumbIntermediate',
            'J_Bip_R_Thumb3': 'rightThumbDistal',
            'J_Bip_R_Index1': 'rightIndexProximal',
            'J_Bip_R_Index2': 'rightIndexIntermediate',
            'J_Bip_R_Index3': 'rightIndexDistal',
            'J_Bip_R_Middle1': 'rightMiddleProximal',
            'J_Bip_R_Middle2': 'rightMiddleIntermediate',
            'J_Bip_R_Middle3': 'rightMiddleDistal',
            'J_Bip_R_Ring1': 'rightRingProximal',
            'J_Bip_R_Ring2': 'rightRingIntermediate',
            'J_Bip_R_Ring3': 'rightRingDistal',
            'J_Bip_R_Little1': 'rightLittleProximal',
            'J_Bip_R_Little2': 'rightLittleIntermediate',
            'J_Bip_R_Little3': 'rightLittleDistal',
            'J_Bip_L_UpperLeg': 'leftUpperLeg',
            'J_Bip_L_LowerLeg': 'leftLowerLeg',
            'J_Bip_L_Foot': 'leftFoot',
            'J_Bip_L_ToeBase': 'leftToes',
            'J_Bip_L_Toe': 'leftToes',
            'J_Bip_R_UpperLeg': 'rightUpperLeg',
            'J_Bip_R_LowerLeg': 'rightLowerLeg',
            'J_Bip_R_Foot': 'rightFoot',
            'J_Bip_R_ToeBase': 'rightToes',
            'J_Bip_R_Toe': 'rightToes',
        };

        const tracksToKeep: THREE.KeyframeTrack[] = [];
        const unmappedNodes = new Set<string>();
        const mappedBones: string[] = [];

        clip.tracks.forEach(track => {
            const trackParts = track.name.split('.');
            const nodeName = trackParts[0];
            const propertyName = trackParts[1];

            // Clean armature/namespace prefixes to support all GLB export formats
            let cleanNodeName = nodeName;
            if (cleanNodeName.includes(':')) cleanNodeName = cleanNodeName.split(':').pop()!;
            if (cleanNodeName.includes('|')) cleanNodeName = cleanNodeName.split('|').pop()!;
            if (cleanNodeName.includes('/')) cleanNodeName = cleanNodeName.split('/').pop()!;
            cleanNodeName = cleanNodeName.replace(/^mixamorig\d*[_:]?/i, '');
            cleanNodeName = cleanNodeName.replace(/^Armature[_:]?/i, '');

            // 1. Is this node known in our map?
            let vrmBoneName = boneMap[nodeName] || boneMap[cleanNodeName];

            // 🚀 BONE DEFORMATION FIX: Blender exports position/scale tracks for all bones.
            const isHips = (vrmBoneName === 'hips') || (!vrmBoneName && nodeName.toLowerCase().includes('hip'));
            if ((propertyName === 'position' || propertyName === 'scale') && !isHips) {
                return; // skip to prevent deformation
            }

            if (vrmBoneName) {
                const humanBone = this.getBoneNode(vrmBoneName);

                if (humanBone) {
                    track.name = `${humanBone.name}.${propertyName}`;
                    tracksToKeep.push(track);
                    if (propertyName === 'quaternion') {
                        mappedBones.push(`${nodeName} → ${vrmBoneName}`);
                    }
                }
            } else {
                // Node not in bone map — log it for diagnosis
                if (propertyName === 'quaternion') {
                    unmappedNodes.add(nodeName);
                }
                // Drop unknown tracks: keeping them does nothing since VRM has no matching bone
            }
        });

        // 🔍 DIAGNOSTIC: print unmatched bones so we can identify the correct thumb name
        if (unmappedNodes.size > 0) {
            console.warn(`[AvatarAnimator] "${clip.name}" UNMATCHED bones:`, [...unmappedNodes].join(', '));
        }
        const thumbMapped = mappedBones.filter(b => b.toLowerCase().includes('thumb'));
        debugLog(`[AvatarAnimator] "${clip.name}" thumb tracks: ${thumbMapped.length > 0 ? thumbMapped.join(', ') : 'NONE — bone name mismatch!'}`);

        clip.tracks = tracksToKeep;

        // Apply wrist orientation correction so the palm faces naturally forward for signing
        // this.normalizeHandOrientation(clip);

        // Correct arm positions if the VRM avatar is in T-pose
        // this.normalizeTposeArms(clip);
    }

    /**
     * Corrects upper-arm and lower-arm bone rotations after retargeting.
     *
     * The recording skeleton (source of the GLB animations) uses an A-pose rest
     * (arms angled ~45° downward from horizontal). VRoid Studio 2.x exports avatars
     * in T-pose (arms fully horizontal). Because retargeting copies the LOCAL rotations
     * directly, the same values applied to a T-pose skeleton produce arms that are ~45°
     * too high. This function premultiplies each upper-arm keyframe with a correction
     * quaternion that offsets this rest-pose difference.
     */
    private normalizeTposeArms(clip: THREE.AnimationClip): void {
        if (!this.vrm) return;
        const get = (name: string) => this.getBoneNode(name);

        const applyCorrection = (boneName: string, correction: THREE.Quaternion): void => {
            const boneNode = get(boneName);
            if (!boneNode) return;
            const track = clip.tracks.find(t => t.name === `${boneNode.name}.quaternion`) as THREE.QuaternionKeyframeTrack | undefined;
            if (!track) return;
            const v = track.values;
            for (let i = 0; i < v.length; i += 4) {
                const q = new THREE.Quaternion(v[i], v[i + 1], v[i + 2], v[i + 3]);
                q.premultiply(correction);
                v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; v[i + 3] = q.w;
            }
        };

        // Upper arms: rotate down ~45° from T-pose to match A-pose rest position
        // In VRoid bone local space, Z-axis controls the arm's up/down angle.
        // Left upper arm: positive Z rotates arm down (toward body)
        // Right upper arm: negative Z rotates arm down (toward body)
        applyCorrection('leftUpperArm',  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0,  0.75)));
        applyCorrection('rightUpperArm', new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.75)));

        // Lower arms: small correction to prevent hyperextension when arm is raised
        applyCorrection('leftLowerArm',  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0)));
        applyCorrection('rightLowerArm', new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0, 0)));
    }

    /**
     * Corrects wrist bone rotations after retargeting.
     *
     * DeepMotion/Blender exports the wrist (hand) bone with the palm facing inward
     * relative to the VRM rest pose. A small yaw correction per side opens the palm
     * slightly toward the camera for a more natural signing presentation.
     *
     * Runs once per clip at load time — zero runtime overhead.
     */
    private normalizeHandOrientation(clip: THREE.AnimationClip): void {
        if (!this.vrm) return;
        const get = (name: string) => this.getBoneNode(name);

        /** Apply a corrective quaternion (premultiplied in parent-space) to every keyframe of a bone track. */
        const applyCorrection = (boneName: string, correction: THREE.Quaternion): void => {
            const boneNode = get(boneName);
            if (!boneNode) return;
            const track = clip.tracks.find(t => t.name === `${boneNode.name}.quaternion`) as THREE.QuaternionKeyframeTrack | undefined;
            if (!track) return;
            const v = track.values;
            for (let i = 0; i < v.length; i += 4) {
                const q = new THREE.Quaternion(v[i], v[i + 1], v[i + 2], v[i + 3]);
                q.premultiply(correction);
                v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; v[i + 3] = q.w;
            }
        };

        // ─── Wrist orientation ────────────────────────────────────────────────────────
        // Rotate each palm ~15° outward (yaw) so it faces the camera more naturally.
        applyCorrection('leftHand', new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.26, 0)));
        applyCorrection('rightHand', new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.26, 0)));

        // NOTE: Thumb bones are intentionally NOT corrected here.
        // The correct bone mapping (Thumb1→Proximal, Thumb2→Intermediate, Thumb3→Distal)
        // already passes the right rotation data to the right joints. Any additional axis
        // correction on top of the correct mapping makes the thumb worse, not better.
    }
    private generateIdleAnimation(): void {
        if (!this.vrm) return;

        const spine = this.getBoneNode('spine');
        const chest = this.getBoneNode('chest');
        const upperChest = this.getBoneNode('upperChest');
        const leftUpperArm = this.getBoneNode('leftUpperArm');
        const rightUpperArm = this.getBoneNode('rightUpperArm');
        const leftLowerArm = this.getBoneNode('leftLowerArm');
        const rightLowerArm = this.getBoneNode('rightLowerArm');
        const leftHand = this.getBoneNode('leftHand');
        const rightHand = this.getBoneNode('rightHand');
        const bones = this.getAnimationBones();

        const times = [0, 3];
        const tracks: THREE.KeyframeTrack[] = [];

        const addRestTrack = (bone: THREE.Object3D | null) => {
            if (!bone) return;
            const target = this.getRestQuaternion(bone);
            tracks.push(new THREE.QuaternionKeyframeTrack(
                bone.name + '.quaternion',
                times,
                [target.x, target.y, target.z, target.w, target.x, target.y, target.z, target.w]
            ));
        };

        addRestTrack(spine);
        addRestTrack(chest);
        addRestTrack(upperChest);

        // Keep the idle pose upright while the arms hang beside the body.
        const applyRelaxedArm = (bone: THREE.Object3D | null, side: 'left' | 'right') => {
            if (!bone) return;
            const target = this.getRelaxedUpperArmQuaternion(bone, side);

            tracks.push(new THREE.QuaternionKeyframeTrack(
                bone.name + '.quaternion',
                [0, 3],
                [target.x, target.y, target.z, target.w, target.x, target.y, target.z, target.w]
            ));
        };

        const applyRelaxedElbow = (bone: THREE.Object3D | null) => {
            if (!bone) return;
            const target = this.withRestOffset(bone, new THREE.Euler(0.08, 0, 0));
            tracks.push(new THREE.QuaternionKeyframeTrack(
                bone.name + '.quaternion',
                [0, 3],
                [target.x, target.y, target.z, target.w, target.x, target.y, target.z, target.w]
            ));
        };

        const applyRelaxedHand = (bone: THREE.Object3D | null, side: 'left' | 'right') => {
            if (!bone) return;
            const sign = side === 'left' ? -1 : 1;
            const target = this.withRestOffset(bone, new THREE.Euler(0, 0, sign * 0.03));
            tracks.push(new THREE.QuaternionKeyframeTrack(
                bone.name + '.quaternion',
                [0, 3],
                [target.x, target.y, target.z, target.w, target.x, target.y, target.z, target.w]
            ));
        };

        applyRelaxedArm(leftUpperArm, 'left');
        applyRelaxedArm(rightUpperArm, 'right');
        applyRelaxedElbow(leftLowerArm);
        applyRelaxedElbow(rightLowerArm);
        applyRelaxedHand(leftHand, 'left');
        applyRelaxedHand(rightHand, 'right');

        // Curl fingers slightly for a relaxed resting hand shape
        if (bones) {
            const fingersToCurl = [
                bones.rightIndex, bones.rightMiddle, bones.rightRing, bones.rightLittle,
                bones.leftIndex, bones.leftMiddle, bones.leftRing, bones.leftLittle
            ];
            // Proximal, intermediate, and distal soft curl angles
            const curlX = [0.2, 0.25, 0.15];

            fingersToCurl.forEach(fingerArray => {
                if (fingerArray) {
                    fingerArray.forEach((bone, j) => {
                        if (!bone) return;
                        const target = this.withRestOffset(bone, new THREE.Euler(curlX[j] || 0.15, 0, 0));
                        tracks.push(new THREE.QuaternionKeyframeTrack(
                            bone.name + '.quaternion',
                            [0, 3],
                            [target.x, target.y, target.z, target.w, target.x, target.y, target.z, target.w]
                        ));
                    });
                }
            });

            // Relaxed thumbs
            const addThumbTracks = (thumbArray: (THREE.Object3D | null)[], isLeft: boolean) => {
                if (!thumbArray) return;
                const sign = isLeft ? 1 : -1;
                // Soft thumb pose
                const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, sign * 0.1, -sign * 0.15));
                const q12 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0, 0));

                if (thumbArray[0]) {
                    const target = this.getRestQuaternion(thumbArray[0]).multiply(q0);
                    tracks.push(new THREE.QuaternionKeyframeTrack(thumbArray[0].name + '.quaternion', [0, 3], [target.x, target.y, target.z, target.w, target.x, target.y, target.z, target.w]));
                }
                if (thumbArray[1]) {
                    const target = this.getRestQuaternion(thumbArray[1]).multiply(q12);
                    tracks.push(new THREE.QuaternionKeyframeTrack(thumbArray[1].name + '.quaternion', [0, 3], [target.x, target.y, target.z, target.w, target.x, target.y, target.z, target.w]));
                }
                if (thumbArray[2]) {
                    const target = this.getRestQuaternion(thumbArray[2]).multiply(q12);
                    tracks.push(new THREE.QuaternionKeyframeTrack(thumbArray[2].name + '.quaternion', [0, 3], [target.x, target.y, target.z, target.w, target.x, target.y, target.z, target.w]));
                }
            };

            addThumbTracks(bones.rightThumb, false);
            addThumbTracks(bones.leftThumb, true);
        }

        this.idleClip = new THREE.AnimationClip('idle', 3, tracks);
    }


    private generateLetterAnimations(): void {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        for (let i = 0; i < letters.length; i++) {
            const letter = letters[i];
            const clip = this.createUniqueLetterAnimation(letter, i);
            this.letterAnimations.set(letter, clip);
        }
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
                tracks.push(new THREE.QuaternionKeyframeTrack(rightUpperArm.name + '.quaternion', [0, duration], [0, 0, 0, 1, q.x, q.y, q.z, q.w]));
            }
            if (rightLowerArm) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.8, 0, 0));
                tracks.push(new THREE.QuaternionKeyframeTrack(rightLowerArm.name + '.quaternion', [0, duration], [0, 0, 0, 1, q.x, q.y, q.z, q.w]));
            }
            if (rightHand) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.5));
                tracks.push(new THREE.QuaternionKeyframeTrack(rightHand.name + '.quaternion', [0, duration], [0, 0, 0, 1, q.x, q.y, q.z, q.w]));
            }

            // Curl all fingers slightly for a natural "ready" pose
            [rightThumb, rightIndex, rightMiddle, rightRing, rightLittle].forEach(fingerArray => {
                fingerArray?.forEach((bone: any) => {
                    if (bone) {
                        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0));
                        tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', [0, duration], [0, 0, 0, 1, q.x, q.y, q.z, q.w]));
                    }
                });
            });
        } else {
            const { leftUpperArm, leftLowerArm, leftHand,
                leftThumb, leftIndex, leftMiddle, leftRing, leftLittle } = bones as any;

            if (leftUpperArm) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, -0.2, -0.2));
                tracks.push(new THREE.QuaternionKeyframeTrack(leftUpperArm.name + '.quaternion', [0, duration], [0, 0, 0, 1, q.x, q.y, q.z, q.w]));
            }
            if (leftLowerArm) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.8, 0, 0));
                tracks.push(new THREE.QuaternionKeyframeTrack(leftLowerArm.name + '.quaternion', [0, duration], [0, 0, 0, 1, q.x, q.y, q.z, q.w]));
            }
            if (leftHand) {
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.5));
                tracks.push(new THREE.QuaternionKeyframeTrack(leftHand.name + '.quaternion', [0, duration], [0, 0, 0, 1, q.x, q.y, q.z, q.w]));
            }

            [leftThumb, leftIndex, leftMiddle, leftRing, leftLittle].forEach(fingerArray => {
                fingerArray?.forEach((bone: any) => {
                    if (bone) {
                        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0, 0));
                        tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', [0, duration], [0, 0, 0, 1, q.x, q.y, q.z, q.w]));
                    }
                });
            });
        }

        return new THREE.AnimationClip(letter, duration, tracks);
    }

    private getAnimationBones() {
        if (!this.vrm) return null;

        const get = (name: string) => this.getBoneNode(name);

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

    private resetAllBonesToRest(): void {
        if (!this.vrm) return;

        const resetToCapturedRest = (bone: THREE.Object3D | null) => {
            if (bone) bone.quaternion.copy(this.getRestQuaternion(bone));
        };

        resetToCapturedRest(this.getBoneNode('spine'));
        resetToCapturedRest(this.getBoneNode('chest'));
        resetToCapturedRest(this.getBoneNode('upperChest'));

        const bones = this.getAnimationBones();
        if (!bones) return;

        // Reset fingers to a soft, natural curl
        const fingersToCurl = [
            bones.rightIndex, bones.rightMiddle, bones.rightRing, bones.rightLittle,
            bones.leftIndex, bones.leftMiddle, bones.leftRing, bones.leftLittle
        ];
        const curlX = [0.2, 0.25, 0.15];

        fingersToCurl.forEach(fingerArray => {
            if (fingerArray) {
                fingerArray.forEach((bone, j) => {
                    if (bone) {
                        bone.quaternion.copy(this.withRestOffset(bone, new THREE.Euler(curlX[j] || 0.15, 0, 0)));
                    }
                });
            }
        });

        // Relaxed thumbs
        const resetThumb = (thumbArray: (THREE.Object3D | null)[], isLeft: boolean) => {
            if (!thumbArray) return;
            const sign = isLeft ? 1 : -1;
            const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, sign * 0.1, -sign * 0.15));
            const q12 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0, 0));

            if (thumbArray[0]) thumbArray[0].quaternion.copy(this.getRestQuaternion(thumbArray[0]).multiply(q0));
            if (thumbArray[1]) thumbArray[1].quaternion.copy(this.getRestQuaternion(thumbArray[1]).multiply(q12));
            if (thumbArray[2]) thumbArray[2].quaternion.copy(this.getRestQuaternion(thumbArray[2]).multiply(q12));
        };
        resetThumb(bones.rightThumb, false);
        resetThumb(bones.leftThumb, true);

        // Reset lower arms (soft elbow bend)
        if (bones.leftLowerArm) bones.leftLowerArm.quaternion.copy(this.withRestOffset(bones.leftLowerArm, new THREE.Euler(0.08, 0, 0)));
        if (bones.rightLowerArm) bones.rightLowerArm.quaternion.copy(this.withRestOffset(bones.rightLowerArm, new THREE.Euler(0.08, 0, 0)));

        // Reset wrists (soft hand hang)
        if (bones.leftHand) bones.leftHand.quaternion.copy(this.withRestOffset(bones.leftHand, new THREE.Euler(0, 0, -0.03)));
        if (bones.rightHand) bones.rightHand.quaternion.copy(this.withRestOffset(bones.rightHand, new THREE.Euler(0, 0, 0.03)));

        // Reset upper arms to hang naturally downward along the body
        if (bones.leftUpperArm) bones.leftUpperArm.quaternion.copy(this.getRelaxedUpperArmQuaternion(bones.leftUpperArm, 'left'));
        if (bones.rightUpperArm) bones.rightUpperArm.quaternion.copy(this.getRelaxedUpperArmQuaternion(bones.rightUpperArm, 'right'));
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
        // Bump the ID to invalidate any stale setTimeout callbacks from previous animations
        this.sequenceId++;
        const myId = this.sequenceId;

        // Preprocess sequence: if a sign does not have a custom animation loaded, expand it into fingerspelling letters
        const processedSequence: SequenceItem[] = [];
        for (const item of sequence) {
            if (item.type === 'sign') {
                const upperVal = item.value.toUpperCase();
                const upperDisp = item.display ? item.display.toUpperCase() : '';

                if (this.signAnimations.has(upperVal)) {
                    processedSequence.push({ ...item, value: upperVal });
                } else if (upperDisp && this.signAnimations.has(upperDisp)) {
                    processedSequence.push({ ...item, value: upperDisp });
                } else {
                    debugLog(`[AvatarAnimator] Sign "${item.value}" / "${item.display}" not found in custom animations. Fingerspelling fallback.`);
                    const textToSpell = (upperDisp || upperVal).replace(/[^A-Z]/g, '');
                    for (const char of textToSpell) {
                        processedSequence.push({
                            type: 'letter',
                            value: char
                        });
                    }
                }
            } else {
                processedSequence.push(item);
            }
        }

        // Replace the queue and start processing.
        this.queue = processedSequence;
        this.isProcessingQueue = false;

        this.processNextInQueue(myId);
    }

    private processNextInQueue(id: number = this.sequenceId): void {
        // If a newer sequence has started, this callback is stale — bail out
        if (id !== this.sequenceId) {
            debugLog('[AvatarAnimator] Stale timer callback ignored.');
            return;
        }

        if (!this.mixer || this.queue.length === 0) {
            debugLog(`[AvatarAnimator] Sequence #${id} finished.`);
            this.isProcessingQueue = false;
            this.isPlayingSign = false;

            // Reset all bones to their default rest pose before returning to idle
            this.resetAllBonesToRest();

            if (this.currentSignAction) {
                this.currentSignAction.fadeOut(0.3);
            }
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

        debugLog(`[AvatarAnimator] Playing "${nextItem.value}", duration=${clip.duration.toFixed(2)}s, tracks=${clip.tracks.length}`);

        const nextAction = this.mixer.clipAction(clip);
        nextAction.setLoop(THREE.LoopOnce, 1);
        nextAction.clampWhenFinished = true;

        // 🚀 BONE RESET: If we are transitioning from a fingerspelling letter (curled fingers) 
        // to a sign that might not have finger tracks, we MUST ensure the bones reset.
        this.resetAllBonesToRest();

        const isLetter = nextItem.type === 'letter';
        const playbackRate = isLetter ? 1.6 : 1.0;

        nextAction.timeScale = playbackRate;

        // Letters crossfade quickly so the sequence feels fluid; signs get a longer blend.
        const crossFadeDuration = isLetter ? 0.08 : 0.25;

        if (this.currentSignAction) {
            nextAction.reset().play();
            nextAction.crossFadeFrom(this.currentSignAction, crossFadeDuration, true);
        } else {
            // If starting fresh, fade out idle and any other lingering actions
            this.mixer.stopAllAction(); // Heavy reset to clear any "stuck" finger weights
            if (this.idleAction) {
                this.idleAction.reset().play();
                nextAction.reset().play();
                nextAction.crossFadeFrom(this.idleAction, crossFadeDuration, true);
            } else {
                nextAction.reset().play();
            }
        }

        this.currentSignAction = nextAction;
        this.isPlayingSign = true;

        // For letters, hold the pose briefly so it's readable, then move to the next.
        // For signs, play full duration with a small buffer.
        const effectiveDurationMs = (clip.duration / playbackRate) * 1000;
        const holdMs = isLetter
            ? Math.max(effectiveDurationMs, 450) + 60
            : effectiveDurationMs + 200;
        setTimeout(() => {
            this.processNextInQueue(id);
        }, holdMs);
    }

    playSignAnimation(signName: string): void {
        this.playSequence([{ type: 'sign', value: signName }]);
    }

    playLetterAnimation(letter: string): void {
        this.playSequence([{ type: 'letter', value: letter }]);
    }

    stopSignAnimation(): void {
        debugLog('[AvatarAnimator] Resetting whole queue');
        this.queue = [];
        this.isProcessingQueue = false;
        if (this.currentSignAction) {
            this.currentSignAction.fadeOut(0.3);
            this.currentSignAction = null;
        }
        this.isPlayingSign = false;

        this.resetAllBonesToRest();

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
