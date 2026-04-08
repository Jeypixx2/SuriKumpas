# SuriKumpas - Filipino Sign Language Recognition App

A full React Native app using Expo and TypeScript for Filipino Sign Language (FSL) recognition and translation.

## Features

- **Sign Detection**: Real-time FSL sign recognition using camera and MediaPipe Holistic
- **Speech to Sign**: Voice recognition that translates speech to sign language animations
- **3D Avatar**: Interactive VRM avatar that demonstrates sign language gestures
- **105 FSL Signs**: Complete recognition of Filipino Sign Language vocabulary
- **Alphabet Recognition**: Fingerspelling detection for the Filipino alphabet

## Screens

1. **Splash/Loading**: Loads TFLite models (FSL + Alphabet) and 3D Avatar
2. **Home**: Category browsing and navigation to detection modes
3. **Detect Sign**: Camera-based sign recognition with picture-in-picture avatar
4. **Speech to Sign**: Voice input with full-screen avatar demonstration

## Technical Stack

- **Framework**: Expo SDK 50 with TypeScript
- **Navigation**: React Navigation v6 with bottom tabs
- **ML**: react-native-fast-tflite for TFLite model inference
- **3D Graphics**: expo-gl, three.js, and three-vrm for avatar
- **MediaPipe**: Holistic keypoint extraction (1662 keypoints)
- **Voice**: @react-native-voice/voice for speech recognition

## Project Structure

```
app/
  loading.tsx          - Splash screen with loading progress
  _layout.tsx          - Root layout with Stack navigator
  (tabs)/
    _layout.tsx        - Tab layout configuration
    index.tsx          - Home screen
    detect.tsx         - Sign detection screen
    translate.tsx      - Speech to sign screen

components/
  AvatarViewer.tsx     - 3D VRM avatar with animations
  CameraProcessor.tsx  - Camera + MediaPipe keypoint extraction
  MicButton.tsx        - Animated microphone button
  ResultOverlay.tsx    - Detection result display
  LoadingScreen.tsx    - Step-by-step loading UI

lib/
  labels.ts            - FSL labels (105 signs + alphabet)
  SignClassifier.ts  - TFLite model inference
  ModelSwitcher.ts     - Hand movement detection
  extractKeypoints.ts  - MediaPipe keypoint extraction
  AvatarAnimator.ts    - Bone animation generation

assets/
  fsl_model.tflite     - FSL recognition model (user-provided)
  alphabet_model.tflite - Alphabet recognition model (user-provided)
  avatar.vrm           - 3D avatar file (user-provided)
```

## Setup Instructions

1. **Install dependencies**:
   ```bash
   cd d:\SuriKumpas
   npm install
   ```

2. **Add model files**: Copy your `.tflite` models to the `assets/` folder:
   - `assets/fsl_model.tflite` - Your FSL recognition model
   - `assets/alphabet_model.tflite` - Your alphabet recognition model
   - `assets/avatar.vrm` - Your VRM avatar file

3. **Start the app**:
   ```bash
   npx expo start
   ```

## Model Requirements

### FSL Model (`fsl_model.tflite`)
- Input shape: `[1, 30, 1662]` (30 frames × 1662 keypoints)
- Output shape: `[1, 105]` (105 FSL sign classes)
- Format: TFLite with float32 input/output

### Alphabet Model (`alphabet_model.tflite`)
- Input shape: `[1, 1, 1662]` (1 frame × 1662 keypoints)
- Output shape: `[1, 26]` (26 alphabet letters)
- Format: TFLite with float32 input/output

### avatar Model (`avatar.vrm`)
- Format: VRM 0.x or 1.0
- Required bones for signing:
  - rightUpperArm, rightLowerArm, rightHand
  - leftUpperArm, leftLowerArm, leftHand
  - rightThumbProximal, rightIndexProximal, rightMiddleProximal
  - leftThumbProximal, leftIndexProximal, leftMiddleProximal

## MediaPipe Keypoint Format

The app expects exactly 1662 keypoints per frame:
- **33 pose landmarks** × 4 values (x, y, z, visibility) = 132
- **468 face landmarks** × 3 values (x, y, z) = 1404
- **21 left hand landmarks** × 3 values (x, y, z) = 63
- **21 right hand landmarks** × 3 values (x, y, z) = 63
- **Total: 1662 values**

## FSL Labels (105 Signs)

The app recognizes 105 FSL signs across 13 categories:
- GREETING (10 signs): GOOD MORNING, HELLO, THANK YOU, etc.
- SURVIVAL (10 signs): YES, NO, UNDERSTAND, SLOW, FAST, etc.
- NUMBER (10 signs): ONE through TEN
- CALENDAR (12 signs): JANUARY through DECEMBER
- DAYS (10 signs): MONDAY through SUNDAY, TODAY, TOMORROW, YESTERDAY
- FAMILY (10 signs): FATHER, MOTHER, SON, DAUGHTER, etc.
- RELATIONSHIPS (10 signs): BOY, GIRL, MAN, WOMAN, DEAF, etc.
- COLOR (13 signs): BLUE, RED, BLACK, WHITE, etc.
- FOOD (10 signs): BREAD, RICE, FISH, CHICKEN, etc.
- DRINK (10 signs): HOT, COLD, COFFEE, TEA, BEER, etc.

## Permissions Required

- **Camera**: For sign detection
- **Microphone**: For speech recognition
- **Internet**: For MediaPipe CDN resources

## Development Notes

- The app uses `react-native-fast-tflite` to load `.tflite` files directly
- MediaPipe Holistic is loaded via CDN script tag in WebView
- Avatar animations are procedurally generated using THREE.js
- Dark theme with accent color #00e5ff throughout

## License

This project is for educational purposes in Filipino Sign Language recognition.
