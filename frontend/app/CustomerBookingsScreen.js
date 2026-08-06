import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View, Alert, TouchableOpacity, RefreshControl, Modal, TextInput, StyleSheet } from "react-native";
import { Stack, useRouter } from 'expo-router';
import { Octicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import getEnvVars from "../config";
import { useAuth } from "./context/AuthContext";
import LoadingIcon from "./components/LoadingIcon";

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
    { label: 'All',       value: 'all' },
    { label: 'Pending',   value: 'pending' },
    { label: 'Accepted',  value: 'accepted' },
    { label: 'Completed', value: 'completed' },
    { label: 'Declined',  value: 'declined' },
    { label: 'Cancelled', value: 'cancelled' },
];

// Normalize status to lowercase and map synonyms
const normalizeStatus = (raw) => {
    const s = String(raw || '').toLowerCase().trim();
    if (s === 'confirmed' || s === 'confirm') return 'accepted';
    if (s === 'rejected' || s === 'deny' || s === 'denied') return 'declined';
    return s;
};

export default function CustomerBookingsScreen() {
    const { token, profileId, userType, userId } = useAuth();
    const { apiUrl } = getEnvVars();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedStatus, setSelectedStatus] = useState('all');
    const [reviewModal, setReviewModal] = useState({ visible: false, booking: null });
    const [rating, setRating] = useState(0);
    const [reviewText, setReviewText] = useState('');
    const [submittingReview, setSubmittingReview] = useState(false);

    const fetchBookings = async () => {
        try {
            setLoading(true);
            const url = `${apiUrl}/booking/customer/${profileId}/dashboard`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });
            const data = await response.json();
            if (response.ok) {
                const raw = [
                    ...(data.data?.upcoming_bookings || []),
                    ...(data.data?.todays_bookings || []),
                    ...(data.data?.previous_bookings || []),
                ];
                // Normalize status on every booking so filtering is reliable
                const normalized = raw.map(b => ({
                    ...b,
                    status: normalizeStatus(b.status),
                }));
                // Deduplicate by booking_id (dashboard buckets can overlap)
                const seen = new Set();
                const deduped = normalized.filter(b => {
                    if (seen.has(b.booking_id)) return false;
                    seen.add(b.booking_id);
                    return true;
                });
                // Sort newest booking date first
                deduped.sort((a, b) => new Date(b.booking_date) - new Date(a.booking_date));
                setBookings(deduped);
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
        if (userType !== 'customer') {
            Alert.alert('Access Denied', 'Only customers can view this page');
            router.back();
            return;
        }
        fetchBookings();
    }, []);

    const onRefresh = () => { setRefreshing(true); fetchBookings(); };

    const openReviewModal = (booking) => { setReviewModal({ visible: true, booking }); setRating(0); setReviewText(''); };
    const closeReviewModal = () => { setReviewModal({ visible: false, booking: null }); setRating(0); setReviewText(''); };

    const submitReview = async () => {
        if (rating === 0) { Alert.alert('Error', 'Please select a rating'); return; }
        if (!reviewText.trim()) { Alert.alert('Error', 'Please write a review'); return; }
        setSubmittingReview(true);
        try {
            const response = await fetch(`${apiUrl}/rating/chef/${reviewModal.booking.chef_id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ customer_id: profileId, rating, review: reviewText, booking_id: reviewModal.booking.booking_id }),
            });
            const data = await response.json();
            if (response.ok) {
                Alert.alert('Success', 'Thank you for your review!');
                closeReviewModal();
                fetchBookings();
            } else {
                Alert.alert('Error', data.error || 'Failed to submit review');
            }
        } catch (error) {
            Alert.alert('Error', 'Network error. Could not submit review.');
        } finally {
            setSubmittingReview(false);
        }
    };

    const handleCancelBooking = async (booking) => {
        const [datePart] = booking.booking_date.split('T');
        const bookingDate = new Date(`${datePart}T${booking.booking_time}`);
        const hoursUntil = (bookingDate - new Date()) / (1000 * 60 * 60);
        const withinWindow = hoursUntil < 24;
        // Calculate cancellation fee if within 24 hours. 0.50 is the % in decimal and is hardcoded
        const fee = withinWindow ? (Number(booking.total_cost) * 0.50).toFixed(2) : null;

        const message = withinWindow
            ? `This booking is within 24 hours. A cancellation fee of $${fee} (50% of total) will be charged. Proceed?`
            : 'Are you sure you want to cancel this booking? No fee will be charged.';
    Alert.alert('Cancel Booking', message,[
        { text: 'Keep Booking', style: 'cancel' },
        {
            text: 'Cancel Booking', style: 'destructive',
            onPress: async () => {
                try {
                    const pmRes = await fetch(`${apiUrl}/stripe-payment/payment-methods?customer_id=${userId}`, {
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    });
                    const pmData = await pmRes.json();
                    const defaultPm = pmData.payment_methods?.find(pm => pm.is_default);

                    const response = await fetch(`${apiUrl}/booking/cancel/${booking.booking_id}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ payment_method_id: defaultPm?.id }),
                    });
                    const data = await response.json();
                    if (response.ok){
                        const msg = data.cancellation_fee 
                        ? `Booking cancelled. A fee of $${data.cancellation_fee.toFixed(2)} was charged.` 
                        : 'Booking cancelled successfully.';
                        Alert.alert('Cancelled', msg);
                        fetchBookings();
                    } else {
                        Alert.alert('Error', data.error || 'Failed to cancel booking');
                    }
                }
                catch{
                    Alert.alert('Error', 'Network error. Could not cancel booking.');
                }
            }
        }
    ])
    }

    // --- Booking deletion logic: removes cancelled, declined, or past pending bookings permanently ---
    const handleDeleteBooking = async (booking) => {
        const isPastPending = booking.status === 'pending' && new Date(booking.booking_date) < new Date();

        Alert.alert(
            'Delete Booking',
            isPastPending
                ? 'This pending booking has passed. Delete it from your list?'
                : 'Permanently delete this booking from your list?',
            [
                { text: 'Keep', style: 'cancel' },
                {
                    text: 'Delete', style: 'destructive',
                    onPress: async () => {
                        try {
                            const response = await fetch(`${apiUrl}/booking/delete/${booking.booking_id}`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            });
                            const data = await response.json();
                            if (response.ok) {
                                Alert.alert('Deleted', 'Booking removed from your list.');
                                fetchBookings();
                            } else {
                                Alert.alert('Error', data.error || 'Failed to delete booking');
                            }
                        } catch {
                            Alert.alert('Error', 'Network error. Could not delete booking.');
                        }
                    },
                },
            ]
        );
    };
    // --- End booking deletion logic ---

    const filteredBookings = selectedStatus === 'all'
        ? bookings
        : bookings.filter(b => b.status === selectedStatus);

    // Count per tab for badge display
    const counts = STATUS_BUTTONS.reduce((acc, btn) => {
        acc[btn.value] = btn.value === 'all'
            ? bookings.length
            : bookings.filter(b => b.status === btn.value).length;
        return acc;
    }, {});

    if (loading && !refreshing) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: BG } }} />
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG }}>
                    <LoadingIcon message="Loading your bookings..." />
                </View>
            </>
        );
    }

    return (
        <>
            <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: BG } }} />
            <ScrollView
                style={{ flex: 1, backgroundColor: BG }}
                contentContainerStyle={{ paddingTop: insets.top, padding: 20, paddingBottom: 40 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
            >
                {/* Header */}
                <View style={s.pageHeader}>
                    <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
                        <Octicons name="chevron-left" size={22} color={GREEN} />
                    </TouchableOpacity>
                    <Text style={s.pageTitle}>My Bookings</Text>
                    <TouchableOpacity onPress={onRefresh} style={s.refreshBtn}>
                        <Octicons name="sync" size={18} color={GREEN} />
                    </TouchableOpacity>
                </View>

                {/* Status Filter with counts */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
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

                {/* Bookings */}
                {filteredBookings.length === 0 ? (
                    <View style={s.emptyCard}>
                        <Octicons name="calendar" size={40} color={GREEN_LIGHT} />
                        <Text style={s.emptyTitle}>No {selectedStatus === 'all' ? '' : selectedStatus} bookings</Text>
                        <Text style={s.emptyText}>
                            {selectedStatus === 'all'
                                ? 'Start by searching for a chef!'
                                : `You have no ${selectedStatus} bookings yet.`}
                        </Text>
                    </View>
                ) : (
                    filteredBookings.map((booking) => {
                        const statusStyle = STATUS_COLORS[booking.status] || STATUS_COLORS.pending;
                        const statusLabel = STATUS_LABELS[booking.status] || booking.status;

                        return (
                            <View key={booking.booking_id} style={s.bookingCard}>
                                {/* Card Header */}
                                <View style={s.bookingHeader}>
                                    <Text style={s.bookingTitle} numberOfLines={1}>
                                        {booking.chef_name
                                            ? `${booking.chef_name}`
                                            : `Booking #${booking.booking_id}`}
                                        {' — '}{booking.booking_date
                                            ? new Date(booking.booking_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                            : ''}
                                    </Text>
                                    <View style={[s.statusBadge, { backgroundColor: statusStyle.bg }]}>
                                        <Text style={[s.statusText, { color: statusStyle.text }]}>{statusLabel}</Text>
                                    </View>
                                </View>

                                <View style={s.bookingBody}>
                                    {/* Date & Time */}
                                    <View style={s.infoRow}>
                                        <Octicons name="clock" size={14} color={TEXT_SOFT} />
                                        <Text style={s.infoText}>{booking.booking_date} at {booking.booking_time}</Text>
                                    </View>

                                    {/* Guests & Cuisine */}
                                    <View style={s.infoRow}>
                                        <Octicons name="people" size={14} color={TEXT_SOFT} />
                                        <Text style={s.infoText}>
                                            {booking.number_of_people} {booking.number_of_people === 1 ? 'guest' : 'guests'} · {booking.cuisine_type} · {booking.meal_type}
                                        </Text>
                                    </View>

                                    {/* Total */}
                                    {booking.total_cost != null && (
                                        <View style={s.infoRow}>
                                            <Octicons name="credit-card" size={14} color={TEXT_SOFT} />
                                            <Text style={[s.infoText, { fontWeight: '700', color: GREEN }]}>
                                                ${Number(booking.total_cost).toFixed(2)}
                                            </Text>
                                        </View>
                                    )}

                                    {/* Address */}
                                    {booking.chef_address_line1 && (
                                        <View style={s.infoRow}>
                                            <Octicons name="location" size={14} color={TEXT_SOFT} />
                                            <Text style={s.infoText}>
                                                {booking.chef_address_line1}, {booking.chef_city}, {booking.chef_state} {booking.chef_zip_code}
                                            </Text>
                                        </View>
                                    )}

                                    {/* Special Notes */}
                                    {booking.special_notes ? (
                                        <View style={s.notesBox}>
                                            <Text style={s.notesLabel}>Special Notes</Text>
                                            <Text style={s.notesText}>{booking.special_notes}</Text>
                                        </View>
                                    ) : null}

                                    {/* Status messages */}
                                    {booking.status === 'pending' && (
                                        <View style={s.statusMsg}>
                                            <Octicons name="clock" size={13} color="#854d0e" />
                                            <Text style={[s.statusMsgText, { color: '#854d0e' }]}>Waiting for chef to accept</Text>
                                        </View>
                                    )}
                                    {booking.status === 'accepted' && (
                                        <View style={[s.statusMsg, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
                                            <Octicons name="check-circle" size={13} color="#166534" />
                                            <Text style={[s.statusMsgText, { color: '#166534' }]}>Booking confirmed!</Text>
                                        </View>
                                    )}
                                    {booking.status === 'declined' && (
                                        <View style={[s.statusMsg, { backgroundColor: '#fee2e2', borderColor: '#fecaca' }]}>
                                            <Octicons name="x-circle" size={13} color="#991b1b" />
                                            <Text style={[s.statusMsgText, { color: '#991b1b' }]}>This booking was declined by the chef.</Text>
                                        </View>
                                    )}
                                    {booking.status === 'cancelled' && (
                                        <View style={[s.statusMsg, { backgroundColor: '#fee2e2', borderColor: '#fecaca' }]}>
                                            <Octicons name="x-circle" size={13} color="#991b1b" />
                                            <Text style={[s.statusMsgText, { color: '#991b1b' }]}>This booking was cancelled.</Text>
                                        </View>
                                    )}
                                    {/* Cancel button*/}
                                    {(booking.status === 'pending' || booking.status === 'accepted') && new Date(`${booking.booking_date}T${booking.booking_time}`) > new Date() && (
                                        <TouchableOpacity style={[s.reviewBtn, { borderColor: '#991b1b', backgroundColor: '#fee2e2', marginTop: 10 }]}
                                            onPress={() => handleCancelBooking(booking)} activeOpacity={0.85}>
                                            <Octicons name="x-circle" size={15} color="#991b1b" style={{ marginRight: 7 }} />
                                            <Text style={[s.reviewBtnText, { color: '#991b1b' }]}>Cancel Booking</Text>
                                        </TouchableOpacity>         
                                    )}

                                    {/* Delete button: shows on cancelled, declined, or past pending bookings */}
                                    {(booking.status === 'cancelled' || booking.status === 'declined' ||
                                        (booking.status === 'pending' && new Date(booking.booking_date) < new Date())) && (
                                        <TouchableOpacity
                                            style={[s.reviewBtn, { borderColor: '#6b7280', backgroundColor: '#f3f4f6', marginTop: 10 }]}
                                            onPress={() => handleDeleteBooking(booking)}
                                            activeOpacity={0.85}
                                        >
                                            <Octicons name="trash" size={15} color="#6b7280" style={{ marginRight: 7 }} />
                                            <Text style={[s.reviewBtnText, { color: '#6b7280' }]}>Delete Booking</Text>
                                        </TouchableOpacity>
                                    )}

                                    {/* Review button */}
                                    {booking.status === 'completed' && !booking.has_reviewed && (
                                        <TouchableOpacity style={s.reviewBtn} onPress={() => openReviewModal(booking)} activeOpacity={0.85}>
                                            <Octicons name="star" size={15} color={GREEN} style={{ marginRight: 7 }} />
                                            <Text style={s.reviewBtnText}>Leave a Review</Text>
                                        </TouchableOpacity>
                                    )}
                                    {booking.status === 'completed' && booking.has_reviewed && (
                                        <View style={[s.statusMsg, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
                                            <Octicons name="check-circle" size={13} color="#166534" />
                                            <Text style={[s.statusMsgText, { color: '#166534' }]}>You have reviewed this booking</Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        );
                    })
                )}
            </ScrollView>

            {/* Review Modal */}
            <Modal visible={reviewModal.visible} transparent animationType="slide" onRequestClose={closeReviewModal}>
                <View style={s.modalOverlay}>
                    <View style={s.modalCard}>
                        <View style={s.modalHandle} />
                        <Text style={s.modalTitle}>Leave a Review</Text>
                        {reviewModal.booking && (
                            <Text style={s.modalSubtitle}>for Chef {reviewModal.booking.chef_name}</Text>
                        )}

                        {/* Stars */}
                        <View style={{ alignItems: 'center', marginBottom: 20 }}>
                            <Text style={s.fieldLabel}>Tap to rate</Text>
                            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                                {[1, 2, 3, 4, 5].map(star => (
                                    <TouchableOpacity key={star} onPress={() => setRating(star)} style={{ padding: 4 }}>
                                        <Octicons name={star <= rating ? "star-fill" : "star"} size={36} color={star <= rating ? "#eab308" : BORDER} />
                                    </TouchableOpacity>
                                ))}
                            </View>
                            {rating > 0 && (
                                <Text style={{ color: GREEN, fontWeight: '600', marginTop: 6 }}>
                                    {rating} {rating === 1 ? 'star' : 'stars'}
                                </Text>
                            )}
                        </View>

                        {/* Review text */}
                        <Text style={s.fieldLabel}>Your review</Text>
                        <TextInput
                            value={reviewText}
                            onChangeText={setReviewText}
                            placeholder="Share your experience with this chef..."
                            placeholderTextColor={TEXT_SOFT}
                            style={s.reviewInput}
                            multiline
                            maxLength={500}
                        />
                        <Text style={{ fontSize: 12, color: TEXT_SOFT, textAlign: 'right', marginBottom: 16 }}>
                            {reviewText.length}/500
                        </Text>

                        {/* Actions */}
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <TouchableOpacity style={[s.outlineBtn, { flex: 1 }]} onPress={closeReviewModal}>
                                <Text style={s.outlineBtnText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[s.primaryBtn, { flex: 1 }, submittingReview && { backgroundColor: '#c8ddd0' }]}
                                onPress={submitReview}
                                disabled={submittingReview}
                                activeOpacity={0.85}
                            >
                                <Text style={s.primaryBtnText}>{submittingReview ? 'Submitting...' : 'Submit Review'}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </>
    );
}

const s = StyleSheet.create({
    pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center' },
    pageTitle: { fontSize: 24, fontWeight: '800', color: TEXT, letterSpacing: -0.5 },
    refreshBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center' },

    // Filter pills with count badge
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
        backgroundColor: '#e2ece2', alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: 4,
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
    notesBox: { backgroundColor: '#fffbeb', borderRadius: 10, borderWidth: 1, borderColor: '#fde68a', padding: 10, marginTop: 4, marginBottom: 6 },
    notesLabel: { fontSize: 11, fontWeight: '700', color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
    notesText: { fontSize: 13, color: '#78350f' },
    statusMsg: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fef9c3', borderRadius: 10, borderWidth: 1, borderColor: '#fde68a', padding: 10, marginTop: 6 },
    statusMsgText: { fontSize: 13, fontWeight: '600', flex: 1 },
    reviewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: GREEN_LIGHT, borderWidth: 1.5, borderColor: GREEN, borderRadius: 12, paddingVertical: 11, marginTop: 10 },
    reviewBtnText: { fontSize: 14, fontWeight: '700', color: GREEN },

    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
    modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#dde8dd', alignSelf: 'center', marginBottom: 16 },
    modalTitle: { fontSize: 20, fontWeight: '800', color: TEXT, textAlign: 'center', marginBottom: 4 },
    modalSubtitle: { fontSize: 14, color: TEXT_SOFT, textAlign: 'center', marginBottom: 16 },
    fieldLabel: { fontSize: 12, fontWeight: '700', color: TEXT_MID, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
    reviewInput: { backgroundColor: '#f8faf8', borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, padding: 14, fontSize: 15, color: TEXT, minHeight: 120, textAlignVertical: 'top', marginBottom: 4 },
    primaryBtn: { backgroundColor: GREEN, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    outlineBtn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: BORDER, backgroundColor: '#fff' },
    outlineBtnText: { color: TEXT_MID, fontWeight: '600', fontSize: 14 },
});