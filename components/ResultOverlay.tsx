import React from 'react';
import { StyleSheet, View, Text, Animated } from 'react-native';
import { FSLLabel } from '../lib/labels';

interface ResultOverlayProps {
    label: FSLLabel | null;
    confidence: number;
    visible: boolean;
}

export default function ResultOverlay({ label, confidence, visible }: ResultOverlayProps) {
    const animatedValue = new Animated.Value(confidence);

    React.useEffect(() => {
        Animated.spring(animatedValue, {
            toValue: confidence,
            useNativeDriver: false,
            friction: 8,
        }).start();
    }, [confidence]);

    const barWidth = animatedValue.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    });

    if (!visible || !label) {
        return null;
    }

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <Text style={styles.category}>{label.category}</Text>
                <Text style={styles.english}>{label.english}</Text>
                <Text style={styles.filipino}>{label.filipino}</Text>
                
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '85%',
        backgroundColor: 'rgba(10, 10, 10, 0.9)',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#00e5ff',
        padding: 20,
        shadowColor: '#00e5ff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 15,
        elevation: 10,
    },
    content: {
        alignItems: 'center',
    },
    category: {
        color: '#00e5ff',
        fontSize: 12,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 2,
        marginBottom: 8,
    },
    english: {
        color: '#ffffff',
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 4,
    },
    filipino: {
        color: '#aaaaaa',
        fontSize: 18,
        textAlign: 'center',
        marginBottom: 16,
    },
    confidenceContainer: {
        width: '100%',
        height: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 8,
    },
    confidenceBar: {
        height: '100%',
        backgroundColor: '#00e5ff',
        shadowColor: '#00e5ff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 5,
    },
    confidenceText: {
        color: '#888888',
        fontSize: 12,
    },
});
