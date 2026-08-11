import React, { useEffect, useMemo, useState } from 'react';
import { Tabs, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { AvatarProvider, useAvatarContext } from '../../lib/AvatarContext';
import AvatarViewer from '../../components/AvatarViewer';
import { globalAlphabetImageClassifier } from '../../lib/AlphabetImageClassifier';
import { globalClassifier } from '../../lib/SignClassifier';
import LoadingScreen from '../../components/LoadingScreen';

const BOOT_MIN_MS = 1200;
const BOOT_MAX_MS = 8500;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type LoadingStepStatus = 'pending' | 'loading' | 'complete' | 'error';

function BootLoadingOverlay() {
  const { isAvatarLoaded, avatarLoadError } = useAvatarContext();
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const minTimer = setTimeout(() => setMinimumElapsed(true), BOOT_MIN_MS);
    const maxTimer = setTimeout(() => setTimedOut(true), BOOT_MAX_MS);

    return () => {
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      await wait(200);
      let wordModelFailed = false;

      // Word recognition is the default Detect experience. Load and validate
      // it before allowing the startup overlay to close.
      try {
        await globalClassifier.loadFSLModel();
        console.log('[Boot] Word SignClassifier preloaded.');
      } catch (error) {
        wordModelFailed = true;
        console.warn('[Boot] Word SignClassifier preload failed:', error);
      }

      if (!cancelled) {
        setModelsLoaded(true);
        setModelsFailed(wordModelFailed);
      }

      // Alphabet mode is optional at startup. Warm it only after the word
      // model has finished so both TFLite loads do not compete for resources.
      try {
        await globalAlphabetImageClassifier.load();
        console.log('[Boot] Alphabet classifier preloaded.');
      } catch (error) {
        console.warn('[Boot] Alphabet classifier preload failed:', error);
      }
    };

    loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  const modelStepDone = modelsLoaded || modelsFailed;
  const avatarStepDone = isAvatarLoaded || !!avatarLoadError || timedOut;
  const ready = minimumElapsed && avatarStepDone && modelStepDone;
  if (ready) return null;

  const steps: { label: string; status: LoadingStepStatus }[] = [
    {
      label: '3D avatar',
      status: avatarLoadError ? 'error' : isAvatarLoaded ? 'complete' : timedOut ? 'pending' : 'loading',
    },
    {
      label: 'Word recognition model',
      status: modelsFailed ? 'error' : modelsLoaded ? 'complete' : 'loading',
    },
    {
      label: 'Sign animation loader',
      status: isAvatarLoaded ? 'complete' : 'pending',
    },
  ];

  const loadingIndex = steps.findIndex(step => step.status === 'loading' || step.status === 'error');
  const currentStep = loadingIndex >= 0 ? loadingIndex : steps.length - 1;

  return (
    <View style={styles.bootOverlay}>
      <LoadingScreen steps={steps} currentStep={currentStep} />
    </View>
  );
}

function GlobalAvatar() {
  const { 
    signToPlay, setSignToPlay,
    letterToPlay, setLetterToPlay,
    sequenceToPlay, setSequenceToPlay,
    isAvatarLoaded, setIsAvatarLoaded,
    avatarLoadError, setAvatarLoadError
  } = useAvatarContext();

  const dots = useMemo(() => {
    return Array.from({ length: 50 }).map((_, i) => (
      <View
          key={i}
          style={[
              styles.bgDot,
              {
                  left: (i % 10) * 40 + 20,
                  top: Math.floor(i / 10) * 80 + 50
              }
          ]}
      />
    ));
  }, []);

  const shouldShowAvatar = true;

  return (
    <View
      pointerEvents="none"
      style={[
      styles.avatarContainer,
      {
        opacity: shouldShowAvatar ? 1 : 0,
      }
    ]}>
      <AvatarViewer
        style={styles.avatar}
        signToPlay={signToPlay}
        letterToPlay={letterToPlay}
        sequenceToPlay={sequenceToPlay}
        onVRMLoaded={() => {
          setAvatarLoadError(null);
          setIsAvatarLoaded(true);
        }}
        onError={(error) => {
          console.error('Avatar error:', error);
          setAvatarLoadError(error.message);
        }}
        active={shouldShowAvatar}
        onSequenceEnd={() => {
          setSequenceToPlay(null);
          setSignToPlay(null);
          setLetterToPlay(null);
        }}
      />

      <View style={styles.dotPatternBackground}>
         {dots}
      </View>

      {!isAvatarLoaded && (
        <View style={styles.loadingOverlay}>
          <Text style={[styles.loadingText, avatarLoadError && styles.loadingErrorText]}>
            {avatarLoadError ? 'Avatar could not load' : 'Preparing avatar...'}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  return (
    <AvatarProvider>
      <View style={{ flex: 1, backgroundColor: '#FFF9F5' }}>
        <Tabs 
          screenOptions={{ 
            headerShown: false, 
            tabBarStyle: { display: 'none' }
          }}
        >
          <Tabs.Screen name="index" />
        </Tabs>
        <GlobalAvatar />
        <BootLoadingOverlay />
      </View>
    </AvatarProvider>
  );
}

const styles = StyleSheet.create({
    avatarContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '50%',
        backgroundColor: 'transparent',
        zIndex: 100,
    },
    avatar: {
        flex: 1,
    },
    loadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255, 249, 245, 0.85)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 5,
    },
    loadingText: {
        color: '#5BC4B5',
        fontSize: 16,
        fontWeight: 'bold',
    },
    loadingErrorText: {
        color: '#E57373',
    },
    dotPatternBackground: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
    },
    bgDot: {
        position: 'absolute',
        width: 3,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: 'rgba(91, 196, 181, 0.18)',
    },
    bootOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 300,
        elevation: 300,
        backgroundColor: '#FFF9F5',
    },
});
