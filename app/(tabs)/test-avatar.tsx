import React, { useState } from 'react';
import { View, StyleSheet, Button, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AvatarViewer from '../../components/AvatarViewer';

export default function TestAvatar() {
  const [sign, setSign] = useState<string | null>(null);

  const testSign = () => {
    // Toggle between a test sign (e.g., 'A' or 'hello') and null
    setSign(prev => prev ? null : 'A'); 
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Avatar 3D Test</Text>
      </View>
      
      <View style={styles.avatarContainer}>
        <AvatarViewer
          style={styles.avatar}
          letterToPlay={sign}
          onVRMLoaded={() => console.log('Avatar loaded on test page')}
          onError={(e) => console.error('Avatar error on test page:', e)}
        />
      </View>
      
      <View style={styles.controls}>
        <Button 
            title={sign ? "Stop Test Animation" : "Test Animation (Letter A)"} 
            onPress={testSign} 
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    padding: 20,
    alignItems: 'center',
    marginTop: 40,
  },
  title: {
    fontSize: 24,
    color: '#00e5ff',
    fontWeight: 'bold',
  },
  avatarContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    margin: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
  },
  avatar: {
    flex: 1,
  },
  controls: {
    padding: 20,
    paddingBottom: 40,
    flexDirection: 'row',
    justifyContent: 'center',
  }
});
