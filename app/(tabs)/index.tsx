import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Animated, Pressable, FlatList, InteractionManager } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { VISIBLE_FSL_LABELS, FSLLabel } from '../../lib/labels';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { globalAlphabetImageClassifier } from '../../lib/AlphabetImageClassifier';

const CATEGORIES = Array.from(new Set(VISIBLE_FSL_LABELS.map(l => l.category)));

type LabelListItem =
    | { type: 'header'; category: string }
    | { type: 'label'; category: string; label: FSLLabel };

const CATEGORY_COLORS: Record<string, string> = {
    GREETING:     '#5BC4B5',
    SURVIVAL:     '#FF8A65',
    NUMBER:       '#7986CB',
    CALENDAR:     '#BA68C8',
    DAYS:         '#4DB6AC',
    FAMILY:       '#F06292',
    RELATIONSHIPS:'#FF7043',
    COLOR:        '#A1887F',
    FOOD:         '#FFB300',
    DRINK:        '#26A69A',
};

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export default function HomeScreen() {
    const router = useRouter();
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    const detectScale = useRef(new Animated.Value(1)).current;
    const translateScale = useRef(new Animated.Value(1)).current;
    const listOpacity = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            InteractionManager.runAfterInteractions(() => {
                (async () => {
                    if (cancelled) return;
                    try {
                        await globalAlphabetImageClassifier.load();
                    } catch (error) {
                        console.warn('[Home] Background alphabet model preload failed:', error);
                    }
                    await wait(800);
                })();
            });
        }, 2500);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, []);

    const animateButtonPress = (scaleVar: Animated.Value, toValue: number) => {
        Animated.spring(scaleVar, {
            toValue,
            friction: 4,
            tension: 40,
            useNativeDriver: true,
        }).start();
    };

    const filteredLabels = useMemo(() => {
        if (!selectedCategory) return VISIBLE_FSL_LABELS;
        return VISIBLE_FSL_LABELS.filter(l => l.category === selectedCategory);
    }, [selectedCategory]);

    const groupedLabels = useMemo(() => {
        const groups: Record<string, FSLLabel[]> = {};
        filteredLabels.forEach(label => {
            if (!groups[label.category]) groups[label.category] = [];
            groups[label.category].push(label);
        });
        return groups;
    }, [filteredLabels]);

    const listData = useMemo<LabelListItem[]>(() => {
        const items: LabelListItem[] = [];
        Object.entries(groupedLabels).forEach(([category, labels]) => {
            items.push({ type: 'header', category });
            labels.forEach(label => items.push({ type: 'label', category, label }));
        });
        return items;
    }, [groupedLabels]);

    const renderLabelItem = useCallback(({ item }: { item: LabelListItem }) => {
        const accentColor = CATEGORY_COLORS[item.category] || '#5BC4B5';

        if (item.type === 'header') {
            return (
                <Text style={[styles.categoryHeader, { color: accentColor }]}>
                    {item.category}
                </Text>
            );
        }

        return (
            <View style={styles.labelCard}>
                <View style={[styles.cardIndicator, { backgroundColor: accentColor }]} />
                <View style={styles.labelContent}>
                    <Text style={styles.labelEnglish}>{item.label.english}</Text>
                    <Text style={styles.labelFilipino}>{item.label.filipino}</Text>
                </View>
                <View style={[styles.cardIconBox, { backgroundColor: accentColor + '22' }]}>
                    <MaterialIcons name="sign-language" size={20} color={accentColor} />
                </View>
            </View>
        );
    }, []);

    const keyExtractor = useCallback((item: LabelListItem) => {
        return item.type === 'header' ? `header-${item.category}` : `label-${item.label.id}`;
    }, []);

    return (
        <View style={styles.container}>
            <Animated.View style={[styles.contentWrapper, { opacity: listOpacity }]}>
                {/* Header Section */}
                <View style={styles.header}>
                    <View style={styles.logoRing}>
                        <MaterialIcons name="sign-language" size={26} color="#2B9C8E" />
                    </View>
                    <View>
                        <Text style={styles.title}>SuriKumpas</Text>
                        <View style={styles.platformBadge}>
                            <Text style={styles.platformBadgeText}>FSL TRANSLATION PLATFORM</Text>
                        </View>
                    </View>
                </View>

                {/* Subtitle */}
                <Text style={styles.subtitle}>
                    Empowering communication through advanced Filipino Sign Language Recognition
                </Text>

                {/* Main Action Buttons */}
                <View style={styles.buttonContainer}>
                    <Animated.View style={{ flex: 1, transform: [{ scale: detectScale }] }}>
                        <Pressable
                            onPressIn={() => animateButtonPress(detectScale, 0.95)}
                            onPressOut={() => animateButtonPress(detectScale, 1)}
                            onPress={() => router.push('/detect')}
                            style={styles.detectCard}
                        >
                            <View style={styles.iconCircleTeal}>
                                <MaterialIcons name="camera-alt" size={28} color="#2B9C8E" />
                            </View>
                            <Text style={styles.cardTitleTeal}>Detect Sign</Text>
                            <Text style={styles.cardDesc}>Translate your camera feed gestures to text</Text>
                        </Pressable>
                    </Animated.View>

                    <Animated.View style={{ flex: 1, transform: [{ scale: translateScale }] }}>
                        <Pressable
                            onPressIn={() => animateButtonPress(translateScale, 0.95)}
                            onPressOut={() => animateButtonPress(translateScale, 1)}
                            onPress={() => router.push('/translate')}
                            style={styles.translateCard}
                        >
                            <View style={styles.iconCircleLavender}>
                                <MaterialIcons name="mic" size={28} color="#7E57C2" />
                            </View>
                            <Text style={styles.cardTitleLavender}>Speech to Sign</Text>
                            <Text style={styles.cardDesc}>Translate your voice to 3D signing avatar</Text>
                        </Pressable>
                    </Animated.View>
                </View>

                {/* Categories Tab Selector */}
                <Text style={styles.sectionTitle}>Categories</Text>

                <View style={styles.scrollWrapper}>
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
                        {CATEGORIES.map(cat => {
                            const activeColor = CATEGORY_COLORS[cat] || '#5BC4B5';
                            const isActive = selectedCategory === cat;
                            return (
                                <TouchableOpacity
                                    key={cat}
                                    style={[
                                        styles.categoryChip,
                                        isActive && {
                                            backgroundColor: activeColor + '28',
                                            borderColor: activeColor,
                                        },
                                    ]}
                                    onPress={() => setSelectedCategory(cat)}
                                >
                                    <Text style={[
                                        styles.categoryText,
                                        isActive && { color: activeColor, fontWeight: 'bold' },
                                    ]}>{cat}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* Cards List */}
                <FlatList
                    data={listData}
                    renderItem={renderLabelItem}
                    keyExtractor={keyExtractor}
                    style={styles.labelsContainer}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.labelsContent}
                    initialNumToRender={12}
                    maxToRenderPerBatch={8}
                    updateCellsBatchingPeriod={50}
                    windowSize={7}
                    removeClippedSubviews
                />
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        backgroundColor: '#FFF9F5',
    },
    container: {
        flex: 1,
        backgroundColor: '#FFF9F5',
        paddingTop: 65,
        paddingHorizontal: 20,
    },
    contentWrapper: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    logoRing: {
        width: 44,
        height: 44,
        borderRadius: 24,
        borderWidth: 2,
        borderColor: '#A8E6CF',
        marginRight: 14,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
        backgroundColor: '#fff',
    },
    title: {
        fontSize: 26,
        fontWeight: '900',
        color: '#2D3561',
        letterSpacing: 0.3,
    },
    platformBadge: {
        backgroundColor: '#A8E6CF',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        marginTop: 3,
        alignSelf: 'flex-start',
    },
    platformBadgeText: {
        fontSize: 9,
        fontWeight: 'bold',
        color: '#2B9C8E',
        letterSpacing: 1,
    },
    subtitle: {
        fontSize: 13,
        color: '#7A7A9D',
        lineHeight: 19,
        marginBottom: 24,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 28,
        gap: 14,
        minHeight: 155,
    },
    detectCard: {
        flex: 1,
        backgroundColor: '#EDFAF7',
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: '#A8E6CF',
        padding: 18,
        minHeight: 155,
        justifyContent: 'space-between',
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 4,
    },
    translateCard: {
        flex: 1,
        backgroundColor: '#F0EDFB',
        borderRadius: 22,
        borderWidth: 1.5,
        borderColor: '#C9B8F0',
        padding: 18,
        minHeight: 155,
        justifyContent: 'space-between',
        shadowColor: '#9575CD',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 4,
    },
    iconCircleTeal: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#A8E6CF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconCircleLavender: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#C9B8F0',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardTitleTeal: {
        color: '#2B9C8E',
        fontSize: 17,
        fontWeight: '800',
        marginTop: 12,
    },
    cardTitleLavender: {
        color: '#5E35B1',
        fontSize: 17,
        fontWeight: '800',
        marginTop: 12,
    },
    cardDesc: {
        color: '#9090AA',
        fontSize: 11,
        marginTop: 5,
        lineHeight: 15,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#2D3561',
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        marginBottom: 12,
        marginTop: 10,
    },
    scrollWrapper: {
        marginBottom: 18,
        height: 40,
    },
    categoryScroll: {
        flex: 1,
    },
    categoryContent: {
        gap: 8,
        paddingRight: 20,
        alignItems: 'center',
    },
    categoryChip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#fff',
        borderWidth: 1.5,
        borderColor: '#E0E0F0',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 1,
    },
    categoryChipActive: {
        backgroundColor: '#A8E6CF28',
        borderColor: '#5BC4B5',
    },
    categoryText: {
        color: '#9090AA',
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.4,
    },
    categoryTextActive: {
        color: '#2B9C8E',
        fontWeight: 'bold',
    },
    labelsContainer: {
        flex: 1,
    },
    labelsContent: {
        paddingBottom: 30,
    },
    categorySection: {
        marginBottom: 20,
    },
    categoryHeader: {
        fontSize: 11,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 2,
        marginBottom: 10,
        marginTop: 8,
    },
    labelCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#EEE8FF',
        padding: 14,
        marginBottom: 8,
        position: 'relative',
        overflow: 'hidden',
        shadowColor: '#8080B0',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
        elevation: 2,
    },
    cardIndicator: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 4,
        borderRadius: 4,
    },
    labelContent: {
        flex: 1,
        marginLeft: 12,
    },
    labelEnglish: {
        color: '#2D3561',
        fontSize: 15,
        fontWeight: '700',
    },
    labelFilipino: {
        color: '#9090AA',
        fontSize: 13,
        marginTop: 2,
    },
    cardIconBox: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },
    errorRecoveryContainer: {
        position: 'absolute',
        bottom: 50,
        left: 30,
        right: 30,
        flexDirection: 'row',
        gap: 10,
    },
    retryButton: {
        flex: 1,
        backgroundColor: '#5BC4B5',
        padding: 15,
        borderRadius: 14,
        alignItems: 'center',
        shadowColor: '#5BC4B5',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4,
    },
    retryButtonText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 14,
    },
    proceedButton: {
        flex: 1,
        backgroundColor: '#fff',
        padding: 15,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#C9B8F0',
        alignItems: 'center',
    },
    proceedButtonText: {
        color: '#7E57C2',
        fontWeight: '600',
        fontSize: 14,
    },
});
