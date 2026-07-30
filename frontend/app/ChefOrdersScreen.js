import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View, Alert, TouchableOpacity, RefreshControl, StyleSheet } from "react-native";
import { Stack, useRouter } from 'expo-router';
import { Octicons } from '@expo/vector-icons';

import getEnvVars from "../config";
import { useAuth } from "./context/AuthContext";

import LoadingIcon from "./components/LoadingIcon";
import Card from "./components/Card";
import CalendarConnectButton from "./components/CalendarConnectButton";
import CalendarIcsUploadButton from "./components/CalendarIcsUploadButton";
import { getKitchenConflicts } from "../utils/mealTimeUtils";

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';
const BG = '#fefce8';
const BORDER = '#e2ece2';
const TEXT = '#1a2e1a';
const TEXT_MID = '#4a7c59';
const TEXT_SOFT = '#8aab8a';

const STATUS_COLORS = {
    pending:   { bg: '#fef9c3', text: '#854d0e' },
    accepted:  { bg: '#dbeafe', text: '#1e40af' },
    declined:  { bg: '#fee2e2', text: '#991b1b' },
    completed: { bg: '#f0fdf4', text: '#166534' },
    cancelled: { bg: '#fee2e2', text: '#991b1b' },
};

const STATUS_LABELS = {
    pending: 'Pending',
    accepted: 'Accepted',
    declined: 'Declined',
    completed: 'Completed',
    cancelled: 'Cancelled',
};

const STATUS_BUTTONS = [
    { label: 'All',       value: 'all'       },
    { label: 'Pending',   value: 'pending'   },
    { label: 'Accepted',  value: 'accepted'  },
    { label: 'Completed', value: 'completed' },
    { label: 'Declined',  value: 'declined'  },
];

const safe = (val) => (val == null ? '' : String(val));

// Normalize status to lowercase and map synonyms
const normalizeStatus = (raw) => {
    const s = String(raw || '').toLowerCase().trim();
    if (s === 'confirmed' || s === 'confirm') return 'accepted';
    if (s === 'rejected' || s === 'deny' || s === 'denied') return 'declined';
    return s;
};

