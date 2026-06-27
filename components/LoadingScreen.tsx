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

    // Pulse animation for logo glow
    const logoGlow = useRef(new Animated.Value(0.4)).current;

    const slides = [
        { type: 'text', title: 'HOW TO USE' },
        { type: 'image', source: require('../assets/home.jpg'), title: 'Home Dashboard' },
        { type: 'image', source: require('../assets/detect.jpg'), title: 'Sign Detection' },
        { type: 'image', source: require('../assets/translate.jpg'), title: 'Speech to Sign' },
    ];

    useEffect(() => {
        // Loop the logo ambient pulse
        Animated.loop(
            Animated.sequence([
                Animated.timing(logoGlow, {
                    toValue: 0.9,
                    duration: 1200,
                    useNativeDriver: true,
                }),
                Animated.timing(logoGlow, {
                    toValue: 0.4,
                    duration: 1200,
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, []);

    useEffect(() => {
        const timer = setInterval(() => {
            setActiveSlide((prev) => (prev + 1) % slides.length);
        }, 3000);

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
                return <Text style={styles.completeIcon}>OK</Text>;
            case 'error':
                return <Text style={styles.errorIcon}>!</Text>;
            case 'loading':
                return <ActivityIndicator size="small" color="#5BC4B5" />;
            default:
                return <Text style={styles.pendingIcon}>o</Text>;
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
            {/* Logo and Brand */}
            <View style={styles.logoContainer}>
                {/* Glowing ring behind the logo */}
                <Animated.View style={[styles.glowRing, { opacity: logoGlow }]} />
                <View style={styles.logoBorder}>
                    <Image source={require('../assets/adaptive-icon.png')} style={styles.logo} resizeMode="contain" />
                </View>
                <Text style={styles.appName}>{appName}</Text>
                <View style={styles.taglinePill}>
                    <Text style={styles.tagline}>FILIPINO SIGN LANGUAGE TRANSLATION</Text>
                </View>
            </View>

            {/* Glassmorphic Slideshow instructions */}
            <View style={styles.sliderWrapper}>
                <Animated.View style={[styles.sliderContent, { transform: [{ translateX: scrollX }] }]}>
                    {slides.map((slide, index) => (
                        <View key={index} style={styles.slide}>
                            {slide.type === 'text' ? (
                                <View style={styles.instructionsContainer}>
                                    <Text style={styles.instructionTitle}>{slide.title}</Text>
                                    <View style={styles.instructionItem}>
                                        <View style={styles.bulletDot} />
                                        <Text style={styles.instructionText}>Sign to Text: Point camera at your hands to translate gestures.</Text>
                                    </View>
                                    <View style={styles.instructionItem}>
                                        <View style={styles.bulletDot} />
                                        <Text style={styles.instructionText}>Speech to Sign: Tap Mic and speak to translate voice to 3D signing.</Text>
                                    </View>
                                    <View style={styles.instructionItem}>
                                        <View style={styles.bulletDot} />
                                        <Text style={styles.instructionText}>Stability: Put device on a flat surface for optimal capture.</Text>
                                    </View>
                                </View>
                            ) : (
                                <View style={styles.imageSlideContainer}>
                                    <Image source={slide.source} style={styles.slideImage} resizeMode="cover" />
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

            {/* List of loading steps */}
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

            {/* Bottom Progress Bar */}
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
                    STEP {Math.min(currentStep + 1, steps.length)} OF {steps.length}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFF9F5',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 30,
        paddingTop: 50,
        paddingBottom: 40,
    },
    logoContainer: {
        alignItems: 'center',
        marginBottom: 32,
        position: 'relative',
    },
    glowRing: {
        position: 'absolute',
        top: 0,
        width: 108,
        height: 108,
        borderRadius: 54,
        backgroundColor: 'rgba(168, 230, 207, 0.5)',
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 20,
        elevation: 8,
    },
    logoBorder: {
        width: 104,
        height: 104,
        borderRadius: 52,
        padding: 3,
        borderWidth: 2,
        borderColor: '#A8E6CF',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fff',
        marginBottom: 16,
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 6,
    },
    logo: {
        width: 90,
        height: 90,
        borderRadius: 45,
    },
    appName: {
        fontSize: 30,
        fontWeight: '900',
        color: '#2D3561',
        letterSpacing: 0.3,
    },
    taglinePill: {
        backgroundColor: '#A8E6CF',
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 5,
        marginTop: 8,
    },
    tagline: {
        fontSize: 9,
        fontWeight: 'bold',
        color: '#2B9C8E',
        letterSpacing: 1.5,
        textAlign: 'center',
    },
    sliderWrapper: {
        width: SLIDE_WIDTH,
        height: 200,
        overflow: 'hidden',
        marginBottom: 32,
        borderRadius: 22,
        backgroundColor: '#FFFFFF',
        borderWidth: 1.5,
        borderColor: '#EEE8FF',
        shadowColor: '#8080B0',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 4,
    },
    sliderContent: {
        flexDirection: 'row',
        width: SLIDE_WIDTH * 4,
    },
    slide: {
        width: SLIDE_WIDTH,
        height: 200,
        justifyContent: 'center',
    },
    imageSlideContainer: {
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundColor: '#F5F0FF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    slideImage: {
        width: '100%',
        height: '100%',
    },
    imageOverlay: {
        position: 'absolute',
        bottom: 12,
        left: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.88)',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#C9B8F0',
    },
    imageTitle: {
        color: '#5E35B1',
        fontSize: 10,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    pagination: {
        position: 'absolute',
        bottom: 12,
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
        backgroundColor: 'rgba(126, 87, 194, 0.2)',
    },
    dotActive: {
        backgroundColor: '#7E57C2',
        width: 14,
        borderRadius: 3,
    },
    instructionsContainer: {
        paddingHorizontal: 20,
        paddingVertical: 15,
        justifyContent: 'center',
    },
    instructionTitle: {
        color: '#5BC4B5',
        fontSize: 13,
        fontWeight: '900',
        letterSpacing: 1.5,
        marginBottom: 12,
    },
    instructionItem: {
        flexDirection: 'row',
        marginBottom: 8,
        alignItems: 'center',
    },
    bulletDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#A8E6CF',
        marginRight: 10,
    },
    instructionText: {
        color: '#7A7A9D',
        fontSize: 12,
        lineHeight: 18,
        flex: 1,
    },
    stepsContainer: {
        width: '100%',
        marginBottom: 32,
    },
    step: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 14,
        marginBottom: 8,
        borderWidth: 1.5,
        borderColor: 'transparent',
    },
    stepPending: {
        backgroundColor: 'transparent',
    },
    stepLoading: {
        backgroundColor: '#EDFAF7',
        borderColor: '#A8E6CF',
    },
    stepComplete: {
        backgroundColor: '#F5FFF9',
        borderColor: '#C8F0D8',
    },
    stepError: {
        backgroundColor: '#FFF0F0',
        borderColor: '#FFCCCC',
    },
    stepIcon: {
        width: 22,
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    pendingIcon: {
        color: '#C0C0D8',
        fontSize: 14,
    },
    completeIcon: {
        color: '#5BC4B5',
        fontSize: 15,
        fontWeight: 'bold',
    },
    errorIcon: {
        color: '#E57373',
        fontSize: 15,
        fontWeight: 'bold',
    },
    stepLabel: {
        fontSize: 13,
        color: '#B0B0C8',
        fontWeight: '500',
    },
    stepLabelActive: {
        color: '#2B9C8E',
        fontWeight: 'bold',
    },
    stepLabelComplete: {
        color: '#2D3561',
        fontWeight: '600',
    },
    progressContainer: {
        width: '100%',
    },
    progressBar: {
        height: 7,
        backgroundColor: '#EEE8FF',
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 10,
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#5BC4B5',
        borderRadius: 4,
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 6,
    },
    progressText: {
        color: '#B0B0C8',
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: 1,
        textAlign: 'center',
    },
});
