import { Tabs, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, StyleSheet } from 'react-native';
import { AvatarProvider, useAvatarContext } from '../../lib/AvatarContext';
import AvatarViewer from '../../components/AvatarViewer';

function GlobalAvatar() {
  const segments = useSegments();
  const isTranslate = segments[segments.length - 1] === 'translate';
  const { 
    signToPlay, setSignToPlay,
    letterToPlay, setLetterToPlay,
    sequenceToPlay, setSequenceToPlay,
    isAvatarLoaded, setIsAvatarLoaded 
  } = useAvatarContext();

  // If not on translate screen, hide the avatar perfectly.
  // It is rendered OUTSIDE Tabs so Expo GL won't destroy it when switching tabs!
  return (
    <View style={[
      styles.avatarContainer,
      {
        top: isTranslate ? 0 : -9999, // Do NOT use opacity: 0, it corrupts Android SurfaceView into a white block!
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
        onSequenceEnd={() => {
          setSequenceToPlay(null);
          setSignToPlay(null);
          setLetterToPlay(null);
        }}
      />

      <View style={styles.dotPatternBackground}>
         {Array.from({ length: 50 }).map((_, i) => (
             <View
                 key={i}
                 style={[
                     styles.bgDot,
                     {
                         // Using hardcoded pixel values from a typical 400x800 screen ratio
                         // width is around 380-400, height is around 800
                         left: (i % 10) * 40 + 20,
                         top: Math.floor(i / 10) * 80 + 50
                     }
                 ]}
             />
         ))}
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
      <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
        <Tabs 
          screenOptions={{ 
            headerShown: false, 
            tabBarStyle: { backgroundColor: '#0a0a0a', borderTopColor: '#222' }, 
            tabBarActiveTintColor: '#00e5ff', 
            lazy: false
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
        height: '45%', // Set to 45% (absolute screen) to perfectly sit above the 50% (Tab screen) cyan divider!
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
        backgroundColor: 'rgba(10, 10, 10, 0.8)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 5,
    },
    loadingText: {
        color: '#00e5ff',
        fontSize: 18,
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
        backgroundColor: 'rgba(0, 229, 255, 0.15)',
    },
});
