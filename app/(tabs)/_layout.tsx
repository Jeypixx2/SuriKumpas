import React, { useEffect, useMemo, useState } from 'react';
import { Tabs, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AvatarProvider, useAvatarContext } from '../../lib/AvatarContext';
import AvatarViewer from '../../components/AvatarViewer';
import { globalAlphabetClassifier } from '../../lib/AlphabetClassifier';
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
        await globalAlphabetClassifier.load();
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
    avatarLoadError, setAvatarLoadError,
    spokenText, setSpokenText,
    clearAvatarSigning
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
  const hasActiveSpeech = Boolean(spokenText || (sequenceToPlay && sequenceToPlay.length > 0));

  return (
    <View
      pointerEvents="box-none"
      style={[
      styles.avatarContainer,
      {
        opacity: shouldShowAvatar ? 1 : 0,
      }
    ]}>
      <AvatarViewer
        style={styles.avatar}
        pointerEvents="none"
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
          setSpokenText('');
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

      {/* Recognized Word Card: Rendered directly on top of AvatarViewer so the 3D model is BEHIND it! */}
      {hasActiveSpeech && (
        <View style={styles.bottomWordCardContainer} pointerEvents="box-none">
          <View style={styles.speechOverlayCard}>
            <View style={styles.speechMainRow}>
              <View style={styles.voiceIconBubble}>
                <Ionicons name="mic" size={18} color="#FFFFFF" />
              </View>

              <View style={styles.speechTextContainer}>
                <Text style={styles.speechLabelHeading}>SINALITA</Text>
                <Text
                  style={[
                    styles.speechRecognizedWord,
                    ((spokenText || '').length > 14) && styles.speechRecognizedWordLong
                  ]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {spokenText ? spokenText.toUpperCase() : (sequenceToPlay?.[0]?.display ?? '')}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.clearSpeechButton}
                onPress={clearAvatarSigning}
                activeOpacity={0.7}
                accessibilityLabel="Clear speech and stop 3D signing"
              >
                <Ionicons name="close" size={16} color="#D32F2F" />
                <Text style={styles.clearSpeechButtonText}>Clear</Text>
              </TouchableOpacity>
            </View>

            {sequenceToPlay && sequenceToPlay.length > 0 && (
              <View style={styles.sequenceBadgesRow}>
                <Text style={styles.sequenceRowLabel}>Senyas:</Text>
                {sequenceToPlay.slice(0, 5).map((item, index) => (
                  <View key={index} style={styles.sequenceBadge}>
                    <Text style={styles.sequenceText}>
                      {item.display}
                    </Text>
                  </View>
                ))}
                {sequenceToPlay.length > 5 && (
                  <Text style={styles.moreText}>+{sequenceToPlay.length - 5}</Text>
                )}
              </View>
            )}
          </View>
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
    bottomWordCardContainer: {
        position: 'absolute',
        bottom: 12,
        left: 12,
        right: 12,
        alignItems: 'center',
        zIndex: 500,
        elevation: 20,
    },
    speechOverlayCard: {
        width: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: '#9575CD',
        paddingHorizontal: 14,
        paddingVertical: 10,
        shadowColor: '#512DA8',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 15,
    },
    speechMainRow: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
    },
    voiceIconBubble: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#7E57C2',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
        flexShrink: 0,
    },
    speechTextContainer: {
        flex: 1,
        justifyContent: 'center',
        marginRight: 8,
        flexShrink: 1,
    },
    speechLabelHeading: {
        color: '#7E57C2',
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        marginBottom: 1,
    },
    speechRecognizedWord: {
        color: '#1A0938',
        fontSize: 20,
        fontWeight: 'bold',
        letterSpacing: 0.3,
    },
    speechRecognizedWordLong: {
        fontSize: 15,
        lineHeight: 18,
    },
    clearSpeechButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFEBEE',
        borderWidth: 1.2,
        borderColor: '#FFCDD2',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 6,
        flexShrink: 0,
    },
    clearSpeechButtonText: {
        color: '#D32F2F',
        fontSize: 12,
        fontWeight: 'bold',
        marginLeft: 2,
    },
    sequenceBadgesRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 10,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#EDE7F6',
        gap: 6,
    },
    sequenceRowLabel: {
        color: '#9575CD',
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        marginRight: 4,
    },
    sequenceBadge: {
        backgroundColor: '#F3E5F5',
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#CE93D8',
    },
    sequenceText: {
        color: '#4A148C',
        fontSize: 12,
        fontWeight: '900',
        letterSpacing: 0.4,
    },
    moreText: {
        color: '#B0B0C8',
        fontSize: 11,
        fontWeight: '600',
        alignSelf: 'center',
        marginLeft: 4,
    },
});
