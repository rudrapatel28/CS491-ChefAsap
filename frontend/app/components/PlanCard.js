import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
import Octicons from '@expo/vector-icons/Octicons';
import ChefSuggestionCard from './ChefSuggestionCard';

function formatPlanForShare(plan) {
    const { menu = [], ingredients = [], estimated_cost, chefs = [], notes } = plan;
    const totalCost = estimated_cost?.total ?? estimated_cost?.amount ?? estimated_cost;
    const lines = ['My ChefASAP Event Plan', ''];

    if (menu.length > 0) {
        lines.push('MENU');
        menu.forEach(course => {
            lines.push(`${course.course ?? course.name ?? course}:`);
            (course.dishes || []).forEach(dish => {
                lines.push(`  - ${dish.name ?? dish}`);
            });
        });
        lines.push('');
    }

    if (ingredients.length > 0) {
        lines.push('INGREDIENTS');
        ingredients.forEach(item => {
            const name = item.name ?? item;
            lines.push(item.quantity ? `  - ${name} (${item.quantity})` : `  - ${name}`);
        });
        lines.push('');
    }

    if (totalCost != null) {
        lines.push('ESTIMATED COST');
        lines.push(`  Total: $${typeof totalCost === 'number' ? totalCost.toFixed(2) : totalCost}`);
        if (estimated_cost?.per_person > 0) {
            lines.push(`  Per person: $${Number(estimated_cost.per_person).toFixed(2)}`);
        }
        lines.push('');
    }

    if (chefs.length > 0) {
        lines.push('RECOMMENDED CHEFS');
        chefs.forEach(chef => {
            const name = chef.full_name || [chef.first_name, chef.last_name].filter(Boolean).join(' ') || 'Chef';
            lines.push(`  - ${name}`);
        });
        lines.push('');
    }

    if (notes) {
        lines.push('NOTES');
        lines.push(`  ${notes}`);
    }

    return lines.join('\n').trim();
}

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';
const BORDER = '#e2ece2';
const TEXT = '#1a2e1a';
const TEXT_MID = '#4a7c59';
const TEXT_SOFT = '#8aab8a';
const BG = '#fefce8';

function Section({ icon, title, badge, children, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <View style={s.section}>
            <TouchableOpacity
                style={s.sectionHeader}
                onPress={() => setOpen(o => !o)}
                activeOpacity={0.75}
            >
                <View style={s.sectionLeft}>
                    <View style={s.iconDot}>
                        <Octicons name={icon} size={13} color={GREEN} />
                    </View>
                    <Text style={s.sectionTitle}>{title}</Text>
                    {badge != null && (
                        <View style={s.badge}>
                            <Text style={s.badgeText}>{badge}</Text>
                        </View>
                    )}
                </View>
                <Octicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={16} color={TEXT_SOFT}
                />
            </TouchableOpacity>
            {open && <View style={s.sectionBody}>{children}</View>}
        </View>
    );
}

