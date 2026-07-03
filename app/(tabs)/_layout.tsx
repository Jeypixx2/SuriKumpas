import React, { useEffect, useMemo, useState } from 'react';
import { Tabs, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { AvatarProvider, useAvatarContext } from '../../lib/AvatarContext';
import AvatarViewer from '../../components/AvatarViewer';
import { globalClassifier } from '../../lib/SignClassifier';
import LoadingScreen from '../../components/LoadingScreen';

const BOOT_MIN_MS = 1200;
const BOOT_MAX_MS = 8500;
const MODEL_LOAD_GAP_MS = 350;

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
      try {
        await wait(200);
        await globalClassifier.loadFSLModel();
        await wait(MODEL_LOAD_GAP_MS);
        await globalClassifier.loadAlphabetModel();
        if (!cancelled) setModelsLoaded(true);
      } catch (error) {
        console.warn('[Boot] Model preload failed:', error);
        if (!cancelled) setModelsFailed(true);
      }
    };

    loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  const modelStepDone = modelsLoaded || modelsFailed;
  const avatarStepDone = isAvatarLoaded || !!avatarLoadError;
  const ready = minimumElapsed && avatarStepDone && modelStepDone;
  if (ready || timedOut) return null;

  const steps: { label: string; status: LoadingStepStatus }[] = [
    {
      label: '3D avatar',
      status: avatarLoadError ? 'error' : isAvatarLoaded ? 'complete' : 'loading',
    },
    {
      label: 'Recognition models',
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
  const segments = useSegments();
  const isTranslate = segments.includes('translate');
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

  const shouldShowAvatar = isTranslate;

  useEffect(() => {
    if (!isTranslate) {
      setSequenceToPlay(null);
      setSignToPlay(null);
      setLetterToPlay(null);
    }
  }, [isTranslate, setSequenceToPlay, setSignToPlay, setLetterToPlay]);

  return (
    <View
      pointerEvents={isTranslate ? 'auto' : 'none'}
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

      {isTranslate && !isAvatarLoaded && (
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
            tabBarStyle: { 
              backgroundColor: '#FFFFFF', 
              borderTopColor: '#EEE8FF',
              borderTopWidth: 1.5,
              shadowColor: '#8080B0',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.08,
              shadowRadius: 8,
              elevation: 8,
            }, 
            tabBarActiveTintColor: '#5BC4B5', 
            tabBarInactiveTintColor: '#B0B0C8',
            lazy: true
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Home',
              tabBarIcon: ({ color }) => <Ionicons name="home" size={24} color={color} />
            }}
          />
          <Tabs.Screen
            name="detect"
            options={{
              title: 'Detect',
              tabBarIcon: ({ color }) => <Ionicons name="camera" size={24} color={color} />
            }}
          />
          <Tabs.Screen
            name="translate"
            options={{
              title: 'Translate',
              tabBarIcon: ({ color }) => <Ionicons name="mic" size={24} color={color} />
            }}
          />
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
        height: '45%',
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
