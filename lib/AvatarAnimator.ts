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

export class AvatarAnimator {
    private vrm: VRM | null = null;
    private mixer: THREE.AnimationMixer | null = null;
    private clock: THREE.Clock = new THREE.Clock();
    private idleAction: THREE.AnimationAction | null = null;
    private currentSignAction: THREE.AnimationAction | null = null;
    private isPlayingSign: boolean = false;

    private signAnimations: Map<string, THREE.AnimationClip> = new Map();
    private letterAnimations: Map<string, THREE.AnimationClip> = new Map();
    private idleClip: THREE.AnimationClip | null = null;

    setVRM(vrm: VRM): void {
        this.vrm = vrm;
        const rootObject = vrm.humanoid.humanBones.spine?.node?.parent;
        if (rootObject) {
            this.mixer = new THREE.AnimationMixer(rootObject);
        }
        this.generateAllAnimations();
        this.startIdleAnimation();
    }

    private generateAllAnimations(): void {
        this.generateIdleAnimation();
        this.generateSignAnimations();
        this.generateLetterAnimations();
    }

    private generateIdleAnimation(): void {
        if (!this.vrm) return;

        const spine = this.vrm.humanoid.humanBones.spine?.node;
        const chest = this.vrm.humanoid.humanBones.chest?.node;

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
                spine.uuid + '.quaternion',
                times,
                spineValues
            ));
        }
        if (chest) {
            tracks.push(new THREE.QuaternionKeyframeTrack(
                chest.uuid + '.quaternion',
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

        if (rightUpperArm) tracks.push(new THREE.QuaternionKeyframeTrack(rightUpperArm.uuid + '.quaternion', times, ruaValues));
        if (rightLowerArm) tracks.push(new THREE.QuaternionKeyframeTrack(rightLowerArm.uuid + '.quaternion', times, rlaValues));
        if (rightHand) tracks.push(new THREE.QuaternionKeyframeTrack(rightHand.uuid + '.quaternion', times, rhValues));
        if (leftUpperArm) tracks.push(new THREE.QuaternionKeyframeTrack(leftUpperArm.uuid + '.quaternion', times, luaValues));
        if (leftLowerArm) tracks.push(new THREE.QuaternionKeyframeTrack(leftLowerArm.uuid + '.quaternion', times, llaValues));
        if (leftHand) tracks.push(new THREE.QuaternionKeyframeTrack(leftHand.uuid + '.quaternion', times, lhValues));

        if (rightThumb) tracks.push(new THREE.QuaternionKeyframeTrack(rightThumb.uuid + '.quaternion', fingerTimes, rtValues));
        if (rightIndex) tracks.push(new THREE.QuaternionKeyframeTrack(rightIndex.uuid + '.quaternion', fingerTimes, riValues));
        if (rightMiddle) tracks.push(new THREE.QuaternionKeyframeTrack(rightMiddle.uuid + '.quaternion', fingerTimes, rmValues));
        if (leftThumb) tracks.push(new THREE.QuaternionKeyframeTrack(leftThumb.uuid + '.quaternion', fingerTimes, ltValues));
        if (leftIndex) tracks.push(new THREE.QuaternionKeyframeTrack(leftIndex.uuid + '.quaternion', fingerTimes, liValues));
        if (leftMiddle) tracks.push(new THREE.QuaternionKeyframeTrack(leftMiddle.uuid + '.quaternion', fingerTimes, lmValues));

        return new THREE.AnimationClip(signName, duration, tracks);
    }

    private createUniqueLetterAnimation(letter: string, index: number): THREE.AnimationClip {
        if (!this.vrm) return new THREE.AnimationClip(letter, 1, []);

        const seed = index * 89.7 + 1000;
        const tracks: THREE.KeyframeTrack[] = [];

        const bones = this.getAnimationBones();
        if (!bones) return new THREE.AnimationClip(letter, 1, []);

        const { rightUpperArm, rightLowerArm, rightHand, leftUpperArm, leftLowerArm, leftHand,
                rightThumb, rightIndex, rightMiddle, leftThumb, leftIndex, leftMiddle } = bones;

        const duration = 0.8;
        const times = [0, duration * 0.5, duration];

        const isRightHanded = index % 2 === 0;

        if (isRightHanded) {
            const ruaValues = this.generateArmKeyframes(seed, 4, times.length);
            const rlaValues = this.generateArmKeyframes(seed + 5, 5, times.length);
            const rhValues = this.generateHandKeyframes(seed + 10, times.length);

            if (rightUpperArm) tracks.push(new THREE.QuaternionKeyframeTrack(rightUpperArm.uuid + '.quaternion', times, ruaValues));
            if (rightLowerArm) tracks.push(new THREE.QuaternionKeyframeTrack(rightLowerArm.uuid + '.quaternion', times, rlaValues));
            if (rightHand) tracks.push(new THREE.QuaternionKeyframeTrack(rightHand.uuid + '.quaternion', times, rhValues));

            const fingerTimes = [0, duration * 0.3, duration * 0.7, duration];
            const rtValues = this.generateFingerKeyframes(seed + 15, fingerTimes.length, true);
            const riValues = this.generateFingerKeyframes(seed + 25, fingerTimes.length, true);
            const rmValues = this.generateFingerKeyframes(seed + 35, fingerTimes.length, true);

            if (rightThumb) tracks.push(new THREE.QuaternionKeyframeTrack(rightThumb.uuid + '.quaternion', fingerTimes, rtValues));
            if (rightIndex) tracks.push(new THREE.QuaternionKeyframeTrack(rightIndex.uuid + '.quaternion', fingerTimes, riValues));
            if (rightMiddle) tracks.push(new THREE.QuaternionKeyframeTrack(rightMiddle.uuid + '.quaternion', fingerTimes, rmValues));
        } else {
            const luaValues = this.generateArmKeyframes(seed, 6, times.length);
            const llaValues = this.generateArmKeyframes(seed + 5, 7, times.length);
            const lhValues = this.generateHandKeyframes(seed + 10, times.length);

            if (leftUpperArm) tracks.push(new THREE.QuaternionKeyframeTrack(leftUpperArm.uuid + '.quaternion', times, luaValues));
            if (leftLowerArm) tracks.push(new THREE.QuaternionKeyframeTrack(leftLowerArm.uuid + '.quaternion', times, llaValues));
            if (leftHand) tracks.push(new THREE.QuaternionKeyframeTrack(leftHand.uuid + '.quaternion', times, lhValues));

            const fingerTimes = [0, duration * 0.3, duration * 0.7, duration];
            const ltValues = this.generateFingerKeyframes(seed + 15, fingerTimes.length, true);
            const liValues = this.generateFingerKeyframes(seed + 25, fingerTimes.length, true);
            const lmValues = this.generateFingerKeyframes(seed + 35, fingerTimes.length, true);

            if (leftThumb) tracks.push(new THREE.QuaternionKeyframeTrack(leftThumb.uuid + '.quaternion', fingerTimes, ltValues));
            if (leftIndex) tracks.push(new THREE.QuaternionKeyframeTrack(leftIndex.uuid + '.quaternion', fingerTimes, liValues));
            if (leftMiddle) tracks.push(new THREE.QuaternionKeyframeTrack(leftMiddle.uuid + '.quaternion', fingerTimes, lmValues));
        }

        return new THREE.AnimationClip(letter, duration, tracks);
    }

    private getAnimationBones() {
        if (!this.vrm) return null;

        return {
            rightUpperArm: this.vrm.humanoid.humanBones.rightUpperArm?.node,
            rightLowerArm: this.vrm.humanoid.humanBones.rightLowerArm?.node,
            rightHand: this.vrm.humanoid.humanBones.rightHand?.node,
            leftUpperArm: this.vrm.humanoid.humanBones.leftUpperArm?.node,
            leftLowerArm: this.vrm.humanoid.humanBones.leftLowerArm?.node,
            leftHand: this.vrm.humanoid.humanBones.leftHand?.node,
            rightThumb: this.vrm.humanoid.humanBones.rightThumbProximal?.node,
            rightIndex: this.vrm.humanoid.humanBones.rightIndexProximal?.node,
            rightMiddle: this.vrm.humanoid.humanBones.rightMiddleProximal?.node,
            leftThumb: this.vrm.humanoid.humanBones.leftThumbProximal?.node,
            leftIndex: this.vrm.humanoid.humanBones.leftIndexProximal?.node,
            leftMiddle: this.vrm.humanoid.humanBones.leftMiddleProximal?.node
        };
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

    playSignAnimation(signName: string): void {
        if (!this.mixer || this.isPlayingSign) return;

        const clip = this.signAnimations.get(signName);
        if (!clip) {
            console.warn(`Sign animation not found: ${signName}`);
            return;
        }

        if (this.idleAction) {
            this.idleAction.stop();
        }

        this.currentSignAction = this.mixer.clipAction(clip);
        this.currentSignAction.setLoop(THREE.LoopOnce, 1);
        this.currentSignAction.clampWhenFinished = true;
        this.currentSignAction.play();
        this.isPlayingSign = true;

        setTimeout(() => {
            this.stopSignAnimation();
        }, (clip.duration * 1000) + 2000);
    }

    playLetterAnimation(letter: string): void {
        if (!this.mixer || this.isPlayingSign) return;

        const clip = this.letterAnimations.get(letter.toUpperCase());
        if (!clip) {
            console.warn(`Letter animation not found: ${letter}`);
            return;
        }

        if (this.idleAction) {
            this.idleAction.stop();
        }

        this.currentSignAction = this.mixer.clipAction(clip);
        this.currentSignAction.setLoop(THREE.LoopOnce, 1);
        this.currentSignAction.clampWhenFinished = true;
        this.currentSignAction.play();
        this.isPlayingSign = true;

        setTimeout(() => {
            this.stopSignAnimation();
        }, (clip.duration * 1000) + 1000);
    }

    stopSignAnimation(): void {
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
