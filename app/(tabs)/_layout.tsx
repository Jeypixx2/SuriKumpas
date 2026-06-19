import React, { useMemo } from 'react';
import { Tabs, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { AvatarProvider, useAvatarContext } from '../../lib/AvatarContext';
import AvatarViewer from '../../components/AvatarViewer';

function GlobalAvatar() {
  const segments = useSegments();
  const isTranslate = segments.includes('translate');
  const { 
    signToPlay, setSignToPlay,
    letterToPlay, setLetterToPlay,
    sequenceToPlay, setSequenceToPlay,
    isAvatarLoaded, setIsAvatarLoaded 
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

  return (
    <View style={[
      styles.avatarContainer,
      {
        top: isTranslate ? 0 : -9999,
        pointerEvents: isTranslate ? 'auto' : 'none',
      }
    ]}>
      <AvatarViewer
        style={styles.avatar}
        signToPlay={signToPlay}
        letterToPlay={letterToPlay}
        sequenceToPlay={sequenceToPlay}
        onVRMLoaded={() => setIsAvatarLoaded(true)}
        onError={(error) => console.error('Avatar error:', error)}
        active={isTranslate}
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
          <Text style={styles.loadingText}>Loading 3D Engine...</Text>
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
});
