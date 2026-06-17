import React, { useCallback, useRef, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface MicButtonProps {
    onPress?: () => void;
    isListening?: boolean;
    size?: number;
}

export default function MicButton({ onPress, isListening = false, size = 100 }: MicButtonProps) {
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const ripple1 = useRef(new Animated.Value(0)).current;
    const ripple2 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        let pulseLoop: Animated.CompositeAnimation | null = null;
        let ripple1Loop: Animated.CompositeAnimation | null = null;
        let ripple2Loop: Animated.CompositeAnimation | null = null;

        if (isListening) {
            pulseLoop = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.12,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            );
            pulseLoop.start();

            ripple1.setValue(0);
            ripple1Loop = Animated.loop(
                Animated.timing(ripple1, {
                    toValue: 1,
                    duration: 2000,
                    useNativeDriver: true,
                })
            );
            ripple1Loop.start();

            ripple2.setValue(0);
            ripple2Loop = Animated.loop(
                Animated.sequence([
                    Animated.delay(1000),
                    Animated.timing(ripple2, {
                        toValue: 1,
                        duration: 2000,
                        useNativeDriver: true,
                    })
                ])
            );
            ripple2Loop.start();
        } else {
            pulseAnim.setValue(1);
            ripple1.setValue(0);
            ripple2.setValue(0);
        }

        return () => {
            pulseLoop?.stop();
            ripple1Loop?.stop();
            ripple2Loop?.stop();
        };
    }, [isListening]);

    const handlePress = useCallback(() => {
        onPress?.();
    }, [onPress]);

    const r1Scale = ripple1.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 2.0],
    });
    const r1Opacity = ripple1.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.5, 0.25, 0],
    });

    const r2Scale = ripple2.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 2.6],
    });
    const r2Opacity = ripple2.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.4, 0.18, 0],
    });

    return (
        <View style={styles.container}>
            {isListening && (
                <>
                    <Animated.View
                        style={[
                            styles.ripple,
                            {
                                width: size,
                                height: size,
                                borderRadius: size / 2,
                                transform: [{ scale: r1Scale }],
                                opacity: r1Opacity,
                            },
                        ]}
                    />
                    <Animated.View
                        style={[
                            styles.ripple,
                            {
                                width: size,
                                height: size,
                                borderRadius: size / 2,
                                transform: [{ scale: r2Scale }],
                                opacity: r2Opacity,
                            },
                        ]}
                    />
                </>
            )}

            <Animated.View
                style={[
                    styles.buttonShadow,
                    isListening && styles.buttonShadowActive,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        transform: [{ scale: pulseAnim }],
                    }
                ]}
            />

            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity
                    onPress={handlePress}
                    activeOpacity={0.85}
                    style={[
                        styles.button,
                        {
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            backgroundColor: isListening ? '#7E57C2' : '#FFFFFF',
                            borderColor: isListening ? '#7E57C2' : '#C9B8F0',
                            borderWidth: 2,
                        },
                    ]}
                >
                    <MaterialIcons
                        name={isListening ? 'mic' : 'mic-none'}
                        size={size * 0.44}
                        color={isListening ? '#ffffff' : '#7E57C2'} 
                    />
                </TouchableOpacity>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    ripple: {
        position: 'absolute',
        backgroundColor: '#C9B8F0',
        borderWidth: 1,
        borderColor: 'rgba(126, 87, 194, 0.5)',
    },
    buttonShadow: {
        position: 'absolute',
        backgroundColor: 'transparent',
    },
    buttonShadowActive: {
        backgroundColor: 'rgba(126, 87, 194, 0.2)',
        shadowColor: '#7E57C2',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 18,
        elevation: 8,
    },
    button: {
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#9575CD',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 5,
    },
});
