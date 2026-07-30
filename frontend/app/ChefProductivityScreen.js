import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Octicons } from '@expo/vector-icons';

import getEnvVars from '../config';
import { useAuth } from './context/AuthContext';

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';
const BG = '#fefce8';
const BORDER = '#e2ece2';
const TEXT = '#1a2e1a';
const TEXT_MID = '#4a7c59';
const TEXT_SOFT = '#8aab8a';

const TABS = [
    { key: 'prep', label: 'Prep', icon: 'checklist' },
    { key: 'timeline', label: 'Timeline', icon: 'clock' },
    { key: 'subs', label: 'Subs', icon: 'sync' },
    { key: 'plating', label: 'Plating', icon: 'star' },
];

const SUBSTITUTION_REASONS = ['Out of stock', 'Allergy', 'Dietary restriction', 'Preference'];

async function callAssistant({ token, bookingId, capability, body }) {
    const { apiUrl } = getEnvVars();
    const path = capability === 'subs'
        ? '/api/v1/chef-productivity/substitutions'
        : `/api/v1/chef-productivity/${bookingId}/${
            capability === 'prep' ? 'prep-list' : capability
        }`;
    const res = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body || {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Assistant request failed');
    return json;
}

// ── Prep List Card ──────────────────────────────────────────────
function PrepListCard({ data }) {
    const items = data?.prep_list?.prep_list || data?.prep_list || data?.items || [];
    if (!items.length) return null;
    const grouped = items.reduce((acc, item) => {
        const key = item.do_at || 'General';
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});

    return (
        <View>
            {Object.entries(grouped).map(([window, windowItems]) => (
                <View key={window} style={s.prepGroup}>
                    <Text style={s.prepWindow}>{window}</Text>
                    {windowItems.map((item, i) => (
                        <View key={i} style={s.prepItem}>
                            <View style={s.prepDot} />
                            <View style={{ flex: 1 }}>
                                <Text style={s.prepTask}>{item.task}</Text>
                                {item.duration_min && (
                                    <Text style={s.prepMeta}>{item.duration_min} min</Text>
                                )}
                            </View>
                        </View>
                    ))}
                </View>
            ))}
        </View>
    );
}

// ── Timeline Card ───────────────────────────────────────────────
function TimelineCard({ data }) {
    const steps = data?.timeline?.timeline || data?.timeline?.steps || data?.timeline || data?.steps || [];
    if (!steps.length) return null;
    return (
        <View style={{ paddingLeft: 8 }}>
            {steps.map((step, i) => (
                <View key={i} style={s.timelineStep}>
                    <View style={s.timelineRail}>
                        <View style={s.timelineDot} />
                        {i < steps.length - 1 && <View style={s.timelineLine} />}
                    </View>
                    <View style={s.timelineContent}>
                        <Text style={s.timelineTime}>{step.time_offset || step.time}</Text>
                        <Text style={s.timelineTask}>{step.task || step.action}</Text>
                        {step.note && <Text style={s.timelineNote}>{step.note}</Text>}
                    </View>
                </View>
            ))}
        </View>
    );
}

// ── Substitutions ───────────────────────────────────────────────
function SubstitutionLookup({ token, bookingId, loadingTab, setLoadingTab, data, setData }) {
    const [ingredient, setIngredient] = useState('');
    const [reason, setReason] = useState(SUBSTITUTION_REASONS[0]);
    const [showReasonPicker, setShowReasonPicker] = useState(false);

    const handleGenerate = async () => {
        if (!ingredient.trim()) return;
        setLoadingTab('subs');
        try {
            const result = await callAssistant({ token, bookingId, capability: 'subs', body: { ingredient, reason } });
            setData(prev => ({ ...prev, subs: result }));
        } catch (e) {
            Alert.alert('Error', e.message);
        } finally {
            setLoadingTab(null);
        }
    };

    return (
        <View>
            <Text style={s.fieldLabel}>Ingredient</Text>
            <TextInput
                value={ingredient}
                onChangeText={setIngredient}
                placeholder="e.g. heavy cream"
                placeholderTextColor={TEXT_SOFT}
                style={s.textInput}
            />
            <Text style={s.fieldLabel}>Reason</Text>
            <TouchableOpacity style={s.pickerBtn} onPress={() => setShowReasonPicker(!showReasonPicker)}>
                <Text style={s.pickerBtnText}>{reason}</Text>
                <Octicons name="chevron-down" size={16} color={TEXT_SOFT} />
            </TouchableOpacity>
            {showReasonPicker && (
                <View style={s.pickerDropdown}>
                    {SUBSTITUTION_REASONS.map(r => (
                        <TouchableOpacity key={r} style={s.pickerOption} onPress={() => { setReason(r); setShowReasonPicker(false); }}>
                            <Text style={[s.pickerOptionText, r === reason && { color: GREEN, fontWeight: '700' }]}>{r}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}
            <TouchableOpacity
                style={[s.generateBtn, (!ingredient.trim() || loadingTab === 'subs') && s.generateBtnDisabled]}
                onPress={handleGenerate}
                disabled={!ingredient.trim() || loadingTab === 'subs'}
                activeOpacity={0.85}
            >
                {loadingTab === 'subs'
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={s.generateBtnText}>Generate Substitutions</Text>
                }
            </TouchableOpacity>

            {(data?.subs?.substitutions || data?.subs?.data?.substitutions) && (
                <View style={{ marginTop: 16 }}>
                    {(data.subs.substitutions || data.subs.data?.substitutions || []).map((sub, i) => (
                        <View key={i} style={s.subCard}>
                            <View style={s.subRank}><Text style={s.subRankText}>{i + 1}</Text></View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.subName}>{sub.substitute}</Text>
                                {sub.notes && <Text style={s.subNote}>{sub.notes}</Text>}
                                {sub.ratio && <Text style={s.subMeta}>Ratio: {sub.ratio}</Text>}
                            </View>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

// ── Plating Card ────────────────────────────────────────────────
function PlatingCard({ data }) {
    const dishes = data?.plating?.plating || data?.plating || [];
    if (!dishes.length) return null;
    return (
        <View>
            {dishes.map((dish, i) => (
                <View key={i} style={s.platingDish}>
                    <Text style={s.platingDishName}>{dish.dish_name}</Text>
                    {dish.instructions && <Text style={s.platingInstructions}>{dish.instructions}</Text>}
                    {(dish.garnishes || dish.garnish || []).length > 0 && (
                        <View style={s.garnishRow}>
                            {(dish.garnishes || dish.garnish || []).map((g, j) => (
                                <View key={j} style={s.garnishChip}>
                                    <Text style={s.garnishText}>{g}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                </View>
            ))}
        </View>
    );
}

// ── Skeleton ────────────────────────────────────────────────────
function SkeletonCard() {
    return (
        <View>
            {[1, 2, 3].map(i => (
                <View key={i} style={[s.skeletonLine, { width: i === 2 ? '70%' : '100%', marginBottom: 12 }]} />
            ))}
        </View>
    );
}

// ── Main Screen ─────────────────────────────────────────────────
export default function ChefProductivityScreen() {
    const { bookingId, bookingDate, bookingTime, guestCount, customerName } = useLocalSearchParams();
    const { token, userType } = useAuth();
    const router = useRouter();

    const [tab, setTab] = useState('prep');
    const [data, setData] = useState({});
    const [loadingTab, setLoadingTab] = useState(null);
    const [hydrating, setHydrating] = useState(true);

    useEffect(() => {
        const hydrate = async () => {
            if (!bookingId) return;
            const { apiUrl } = getEnvVars();
            try {
                const res = await fetch(`${apiUrl}/api/v1/chef-productivity/${bookingId}/sessions`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const json = await res.json();
                    if (json.sessions) setData(json.sessions);
                }
            } catch (e) {} finally { setHydrating(false); }
        };
        hydrate();
    }, [bookingId]);

    const handleGenerate = async (capability) => {
        setLoadingTab(capability);
        try {
            const result = await callAssistant({ token, bookingId, capability, body: {} });
            setData(prev => ({ ...prev, [capability]: result.data || result }));
        } catch (e) {
            if (e.message?.includes('403')) {
                Alert.alert('Access Denied', "This booking isn't yours.");
            } else {
                Alert.alert('Error', e.message);
            }
        } finally {
            setLoadingTab(null);
        }
    };

    const handleRegenerate = (capability) => {
        Alert.alert('Regenerate', 'This will make a new AI request. Continue?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Regenerate', onPress: () => handleGenerate(capability) },
        ]);
    };

    const renderTabContent = () => {
        if (tab === 'subs') {
            return (
                <SubstitutionLookup
                    token={token} bookingId={bookingId}
                    loadingTab={loadingTab} setLoadingTab={setLoadingTab}
                    data={data} setData={setData}
                />
            );
        }

        if (loadingTab === tab) return <SkeletonCard />;

        if (!data[tab]) {
            return (
                <View style={s.emptyState}>
                    <Octicons name="robot" size={48} color={GREEN_LIGHT} />
                    <Text style={s.emptyTitle}>Tap Generate to ask the assistant</Text>
                    <Text style={s.emptySubtitle}>The AI will analyze this booking and provide recommendations.</Text>
                    <TouchableOpacity style={s.generateBtn} onPress={() => handleGenerate(tab)} activeOpacity={0.85}>
                        <Octicons name="sparkle-fill" size={16} color="#fff" style={{ marginRight: 8 }} />
                        <Text style={s.generateBtnText}>Generate</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return (
            <View>
                {tab === 'prep' && <PrepListCard data={data.prep} />}
                {tab === 'timeline' && <TimelineCard data={data.timeline} />}
                {tab === 'plating' && <PlatingCard data={data.plating} />}
                <TouchableOpacity style={s.regenBtn} onPress={() => handleRegenerate(tab)} activeOpacity={0.8}>
                    <Octicons name="sync" size={14} color={GREEN} style={{ marginRight: 6 }} />
                    <Text style={s.regenBtnText}>Regenerate</Text>
                </TouchableOpacity>
            </View>
        );
    };

    return (
        <>
            <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: BG } }} />
            {/* ✅ FIX: removed paddingTop: insets.top — _layout.js SafeAreaView handles it */}
            <View style={s.screen}>
                {/* Header */}
                <View style={s.header}>
                    <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
                        <Octicons name="chevron-left" size={22} color={GREEN} />
                    </TouchableOpacity>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={s.headerTitle}>Kitchen Assistant</Text>
                        {bookingDate && (
                            <Text style={s.headerSub}>
                                {bookingDate}{bookingTime ? ` • ${bookingTime}` : ''}{guestCount ? ` • ${guestCount} guests` : ''}
                            </Text>
                        )}
                    </View>
                </View>

                {/* Tabs */}
                <View style={s.tabRow}>
                    {TABS.map(t => (
                        <TouchableOpacity
                            key={t.key}
                            style={[s.tabPill, tab === t.key && s.tabPillActive]}
                            onPress={() => setTab(t.key)}
                            activeOpacity={0.8}
                        >
                            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Content */}
                <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
                    {hydrating ? <SkeletonCard /> : renderTabContent()}
                    <View style={{ height: 40 }} />
                </ScrollView>
            </View>
        </>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: BG },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    backBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },
    headerSub: { fontSize: 12, color: TEXT_SOFT, marginTop: 2 },
    tabRow: {
        flexDirection: 'row', gap: 8, paddingHorizontal: 16,
        paddingVertical: 12, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    tabPill: {
        flex: 1, paddingVertical: 8, borderRadius: 20,
        alignItems: 'center', backgroundColor: '#f0f7f0',
        borderWidth: 1, borderColor: BORDER,
    },
    tabPillActive: { backgroundColor: GREEN, borderColor: GREEN },
    tabLabel: { fontSize: 13, fontWeight: '600', color: TEXT_MID },
    tabLabelActive: { color: '#fff' },
    content: { padding: 16 },
    emptyState: { alignItems: 'center', paddingVertical: 40 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: TEXT, marginTop: 16, textAlign: 'center' },
    emptySubtitle: { fontSize: 13, color: TEXT_SOFT, marginTop: 6, textAlign: 'center', lineHeight: 18 },
    generateBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        backgroundColor: GREEN, paddingVertical: 13, paddingHorizontal: 24,
        borderRadius: 12, marginTop: 20,
        shadowColor: GREEN, shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2, shadowRadius: 6, elevation: 3,
    },
    generateBtnDisabled: { backgroundColor: '#c8ddd0' },
    generateBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    regenBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        marginTop: 20, paddingVertical: 10, borderRadius: 10,
        borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff',
    },
    regenBtnText: { fontSize: 13, fontWeight: '600', color: TEXT_MID },
    skeletonLine: { height: 14, borderRadius: 7, backgroundColor: '#e8f0e8' },
    // Prep
    prepGroup: { marginBottom: 20 },
    prepWindow: {
        fontSize: 12, fontWeight: '700', color: GREEN,
        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
    },
    prepItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
    prepDot: {
        width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN_LIGHT,
        borderWidth: 1.5, borderColor: GREEN, marginTop: 5, marginRight: 10,
    },
    prepTask: { fontSize: 14, color: TEXT, lineHeight: 20 },
    prepMeta: { fontSize: 12, color: TEXT_SOFT, marginTop: 2 },
    // Timeline
    timelineStep: { flexDirection: 'row', marginBottom: 0 },
    timelineRail: { alignItems: 'center', width: 24, marginRight: 12 },
    timelineDot: {
        width: 12, height: 12, borderRadius: 6,
        backgroundColor: GREEN, borderWidth: 2, borderColor: GREEN_LIGHT,
    },
    timelineLine: { flex: 1, width: 2, backgroundColor: GREEN_LIGHT, marginTop: 2 },
    timelineContent: { flex: 1, paddingBottom: 20 },
    timelineTime: { fontSize: 12, fontWeight: '700', color: GREEN, marginBottom: 2 },
    timelineTask: { fontSize: 14, color: TEXT, lineHeight: 20 },
    timelineNote: { fontSize: 12, color: TEXT_SOFT, marginTop: 3 },
    // Substitutions
    fieldLabel: {
        fontSize: 12, fontWeight: '700', color: TEXT_MID,
        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 12,
    },
    textInput: {
        backgroundColor: '#fff', borderWidth: 1.5, borderColor: BORDER,
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
        fontSize: 15, color: TEXT,
    },
    pickerBtn: {
        backgroundColor: '#fff', borderWidth: 1.5, borderColor: BORDER,
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    pickerBtnText: { fontSize: 15, color: TEXT },
    pickerDropdown: {
        backgroundColor: '#fff', borderWidth: 1, borderColor: BORDER,
        borderRadius: 12, marginTop: 4, overflow: 'hidden',
    },
    pickerOption: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f5f0' },
    pickerOptionText: { fontSize: 14, color: TEXT_MID },
    subCard: {
        flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fff',
        borderRadius: 12, borderWidth: 1, borderColor: BORDER,
        padding: 12, marginBottom: 8,
    },
    subRank: {
        width: 28, height: 28, borderRadius: 14, backgroundColor: GREEN_LIGHT,
        alignItems: 'center', justifyContent: 'center', marginRight: 10,
    },
    subRankText: { fontSize: 13, fontWeight: '700', color: GREEN },
    subName: { fontSize: 14, fontWeight: '700', color: TEXT },
    subNote: { fontSize: 13, color: TEXT_MID, marginTop: 2 },
    subMeta: { fontSize: 12, color: TEXT_SOFT, marginTop: 2 },
    // Plating
    platingDish: {
        backgroundColor: '#fff', borderRadius: 12, borderWidth: 1,
        borderColor: BORDER, padding: 14, marginBottom: 10,
    },
    platingDishName: { fontSize: 15, fontWeight: '700', color: TEXT, marginBottom: 6 },
    platingInstructions: { fontSize: 13, color: TEXT_MID, lineHeight: 20 },
    garnishRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    garnishChip: {
        backgroundColor: GREEN_LIGHT, paddingHorizontal: 12,
        paddingVertical: 5, borderRadius: 20,
    },
    garnishText: { fontSize: 12, fontWeight: '600', color: GREEN },
});