export default function ChefOrdersScreen() {
    const { token, profileId, userType } = useAuth();
    const { apiUrl } = getEnvVars();
    const router = useRouter();

    const [allBookings, setAllBookings] = useState([]); // full list, never filtered
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedStatus, setSelectedStatus] = useState('all');

    // Always fetch ALL bookings — filter client-side so the tab switch is instant
    const fetchBookings = async () => {
        try {
            setLoading(true);
            const url = `${apiUrl}/chef/${profileId}/bookings`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });
            const data = await response.json();
            if (response.ok) {
                const raw = data.bookings || [];
                // Normalize status on every booking
                const normalized = raw.map(b => ({
                    ...b,
                    status: normalizeStatus(b.status),
                }));
                // Sort: pending first, then by date desc
                normalized.sort((a, b) => {
                    if (a.status === 'pending' && b.status !== 'pending') return -1;
                    if (b.status === 'pending' && a.status !== 'pending') return 1;
                    return new Date(b.booking_date) - new Date(a.booking_date);
                });
                setAllBookings(normalized);
            } else {
                Alert.alert('Error', data.error || 'Failed to load bookings');
            }
        } catch (error) {
            Alert.alert('Error', 'Network error. Could not load bookings.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        if (userType !== 'chef') {
            Alert.alert('Access Denied', 'Only chefs can view this page');
            router.back();
            return;
        }
        fetchBookings();
    }, []); // fetch once on mount — tab switch is instant via client filter

    const onRefresh = () => { setRefreshing(true); fetchBookings(); };

    // Client-side filter
    const bookings = selectedStatus === 'all'
        ? allBookings
        : allBookings.filter(b => b.status === selectedStatus);

    // Count badges per tab
    const counts = STATUS_BUTTONS.reduce((acc, btn) => {
        acc[btn.value] = btn.value === 'all'
            ? allBookings.length
            : allBookings.filter(b => b.status === btn.value).length;
        return acc;
    }, {});

    const updateBookingStatus = async (bookingId, newStatus) => {
        try {
            const response = await fetch(`${apiUrl}/${bookingId}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ status: newStatus }),
            });
            const data = await response.json();
            if (response.ok) {
                Alert.alert('Success', `Booking ${newStatus}`);
                fetchBookings();
            } else {
                Alert.alert('Error', data.error || 'Failed to update booking');
            }
        } catch (error) {
            Alert.alert('Error', 'Network error. Could not update booking.');
        }
    };

    const handleKitchenAssistant = (booking) => {
        router.push({
            pathname: '/ChefProductivityScreen',
            params: {
                bookingId:    booking.booking_id,
                bookingDate:  booking.booking_date,
                bookingTime:  booking.booking_time,
                guestCount:   booking.number_of_people,
                customerName: booking.customer_name,
            },
        });
    };

    const renderMealConflict = (booking) => {
        const menuItems = booking.menu_items || [];
        if (!menuItems.length) return null;
        const conflicts = getKitchenConflicts({ booking_time: booking.booking_time }, menuItems);
        if (!conflicts.length) return null;
        return (
            <View style={s.conflictBox}>
                <Octicons name="alert" size={13} color="#92400e" />
                <Text style={s.conflictText}>Meal-time mismatch — confirm with customer before service.</Text>
            </View>
        );
    };

    const buildInfoLine = (booking) => {
        const parts = [
            safe(booking.number_of_people) + ' guests',
            booking.cuisine_type ? safe(booking.cuisine_type) : null,
            booking.meal_type    ? safe(booking.meal_type)    : null,
        ].filter(Boolean);
        return parts.join(' · ');
    };

    if (loading && !refreshing) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG }}>
                    <LoadingIcon message="Loading bookings..." />
                </View>
            </>
        );
    }

    return (
        <>
            <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: BG } }} />
            <ScrollView
                style={{ flex: 1, backgroundColor: BG }}
                contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
            >
                {/* Header */}
                <View style={s.pageHeader}>
                    <Text style={s.pageTitle}>My Bookings</Text>
                    <TouchableOpacity onPress={onRefresh} style={s.refreshBtn}>
                        <Octicons name="sync" size={18} color={GREEN} />
                    </TouchableOpacity>
                </View>

                {/* Calendar Sync */}
                <Card title="Calendar Sync" headerIcon="calendar" isCollapsible startExpanded={false}>
                    <Text style={s.cardNote}>Connect Google Calendar to sync bookings automatically</Text>
                    <CalendarConnectButton
                        onSynced={(data) => {
                            Alert.alert('Success', `Synced ${data.count || 0} events`);
                            fetchBookings();
                        }}
                    />
                    <View style={s.divider} />
                    <Text style={s.cardNote}>Or import from an .ics calendar file</Text>
                    <CalendarIcsUploadButton
                        onUploaded={(count) => {
                            Alert.alert('Success', `Imported ${count} events`);
                            fetchBookings();
                        }}
                    />
                </Card>

                {/* Status Filter with counts */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: 16 }}
                    contentContainerStyle={{ gap: 8 }}
                >
                    {STATUS_BUTTONS.map(btn => {
                        const count = counts[btn.value] || 0;
                        const isActive = selectedStatus === btn.value;
                        return (
                            <TouchableOpacity
                                key={btn.value}
                                onPress={() => setSelectedStatus(btn.value)}
                                style={[s.filterPill, isActive && s.filterPillActive]}
                            >
                                <Text style={[s.filterPillText, isActive && s.filterPillTextActive]}>
                                    {btn.label}
                                </Text>
                                {count > 0 && (
                                    <View style={[s.filterCount, isActive && s.filterCountActive]}>
                                        <Text style={[s.filterCountText, isActive && s.filterCountTextActive]}>
                                            {count}
                                        </Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                {/* Bookings list */}
                {bookings.length === 0 ? (
                    <View style={s.emptyCard}>
                        <Octicons name="calendar" size={40} color={GREEN_LIGHT} />
                        <Text style={s.emptyTitle}>
                            No {selectedStatus === 'all' ? '' : selectedStatus} bookings
                        </Text>
                        <Text style={s.emptyText}>
                            {selectedStatus === 'all'
                                ? 'New orders will appear here.'
                                : `You have no ${selectedStatus} bookings yet.`}
                        </Text>
                    </View>
                ) : (
                    bookings.map((booking) => {
                        const formattedDate = booking.booking_date
                            ? new Date(booking.booking_date + 'T00:00:00').toLocaleDateString('en-US', {
                                month: 'short', day: 'numeric', year: 'numeric',
                              })
                            : '';
                        const displayTitle = booking.customer_name
                            ? `${booking.customer_name} — ${formattedDate}`
                            : `Booking #${safe(booking.booking_id)}`;

                        const statusStyle = STATUS_COLORS[booking.status] || STATUS_COLORS.pending;
                        const statusLabel = STATUS_LABELS[booking.status] || booking.status;
                        const isUpcoming = ['pending', 'accepted'].includes(booking.status);

                        return (
                            <View key={booking.booking_id} style={s.bookingCard}>

                                {/* Card Header */}
                                <View style={s.bookingHeader}>
                                    <Text style={s.bookingTitle} numberOfLines={1}>
                                        {displayTitle}
                                    </Text>
                                    <View style={[s.statusBadge, { backgroundColor: statusStyle.bg }]}>
                                        <Text style={[s.statusText, { color: statusStyle.text }]}>
                                            {statusLabel}
                                        </Text>
                                    </View>
                                </View>

                                <View style={s.bookingBody}>

                                    {/* Date & Time */}
                                    <View style={s.infoRow}>
                                        <Octicons name="clock" size={14} color={TEXT_SOFT} />
                                        <Text style={s.infoText}>
                                            {safe(booking.booking_date)}
                                            {booking.booking_time ? (' at ' + safe(booking.booking_time)) : ''}
                                        </Text>
                                    </View>

                                    {/* Guests · Cuisine · Meal */}
                                    <View style={s.infoRow}>
                                        <Octicons name="people" size={14} color={TEXT_SOFT} />
                                        <Text style={s.infoText}>{buildInfoLine(booking)}</Text>
                                    </View>

                                    {/* Meal-time mismatch warning */}
                                    {renderMealConflict(booking)}

                                    {/* Total */}
                                    {booking.total_cost != null ? (
                                        <View style={s.infoRow}>
                                            <Octicons name="credit-card" size={14} color={TEXT_SOFT} />
                                            <Text style={[s.infoText, { fontWeight: '700', color: GREEN }]}>
                                                {'$' + Number(booking.total_cost).toFixed(2)}
                                            </Text>
                                        </View>
                                    ) : null}

                                    {/* Address */}
                                    {booking.chef_address_line1 ? (
                                        <View style={s.infoRow}>
                                            <Octicons name="location" size={14} color={TEXT_SOFT} />
                                            <Text style={s.infoText}>
                                                {[safe(booking.chef_address_line1), safe(booking.chef_city), safe(booking.chef_state)].filter(Boolean).join(', ')}
                                            </Text>
                                        </View>
                                    ) : null}

                                    {/* Special Notes */}
                                    {booking.special_notes ? (
                                        <View style={s.notesBox}>
                                            <Text style={s.notesLabel}>Special Notes</Text>
                                            <Text style={s.notesText}>{safe(booking.special_notes)}</Text>
                                        </View>
                                    ) : null}

                                    {/* Kitchen Assistant — only for upcoming */}
                                    {isUpcoming ? (
                                        <TouchableOpacity
                                            style={s.assistantBtn}
                                            onPress={() => handleKitchenAssistant(booking)}
                                            activeOpacity={0.85}
                                        >
                                            <Octicons name="sparkle-fill" size={15} color={GREEN} style={{ marginRight: 7 }} />
                                            <Text style={s.assistantBtnText}>Kitchen Assistant</Text>
                                        </TouchableOpacity>
                                    ) : null}

                                    {/* Accept / Decline — pending only */}
                                    {booking.status === 'pending' ? (
                                        <View style={s.actionRow}>
                                            <TouchableOpacity
                                                style={[s.actionBtn, s.actionBtnPrimary]}
                                                onPress={() => updateBookingStatus(booking.booking_id, 'accepted')}
                                                activeOpacity={0.85}
                                            >
                                                <Text style={s.actionBtnPrimaryText}>Accept</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[s.actionBtn, s.actionBtnSecondary]}
                                                onPress={() => updateBookingStatus(booking.booking_id, 'declined')}
                                                activeOpacity={0.85}
                                            >
                                                <Text style={s.actionBtnSecondaryText}>Decline</Text>
                                            </TouchableOpacity>
                                        </View>
                                    ) : null}

                                    {/* Mark Complete — accepted only */}
                                    {booking.status === 'accepted' ? (
                                        <TouchableOpacity
                                            style={[s.actionBtn, s.actionBtnPrimary, { marginTop: 10 }]}
                                            onPress={() => updateBookingStatus(booking.booking_id, 'completed')}
                                            activeOpacity={0.85}
                                        >
                                            <Text style={s.actionBtnPrimaryText}>Mark as Completed</Text>
                                        </TouchableOpacity>
                                    ) : null}

                                </View>
                            </View>
                        );
                    })
                )}

                <TouchableOpacity style={s.returnBtn} onPress={() => router.back()} activeOpacity={0.85}>
                    <Text style={s.returnBtnText}>← Back</Text>
                </TouchableOpacity>
            </ScrollView>
        </>
    );
}

