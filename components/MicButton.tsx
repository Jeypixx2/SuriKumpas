import React, { useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface MicButtonProps {
    onPress?: () => void;
    isListening?: boolean;
    size?: number;
}

export default function MicButton({ onPress, isListening = false, size = 100 }: MicButtonProps) {
    const pulseAnim = new Animated.Value(1);
    const glowAnim = new Animated.Value(0);

    React.useEffect(() => {
        if (isListening) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.2,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();

            Animated.loop(
                Animated.sequence([
                    Animated.timing(glowAnim, {
                        toValue: 1,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                    Animated.timing(glowAnim, {
                        toValue: 0,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
            glowAnim.setValue(0);
        }
    }, [isListening]);

    const handlePress = useCallback(() => {
        onPress?.();
    }, [onPress]);

    const glowOpacity = glowAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.3, 0.8],
    });

    return (
        <View style={styles.container}>
            {isListening && (
                <Animated.View
                    style={[
                        styles.glow,
                        {
                            width: size * 2,
                            height: size * 2,
                            borderRadius: size,
                            opacity: glowOpacity,
                        },
                    ]}
                />
            )}
            <TouchableOpacity
                onPress={handlePress}
                activeOpacity={0.8}
                style={[
                    styles.button,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        backgroundColor: isListening ? '#00e5ff' : '#ffffff',
                    },
                ]}
            >
                <Animated.View
                    style={{
                        transform: [{ scale: pulseAnim }],
                    }}
                >
                    <MaterialIcons
                        name={isListening ? 'mic' : 'mic-none'}
                        size={size * 0.5}
                        color={isListening ? '#0a0a0a' : '#00e5ff'}
                    />
                </Animated.View>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    glow: {
        position: 'absolute',
        backgroundColor: '#00e5ff',
    },
    button: {
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#00e5ff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 10,
    },
});