export default function PlanCard({ plan, conversationId }) {
    if (!plan) return null;

    const { menu = [], ingredients = [], estimated_cost, chefs = [], notes } = plan;

    const totalCost = typeof estimated_cost === 'number'
        ? estimated_cost
        : (estimated_cost?.total ?? estimated_cost?.amount);

    const handleShare = async () => {
        try {
            await Share.share({ message: formatPlanForShare(plan) });
        } catch (e) {
            console.error('Failed to share plan:', e);
        }
    };

    return (
        <View style={s.card}>
            {/* Card title */}
            <View style={s.cardHeader}>
                <View style={s.cardHeaderLeft}>
                    <Octicons name="sparkle-fill" size={15} color={GREEN} />
                    <Text style={s.cardTitle}>Your Event Plan</Text>
                </View>
                <TouchableOpacity onPress={handleShare} style={s.shareBtn} activeOpacity={0.7}>
                    <Octicons name="share" size={16} color={GREEN} />
                </TouchableOpacity>
            </View>

            {/* ── Menu ── */}
            {menu.length > 0 && (
                <Section icon="list-unordered" title="Menu" badge={`${menu.length} courses`} defaultOpen>
                    {menu.map((course, i) => (
                        <View key={i} style={[s.courseRow, i < menu.length - 1 && s.courseRowBorder]}>
                            <Text style={s.courseName}>{course.course ?? course.name ?? course}</Text>
                            {course.dishes && (
                                <View style={{ marginTop: 4 }}>
                                    {course.dishes.map((dish, j) => (
                                        <View key={j} style={s.dishRow}>
                                            <Text style={s.dishDot}>•</Text>
                                            <View style={{ flex: 1 }}>
                                                <Text style={s.dishName}>{dish.name ?? dish}</Text>
                                                {dish.description ? (
                                                    <Text style={s.dishDesc}>{dish.description}</Text>
                                                ) : null}
                                                {dish.dietary_flags?.length > 0 && (
                                                    <View style={s.flagsRow}>
                                                        {dish.dietary_flags.map((flag, k) => (
                                                            <View key={k} style={s.flag}>
                                                                <Text style={s.flagText}>{flag}</Text>
                                                            </View>
                                                        ))}
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            )}
                        </View>
                    ))}
                </Section>
            )}

            {/* ── Ingredients ── */}
            {ingredients.length > 0 && (
                <Section icon="package" title="Ingredients" badge={`${ingredients.length} items`}>
                    {ingredients.map((item, i) => (
                        <View key={i} style={[s.ingRow, i < ingredients.length - 1 && s.ingRowBorder]}>
                            <Text style={s.ingName} numberOfLines={1}>
                                {item.name ?? item}
                            </Text>
                            {item.quantity ? (
                                <Text style={s.ingQty}>{item.quantity}</Text>
                            ) : null}
                        </View>
                    ))}
                </Section>
            )}

            {/* ── Cost ── */}
            {totalCost != null && (
                <Section icon="credit-card" title="Estimated Cost" defaultOpen>
                    <View style={s.costRow}>
                        <Text style={s.costAmount}>
                            ${typeof totalCost === 'number' ? totalCost.toFixed(2) : totalCost}
                        </Text>
                        {estimated_cost?.per_person > 0 && (
                            <Text style={s.costPer}>
                                (${Number(estimated_cost.per_person).toFixed(2)} / person)
                            </Text>
                        )}
                    </View>
                    {estimated_cost?.breakdown && (
                        <View style={{ marginTop: 8 }}>
                            {Object.entries(estimated_cost.breakdown).map(([k, v]) => (
                                <View key={k} style={s.breakdownRow}>
                                    <Text style={s.breakdownKey}>{k}</Text>
                                    <Text style={s.breakdownVal}>${Number(v).toFixed(2)}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                </Section>
            )}

            {/* ── Recommended Chefs ── */}
            {chefs.length > 0 && (
                <Section icon="person" title="Recommended Chefs" badge={chefs.length} defaultOpen>
                    {chefs.map((chef, i) => (
                        <ChefSuggestionCard key={chef.chef_id ?? i} chef={chef} />
                    ))}
                </Section>
            )}

            {/* ── Notes ── */}
            {notes ? (
                <View style={s.notesBox}>
                    <Octicons name="info" size={13} color={TEXT_SOFT} style={{ marginRight: 6 }} />
                    <Text style={s.notesText}>{notes}</Text>
                </View>
            ) : null}
        </View>
    );
}

const s = StyleSheet.create({
    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: BORDER,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
    },
    cardHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: GREEN_LIGHT,
        borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTitle: { fontSize: 15, fontWeight: '800', color: GREEN },
    shareBtn: {
        width: 28, height: 28, borderRadius: 14,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0',
    },

    // Section
    section: { borderBottomWidth: 1, borderBottomColor: BORDER },
    sectionHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 12,
    },
    sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
    iconDot: {
        width: 26, height: 26, borderRadius: 13,
        backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center',
    },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: TEXT },
    badge: {
        backgroundColor: '#f0fdf4', borderRadius: 10,
        paddingHorizontal: 8, paddingVertical: 2,
        borderWidth: 1, borderColor: '#bbf7d0',
    },
    badgeText: { fontSize: 11, fontWeight: '700', color: GREEN },
    sectionBody: { paddingHorizontal: 16, paddingBottom: 12 },

    // Menu / courses
    courseRow: { paddingVertical: 8 },
    courseRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f0f5f0' },
    courseName: { fontSize: 13, fontWeight: '700', color: TEXT_MID, textTransform: 'uppercase', letterSpacing: 0.5 },
    dishRow: { flexDirection: 'row', marginTop: 6, gap: 6 },
    dishDot: { fontSize: 14, color: TEXT_SOFT, marginTop: 1 },
    dishName: { fontSize: 13, fontWeight: '600', color: TEXT },
    dishDesc: { fontSize: 12, color: TEXT_SOFT, marginTop: 2, lineHeight: 17 },
    flagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
    flag: { backgroundColor: '#fef9c3', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: '#fde68a' },
    flagText: { fontSize: 10, fontWeight: '700', color: '#854d0e' },

    // Ingredients
    ingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
    ingRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f0f5f0' },
    ingName: { fontSize: 13, color: TEXT, flex: 1 },
    ingQty: { fontSize: 12, color: TEXT_SOFT, fontWeight: '600', marginLeft: 8 },

    // Cost
    costRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 },
    costAmount: { fontSize: 28, fontWeight: '800', color: GREEN },
    costPer: { fontSize: 13, color: TEXT_SOFT },
    breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    breakdownKey: { fontSize: 13, color: TEXT_SOFT, textTransform: 'capitalize' },
    breakdownVal: { fontSize: 13, color: TEXT, fontWeight: '600' },

    // Notes
    notesBox: {
        flexDirection: 'row', alignItems: 'flex-start',
        padding: 12, backgroundColor: BG,
        borderTopWidth: 1, borderTopColor: BORDER,
    },
    notesText: { fontSize: 13, color: TEXT_SOFT, flex: 1, lineHeight: 18 },
});