const s = StyleSheet.create({
    pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    pageTitle: { fontSize: 24, fontWeight: '800', color: TEXT, letterSpacing: -0.5 },
    refreshBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center' },

    cardNote: { fontSize: 13, color: TEXT_SOFT, marginBottom: 10 },
    divider: { height: 1, backgroundColor: BORDER, marginVertical: 12 },

    // Filter pills
    filterPill: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 8,
        borderRadius: 20, borderWidth: 1.5, borderColor: BORDER, backgroundColor: '#fff',
    },
    filterPillActive: { backgroundColor: GREEN, borderColor: GREEN },
    filterPillText: { fontSize: 13, fontWeight: '600', color: TEXT_MID },
    filterPillTextActive: { color: '#fff' },
    filterCount: {
        minWidth: 20, height: 20, borderRadius: 10,
        backgroundColor: '#e2ece2', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
    },
    filterCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
    filterCountText: { fontSize: 11, fontWeight: '700', color: TEXT_MID },
    filterCountTextActive: { color: '#fff' },

    emptyCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 40, alignItems: 'center', gap: 8 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: TEXT, marginTop: 4 },
    emptyText: { fontSize: 14, color: TEXT_SOFT, textAlign: 'center' },

    bookingCard: {
        backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: BORDER,
        marginBottom: 14, overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    },
    bookingHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    bookingTitle: { fontSize: 14, fontWeight: '700', color: TEXT, flex: 1, marginRight: 10 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    statusText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
    bookingBody: { padding: 14, gap: 2 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    infoText: { fontSize: 13, color: TEXT_MID, flex: 1 },

    conflictBox: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fef3c7', borderRadius: 10, borderWidth: 1, borderColor: '#fde68a', padding: 10, marginBottom: 6 },
    conflictText: { fontSize: 12, color: '#92400e', flex: 1, fontWeight: '500' },

    notesBox: { backgroundColor: '#fffbeb', borderRadius: 10, borderWidth: 1, borderColor: '#fde68a', padding: 10, marginTop: 4, marginBottom: 6 },
    notesLabel: { fontSize: 11, fontWeight: '700', color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
    notesText: { fontSize: 13, color: '#78350f' },

    assistantBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: GREEN_LIGHT, borderWidth: 1.5, borderColor: GREEN, borderRadius: 12, paddingVertical: 11, marginTop: 10 },
    assistantBtnText: { fontSize: 14, fontWeight: '700', color: GREEN },

    actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
    actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    actionBtnPrimary: { backgroundColor: GREEN },
    actionBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    actionBtnSecondary: { borderWidth: 1.5, borderColor: BORDER, backgroundColor: '#fff' },
    actionBtnSecondaryText: { color: TEXT_MID, fontWeight: '600', fontSize: 14 },

    returnBtn: { marginTop: 8, padding: 14, alignItems: 'center' },
    returnBtnText: { fontSize: 14, color: TEXT_SOFT, fontWeight: '600' },
});