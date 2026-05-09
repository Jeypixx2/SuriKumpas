import React from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Image } from 'react-native';

interface LoadingStep {
    label: string;
    status: 'pending' | 'loading' | 'complete' | 'error';
}

interface LoadingScreenProps {
    steps: LoadingStep[];
    currentStep: number;
    appName?: string;
}

export default function LoadingScreen({ steps, currentStep, appName = 'SuriKumpas' }: LoadingScreenProps) {
    const getStepIcon = (status: LoadingStep['status']) => {
        switch (status) {
            case 'complete':
                return <Text style={styles.completeIcon}>✓</Text>;
            case 'error':
                return <Text style={styles.errorIcon}>✗</Text>;
            case 'loading':
                return <ActivityIndicator size="small" color="#00e5ff" />;
            default:
                return <Text style={styles.pendingIcon}>○</Text>;
        }
    };

    const getStepStyle = (status: LoadingStep['status']) => {
        switch (status) {
            case 'complete':
                return styles.stepComplete;
            case 'error':
                return styles.stepError;
            case 'loading':
                return styles.stepLoading;
            default:
                return styles.stepPending;
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.logoContainer}>
                <Image source={require('../assets/adaptive-icon.png')} style={styles.logo} resizeMode="contain" />
                <Text style={styles.appName}>{appName}</Text>
                <Text style={styles.tagline}>Filipino Sign Language Recognition</Text>
            </View>

            <View style={styles.instructionsContainer}>
                <Text style={styles.instructionTitle}>How to use:</Text>
                <View style={styles.instructionItem}>
                    <Text style={styles.instructionBullet}>•</Text>
                    <Text style={styles.instructionText}>Sign to Text: Ensure your upper body and hands are visible to the camera.</Text>
                </View>
                <View style={styles.instructionItem}>
                    <Text style={styles.instructionBullet}>•</Text>
                    <Text style={styles.instructionText}>Speech to Sign: Press the microphone button and speak to see the 3D avatar translate.</Text>
                </View>
                <View style={styles.instructionItem}>
                    <Text style={styles.instructionBullet}>•</Text>
                    <Text style={styles.instructionText}>Positioning: Place your phone on a stable surface for the best experience.</Text>
                </View>
            </View>

            <View style={styles.stepsContainer}>
                {steps.map((step, index) => (
                    <View
                        key={index}
                        style={[
                            styles.step,
                            getStepStyle(step.status),
                        ]}
                    >
                        <View style={styles.stepIcon}>
                            {getStepIcon(step.status)}
                        </View>
                        <Text style={[
                            styles.stepLabel,
                            step.status === 'loading' && styles.stepLabelActive,
                            step.status === 'complete' && styles.stepLabelComplete,
                        ]}>
                            {step.label}
                        </Text>
                    </View>
                ))}
            </View>

            <View style={styles.progressContainer}>
                <View style={styles.progressBar}>
                    <View
                        style={[
                            styles.progressFill,
                            { width: `${((currentStep + 1) / steps.length) * 100}%` },
                        ]}
                    />
                </View>
                <Text style={styles.progressText}>
                    Step {Math.min(currentStep + 1, steps.length)} of {steps.length}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0a',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 30,
    },
    logoContainer: {
        alignItems: 'center',
        marginBottom: 30,
    },
    logo: {
        width: 120,
        height: 120,
        marginBottom: 20,
        borderRadius: 60,
        overflow: 'hidden',
    },
    appName: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#ffffff',
        marginBottom: 8,
    },
    tagline: {
        fontSize: 14,
        color: '#888888',
        textAlign: 'center',
    },
    instructionsContainer: {
        width: '100%',
        backgroundColor: 'rgba(0, 229, 255, 0.05)',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(0, 229, 255, 0.2)',
        marginBottom: 30,
    },
    instructionTitle: {
        color: '#00e5ff',
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    instructionItem: {
        flexDirection: 'row',
        marginBottom: 6,
        alignItems: 'flex-start',
    },
    instructionBullet: {
        color: '#00e5ff',
        fontSize: 16,
        marginRight: 8,
        fontWeight: 'bold',
        lineHeight: 20,
    },
    instructionText: {
        color: '#cccccc',
        fontSize: 14,
        lineHeight: 20,
        flex: 1,
    },
    stepsContainer: {
        width: '100%',
        marginBottom: 40,
    },
    step: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        marginBottom: 8,
    },
    stepPending: {
        backgroundColor: 'transparent',
    },
    stepLoading: {
        backgroundColor: 'rgba(0, 229, 255, 0.1)',
        borderWidth: 1,
        borderColor: '#00e5ff',
    },
    stepComplete: {
        backgroundColor: 'rgba(0, 229, 255, 0.05)',
    },
    stepError: {
        backgroundColor: 'rgba(255, 0, 0, 0.1)',
        borderWidth: 1,
        borderColor: '#ff0000',
    },
    stepIcon: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    pendingIcon: {
        color: '#555555',
        fontSize: 16,
    },
    completeIcon: {
        color: '#00e5ff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    errorIcon: {
        color: '#ff0000',
        fontSize: 18,
        fontWeight: 'bold',
    },
    stepLabel: {
        fontSize: 14,
        color: '#666666',
    },
    stepLabelActive: {
        color: '#00e5ff',
        fontWeight: '600',
    },
    stepLabelComplete: {
        color: '#ffffff',
    },
    progressContainer: {
        width: '100%',
    },
    progressBar: {
        height: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 12,
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#00e5ff',
        shadowColor: '#00e5ff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 5,
    },
    progressText: {
        color: '#888888',
        fontSize: 12,
        textAlign: 'center',
    },
});
