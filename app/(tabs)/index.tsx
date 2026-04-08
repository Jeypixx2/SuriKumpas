import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FSL_LABELS, FSLLabel } from '../../lib/labels';
import { useState, useMemo, useEffect, useRef } from 'react';
import LoadingScreen from '../../components/LoadingScreen';
import { SignClassifier } from '../../lib/SignClassifier';

const CATEGORIES = Array.from(new Set(FSL_LABELS.map(l => l.category)));

type LoadingStatus = 'pending' | 'loading' | 'complete' | 'error';

interface LoadingStep {
    label: string;
    status: LoadingStatus;
}

export default function HomeScreen() {
    const router = useRouter();
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [currentStep, setCurrentStep] = useState(0);
    const [steps, setSteps] = useState<LoadingStep[]>([
        { label: 'Loading FSL Model...', status: 'pending' },
        { label: 'Loading Alphabet Model...', status: 'pending' },
        { label: 'Loading Avatar...', status: 'pending' },
    ]);

    const classifierRef = useRef(new SignClassifier());

    useEffect(() => {
        const loadAll = async () => {
            try {
                updateStep(0, 'loading');
                await classifierRef.current.loadFSLModel();
                updateStep(0, 'complete');
                setCurrentStep(1);

                await new Promise(resolve => setTimeout(resolve, 300));

                updateStep(1, 'loading');
                await classifierRef.current.loadAlphabetModel();
                updateStep(1, 'complete');
                setCurrentStep(2);

                await new Promise(resolve => setTimeout(resolve, 300));

                updateStep(2, 'loading');
                await new Promise(resolve => setTimeout(resolve, 1500));
                updateStep(2, 'complete');

                await new Promise(resolve => setTimeout(resolve, 500));
                setIsLoading(false);
            } catch (error) {
                console.error('Loading error:', error);
                updateStep(currentStep, 'error');
            }
        };

        loadAll();
    }, []);

    const updateStep = (index: number, status: LoadingStatus) => {
        setSteps(prev => {
            const newSteps = [...prev];
            newSteps[index] = { ...newSteps[index], status };
            return newSteps;
        });
    };

    const filteredLabels = useMemo(() => {
        if (!selectedCategory) return FSL_LABELS;
        return FSL_LABELS.filter(l => l.category === selectedCategory);
    }, [selectedCategory]);

    const groupedLabels = useMemo(() => {
        const groups: Record<string, FSLLabel[]> = {};
        filteredLabels.forEach(label => {
            if (!groups[label.category]) groups[label.category] = [];
            groups[label.category].push(label);
        });
        return groups;
    }, [filteredLabels]);

    if (isLoading) {
        return (
            <View style={styles.container}>
                <LoadingScreen steps={steps} currentStep={currentStep} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <View style={styles.logoSmall}>
                    <Text style={styles.logoTextSmall}>S</Text>
                </View>
                <Text style={styles.title}>SuriKumpas</Text>
            </View>

            <Text style={styles.subtitle}>Filipino Sign Language Recognition</Text>

            <View style={styles.buttonContainer}>
                <TouchableOpacity
                    style={styles.detectButton}
                    onPress={() => router.push('/detect')}
                >
                    <MaterialIcons name="camera-alt" size={40} color="#0a0a0a" />
                    <Text style={styles.buttonText}>Detect Sign</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.translateButton}
                    onPress={() => router.push('/translate')}
                >
                    <MaterialIcons name="mic" size={40} color="#0a0a0a" />
                    <Text style={styles.buttonText}>Speech to Sign</Text>
                </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Categories</Text>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.categoryScroll}
                contentContainerStyle={styles.categoryContent}
            >
                <TouchableOpacity
                    style={[
                        styles.categoryChip,
                        selectedCategory === null && styles.categoryChipActive,
                    ]}
                    onPress={() => setSelectedCategory(null)}
                >
                    <Text style={[
                        styles.categoryText,
                        selectedCategory === null && styles.categoryTextActive,
                    ]}>ALL</Text>
                </TouchableOpacity>
                {CATEGORIES.map(cat => (
                    <TouchableOpacity
                        key={cat}
                        style={[
                            styles.categoryChip,
                            selectedCategory === cat && styles.categoryChipActive,
                        ]}
                        onPress={() => setSelectedCategory(cat)}
                    >
                        <Text style={[
                            styles.categoryText,
                            selectedCategory === cat && styles.categoryTextActive,
                        ]}>{cat}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            <ScrollView style={styles.labelsContainer}>
                {Object.entries(groupedLabels).map(([category, labels]) => (
                    <View key={category} style={styles.categorySection}>
                        <Text style={styles.categoryHeader}>{category}</Text>
                        {labels.map(label => (
                            <View key={label.id} style={styles.labelCard}>
                                <View style={styles.labelContent}>
                                    <Text style={styles.labelEnglish}>{label.english}</Text>
                                    <Text style={styles.labelFilipino}>{label.filipino}</Text>
                                </View>
                                <MaterialIcons name="sign-language" size={24} color="#00e5ff" />
                            </View>
                        ))}
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0a0a0a',
        paddingTop: 60,
        paddingHorizontal: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    logoSmall: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#00e5ff',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    logoTextSmall: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#0a0a0a',
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#ffffff',
    },
    subtitle: {
        fontSize: 14,
        color: '#888888',
        marginBottom: 30,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 30,
        gap: 15,
    },
    detectButton: {
        flex: 1,
        backgroundColor: '#00e5ff',
        borderRadius: 16,
        padding: 30,
        alignItems: 'center',
        shadowColor: '#00e5ff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 15,
        elevation: 5,
    },
    translateButton: {
        flex: 1,
        backgroundColor: '#00e5ff',
        borderRadius: 16,
        padding: 30,
        alignItems: 'center',
        shadowColor: '#00e5ff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 15,
        elevation: 5,
    },
    buttonText: {
        color: '#0a0a0a',
        fontSize: 16,
        fontWeight: 'bold',
        marginTop: 12,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#ffffff',
        marginBottom: 15,
    },
    categoryScroll: {
        maxHeight: 50,
        marginBottom: 20,
    },
    categoryContent: {
        gap: 10,
        paddingRight: 20,
    },
    categoryChip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    categoryChipActive: {
        backgroundColor: '#00e5ff',
        borderColor: '#00e5ff',
    },
    categoryText: {
        color: '#888888',
        fontSize: 12,
        fontWeight: '600',
    },
    categoryTextActive: {
        color: '#0a0a0a',
    },
    labelsContainer: {
        flex: 1,
    },
    categorySection: {
        marginBottom: 20,
    },
    categoryHeader: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#00e5ff',
        textTransform: 'uppercase',
        letterSpacing: 2,
        marginBottom: 10,
    },
    labelCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 8,
    },
    labelContent: {
        flex: 1,
    },
    labelEnglish: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    labelFilipino: {
        color: '#888888',
        fontSize: 14,
        marginTop: 2,
    },
});
