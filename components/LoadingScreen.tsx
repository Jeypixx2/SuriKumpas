import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Image, Animated, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');
const SLIDE_WIDTH = width - 60; // 30 padding on each side

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
    const [activeSlide, setActiveSlide] = useState(0);
    const scrollX = useRef(new Animated.Value(0)).current;

    const slides = [
        { type: 'text', title: 'How to use:' },
        { type: 'image', source: require('../assets/home.jpg'), title: 'Home Dashboard' },
        { type: 'image', source: require('../assets/detect.jpg'), title: 'Sign Detection' },
        { type: 'image', source: require('../assets/translate.jpg'), title: 'Speech to Sign' },
    ];

    useEffect(() => {
        const timer = setInterval(() => {
            setActiveSlide((prev) => (prev + 1) % slides.length);
        }, 2500);

        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        Animated.spring(scrollX, {
            toValue: -activeSlide * SLIDE_WIDTH,
            useNativeDriver: true,
            friction: 8,
            tension: 40
        }).start();
    }, [activeSlide]);

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

            <View style={styles.sliderWrapper}>
                <Animated.View style={[styles.sliderContent, { transform: [{ translateX: scrollX }] }]}>
                    {slides.map((slide, index) => (
                        <View key={index} style={styles.slide}>
                            {slide.type === 'text' ? (
                                <View style={styles.instructionsContainer}>
                                    <Text style={styles.instructionTitle}>{slide.title}</Text>
                                    <View style={styles.instructionItem}>
                                        <Text style={styles.instructionBullet}>•</Text>
                                        <Text style={styles.instructionText}>Sign to Text: Ensure hands are visible to the camera.</Text>
                                    </View>
                                    <View style={styles.instructionItem}>
                                        <Text style={styles.instructionBullet}>•</Text>
                                        <Text style={styles.instructionText}>Speech to Sign: Press Mic and speak to translate.</Text>
                                    </View>
                                    <View style={styles.instructionItem}>
                                        <Text style={styles.instructionBullet}>•</Text>
                                        <Text style={styles.instructionText}>Positioning: Use a stable surface for best results.</Text>
                                    </View>
                                </View>
                            ) : (
                                <View style={styles.imageSlideContainer}>
                                    <Image source={slide.source} style={styles.slideImage} resizeMode="contain" />
                                    <View style={styles.imageOverlay}>
                                        <Text style={styles.imageTitle}>{slide.title}</Text>
                                    </View>
                                </View>
                            )}
                        </View>
                    ))}
                </Animated.View>
                
                <View style={styles.pagination}>
                    {slides.map((_, i) => (
                        <View key={i} style={[styles.dot, activeSlide === i && styles.dotActive]} />
                    ))}
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
    sliderWrapper: {
        width: SLIDE_WIDTH,
        height: 280,
        overflow: 'hidden',
        marginBottom: 30,
        borderRadius: 16,
        backgroundColor: '#000',
        borderWidth: 2,
        borderColor: 'rgba(0, 229, 255, 0.3)',
    },
    sliderContent: {
        flexDirection: 'row',
        width: SLIDE_WIDTH * 4,
    },
    slide: {
        width: SLIDE_WIDTH,
        height: 280,
        justifyContent: 'center',
    },
    imageSlideContainer: {
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    slideImage: {
        width: '100%',
        height: '100%',
    },
    imageOverlay: {
        position: 'absolute',
        top: 10,
        right: 10,
        backgroundColor: 'rgba(0, 229, 255, 0.2)',
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(0, 229, 255, 0.5)',
    },
    imageTitle: {
        color: '#00e5ff',
        fontSize: 11,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    pagination: {
        position: 'absolute',
        bottom: 10,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
    },
    dotActive: {
        backgroundColor: '#00e5ff',
        width: 12,
    },
    instructionsContainer: {
        padding: 16,
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
