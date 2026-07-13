import React, { useRef, useEffect, useState } from 'react';
import { StyleSheet, View, Text, Animated } from 'react-native';
import { FSLLabel } from '../lib/labels';

interface ResultOverlayProps {
    label: FSLLabel | null;
    confidence: number;
    visible: boolean;
}

export default function ResultOverlay({ label, confidence, visible }: ResultOverlayProps) {
    const confidenceAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.85)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    const [renderLabel, setRenderLabel] = useState<FSLLabel | null>(null);

    useEffect(() => {
        if (visible && label) {
            setRenderLabel(label);
            
            Animated.spring(confidenceAnim, {
                toValue: confidence,
                useNativeDriver: false,
                friction: 8,
            }).start();

            Animated.parallel([
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    friction: 7,
                    tension: 60,
                    useNativeDriver: true,
                }),
                Animated.timing(opacityAnim, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(scaleAnim, {
                    toValue: 0.88,
                    duration: 180,
                    useNativeDriver: true,
                }),
                Animated.timing(opacityAnim, {
                    toValue: 0,
                    duration: 180,
                    useNativeDriver: true,
                }),
            ]).start(({ finished }) => {
                if (finished && !visible) {
                    setRenderLabel(null);
                    confidenceAnim.setValue(0);
                }
            });
        }
    }, [visible, label, confidence]);

    const barWidth = confidenceAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    });

    if (!renderLabel) {
        return null;
    }

    return (
        <Animated.View 
            style={[
                styles.container, 
                {
                    opacity: opacityAnim,
                    transform: [{ scale: scaleAnim }]
                }
            ]}
        >
            <View style={styles.content}>
                <Text style={styles.category}>{renderLabel.category}</Text>
                <Text style={styles.filipino}>{renderLabel.filipino}</Text>
                
                <View style={styles.confidenceContainer}>
                    <Animated.View
                        style={[
                            styles.confidenceBar,
                            { width: barWidth },
                        ]}
                    />
                </View>
                <Text style={styles.confidenceText}>
                    {Math.round(confidence * 100)}% confidence
                </Text>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '85%',
        backgroundColor: '#FFFFFF',
        borderRadius: 22,
        borderWidth: 2,
        borderColor: '#A8E6CF',
        padding: 24,
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 8,
        position: 'absolute',
        zIndex: 50,
    },
    content: {
        alignItems: 'center',
    },
    category: {
        color: '#2B9C8E',
        fontSize: 10,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 2,
        marginBottom: 8,
    },
    filipino: {
        color: '#2D3561',
        fontSize: 22,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 20,
    },
    confidenceContainer: {
        width: '100%',
        height: 8,
        backgroundColor: '#EDFAF7',
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 8,
    },
    confidenceBar: {
        height: '100%',
        backgroundColor: '#5BC4B5',
        borderRadius: 4,
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 5,
    },
    confidenceText: {
        color: '#9090AA',
        fontSize: 11,
        fontWeight: '700',
    },
});
