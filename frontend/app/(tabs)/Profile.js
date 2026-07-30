import React from 'react';
import { useEffect, useState } from "react";
import { useRouter, useFocusEffect } from "expo-router";
import { ScrollView, Text, View, Alert, TouchableOpacity, StyleSheet } from "react-native";

import getEnvVars from "../../config";
import { useAuth } from "../context/AuthContext";

import LoadingIcon from "../components/LoadingIcon";
import Button from "../components/Button";
import ProfilePicture from "../components/ProfilePicture";
import ThemeButton from "../components/ThemeButton";
import RatingsDisplay from "../components/RatingsDisplay";
import TagsBox from "../components/TagsBox";
import Input from "../components/Input";
import AddCardModal from "../components/AddCardModal";
import TestPaymentButton from "../components/TestPaymentButton";

import { Octicons } from '@expo/vector-icons';

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';
const BG = '#fefce8';
const BORDER = '#e2ece2';
const TEXT = '#1a2e1a';
const TEXT_MID = '#4a7c59';
const TEXT_SOFT = '#8aab8a';

export default function ProfileScreen() {
    const { logout, token, userType, userId, profileId, isGuest } = useAuth();
    const router = useRouter();
    const { apiUrl } = getEnvVars();

    const [profileData, setProfileData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editingAbout, setEditingAbout] = useState(false);
    const [aboutText, setAboutText] = useState('');
    const [savingAbout, setSavingAbout] = useState(false);
    const [editingDetails, setEditingDetails] = useState(false);
    const [allCuisines, setAllCuisines] = useState([]);
    const [selectedCuisines, setSelectedCuisines] = useState([]);
    const [selectedMealTimings, setSelectedMealTimings] = useState(['Lunch', 'Dinner']);
    const [savingDetails, setSavingDetails] = useState(false);
    const [showAddCardModal, setShowAddCardModal] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
    const [recentBooking, setRecentBooking] = useState(null);

    useFocusEffect(
        React.useCallback(() => {
            const fetchProfile = async () => {
                if (isGuest) {
                    setLoading(false);
                    return;
                }

                if (!userId || !token || !userType || !profileId) return;
                setLoading(true);
                setError(null);
                try {
                    const url = `${apiUrl}/profile/${userType}/${profileId}`;
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    });
                    const data = await response.json();
                    if (response.ok) {
                        setProfileData(data.profile);
                        setAboutText(data.profile.description || '');
                        setSelectedCuisines(data.profile.cuisines || []);
                        setSelectedMealTimings(data.profile.meal_timings || ['Breakfast', 'Lunch', 'Dinner']);
                    } else {
                        setError(data.error || 'Failed to load profile.');
                    }
                } catch (err) {
                    setError(`Network error: ${err.message}`);
                } finally {
                    setLoading(false);
                }
            };
            fetchProfile();
        }, [profileId, userId, userType, token, apiUrl])
    );

    useEffect(() => {
        if (!isGuest && userType === 'customer') {
            fetchRecentBooking();
        }
    }, [token, isGuest, userType]);

    useEffect(() => {
        const fetchCuisines = async () => {
            if (userType !== 'chef') return;
            try {
                const response = await fetch(`${apiUrl}/profile/cuisines`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                });
                const data = await response.json();
                if (response.ok) setAllCuisines(data.cuisines || []);
            } catch (error) { }
        };
        fetchCuisines();
    }, [userType, apiUrl, token]);

    useEffect(() => {
        const fetchPaymentMethods = async () => {
            if (userType !== 'customer' || !userId || isGuest) return;
            setLoadingPaymentMethods(true);
            try {
                const response = await fetch(`${apiUrl}/stripe-payment/payment-methods?customer_id=${userId}`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                });
                const data = await response.json();
                if (response.ok) setPaymentMethods(data.payment_methods || []);
            } catch (error) { }
            finally { setLoadingPaymentMethods(false); }
        };
        fetchPaymentMethods();
    }, [userType, userId, apiUrl, token]);

    const handleDeleteCard = async (paymentMethodId) => {
        Alert.alert('Delete Card', 'Are you sure you want to delete this card?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive',
                onPress: async () => {
                    try {
                        const response = await fetch(`${apiUrl}/stripe-payment/payment-methods/${paymentMethodId}`, {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({ customer_id: userId }),
                        });
                        const data = await response.json();
                        if (response.ok) {
                            Alert.alert('Success', 'Card deleted successfully');
                            setPaymentMethods(paymentMethods.filter(pm => pm.id !== paymentMethodId));
                        } else {
                            Alert.alert('Error', data.error || 'Failed to delete card');
                        }
                    } catch (error) {
                        Alert.alert('Error', 'An error occurred while deleting card');
                    }
                },
            },
        ]);
    };

    const handleSetDefaultCard = async (paymentMethodId) => {
        try {
            const response = await fetch(`${apiUrl}/stripe-payment/payment-methods/${paymentMethodId}/set-default`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ customer_id: userId }),
            });
            const data = await response.json();
            if (response.ok) {
                setPaymentMethods(paymentMethods.map(pm => ({ ...pm, is_default: pm.id === paymentMethodId })));
            } else {
                Alert.alert('Error', data.error || 'Failed to set default');
            }
        } catch (error) { }
    };

    const refreshPaymentMethods = async () => {
        setLoadingPaymentMethods(true);
        try {
            const response = await fetch(`${apiUrl}/stripe-payment/payment-methods?customer_id=${userId}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });
            const data = await response.json();
            if (response.ok) setPaymentMethods(data.payment_methods || []);
        } catch (error) { }
        finally { setLoadingPaymentMethods(false); }
    };

    const handleSaveAbout = async () => {
        if (aboutText.length > 500) { Alert.alert('Error', 'Description cannot exceed 500 characters'); return; }
        setSavingAbout(true);
        try {
            const response = await fetch(`${apiUrl}/profile/chef/${profileId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ description: aboutText }),
            });
            const result = await response.json();
            if (response.ok) {
                setProfileData({ ...profileData, description: aboutText });
                setEditingAbout(false);
            } else {
                Alert.alert('Error', result.error || 'Failed to update');
            }
        } catch (error) {
            Alert.alert('Error', 'Network error. Please try again.');
        } finally { setSavingAbout(false); }
    };

    const handleSaveDetails = async () => {
        setSavingDetails(true);
        try {
            const cuisinesResponse = await fetch(`${apiUrl}/profile/chef/${profileId}/cuisines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ cuisines: selectedCuisines }),
            });
            if (!cuisinesResponse.ok) {
                const r = await cuisinesResponse.json();
                Alert.alert('Error', r.error || 'Failed to update cuisines');
                setSavingDetails(false); return;
            }
            const timingsResponse = await fetch(`${apiUrl}/profile/chef/${profileId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ meal_timings: selectedMealTimings }),
            });
            const timingsResult = await timingsResponse.json();
            if (timingsResponse.ok) {
                setProfileData({ ...profileData, cuisines: selectedCuisines, meal_timings: selectedMealTimings });
                setEditingDetails(false);
            } else {
                Alert.alert('Error', timingsResult.error || 'Failed to update');
            }
        } catch (error) {
            Alert.alert('Error', 'Network error. Please try again.');
        } finally { setSavingDetails(false); }
    };

    const toggleCuisine = (cuisineName) => {
        setSelectedCuisines(prev => prev.includes(cuisineName) ? prev.filter(c => c !== cuisineName) : [...prev, cuisineName]);
    };

    const toggleMealTiming = (timing) => {
        setSelectedMealTimings(prev => prev.includes(timing) ? prev.filter(t => t !== timing) : [...prev, timing]);
    };

    if (loading) {
        return (
            <View style={[s.screen, { justifyContent: 'center', alignItems: 'center' }]}>
                <LoadingIcon message="Loading Profile..." />
            </View>
        );
    }

    if (error) {
        return (
            <View style={[s.screen, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
                <Text style={{ color: '#ef4444', fontSize: 15, textAlign: 'center', marginBottom: 16 }}>{error}</Text>
                <Button title="Log out" style="primary" customClasses="min-w-[50%]" onPress={logout} />
            </View>
        );
    }

    return (
        <ScrollView style={s.screen} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>

            {/* Profile Card */}
            <View style={s.card}>
                {/* Top actions */}
                <View style={s.cardTopActions}>
                    <ThemeButton />
                    {!isGuest && (
                        <TouchableOpacity
                            onPress={() => router.push('/ProfileSettings')}
                            style={s.iconBtn}
                        >
                            <Octicons name="gear" size={18} color={GREEN} />
                        </TouchableOpacity>
                    )}
                </View>

                <View style={s.profileCenter}>
                    <ProfilePicture
                        photoUrl={profileData?.photo_url}
                        firstName={profileData?.first_name}
                        lastName={profileData?.last_name}
                    />
                    <Text style={s.profileName}>
                        {isGuest
                            ? "Guest Account"
                            : `${profileData?.first_name?.toUpperCase()} ${profileData?.last_name?.toUpperCase()}`
                        }
                    </Text>
                    <Text style={s.profileRole}>
                        {isGuest ? "Guest Customer" : userType?.charAt(0).toUpperCase() + userType?.slice(1)}
                    </Text>
                    {userType === 'chef' && (
                        <View style={{ alignItems: 'center', marginTop: 4 }}>
                            <RatingsDisplay rating={profileData?.avg_rating} />
                            <Text style={s.reviewCount}>{profileData?.total_reviews} Total Reviews</Text>
                        </View>
                    )}
                    {!isGuest && (
                        <View style={s.memberRow}>
                            <Text style={s.memberText}>
                                Member Since: {profileData?.member_since}
                            </Text>
                        </View>
                    )}
                </View>
            </View>

            {userType === 'customer' ? (<>                {/* Payment Methods */}
                <View style={s.card}>
                    <View style={s.sectionHeader}>
                        <Octicons name="credit-card" size={18} color={GREEN} style={{ marginRight: 8 }} />
                        <Text style={s.sectionTitle}>Payment Methods</Text>
                    </View>
                    <View style={s.sectionBody}>
                        {isGuest && (
                            <Text style={s.emptyText}>
                                Guest checkout is available. Your payment information will only be used for this purchase.
                            </Text>
                        )}
                        {loadingPaymentMethods ? (
                            <LoadingIcon icon="spinner" size={48} message="" />
                        ) : paymentMethods.length > 0 ? (
                            <View>
                                {paymentMethods.map((pm) => (
                                    <View key={pm.id} style={s.cardRow}>
                                        <Text style={{ fontSize: 22, marginRight: 12 }}>💳</Text>
                                        <View style={{ flex: 1 }}>
                                            <Text style={s.cardNumber}>•••• {pm.last4}</Text>
                                            <Text style={s.cardMeta}>
                                                {pm.brand.toUpperCase()} · Expires {pm.exp_month}/{pm.exp_year}
                                            </Text>
                                            {pm.is_default && (
                                                <Text style={s.defaultBadge}>✓ Default</Text>
                                            )}
                                        </View>
                                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                                            {!pm.is_default && (
                                                <TouchableOpacity
                                                    onPress={() => handleSetDefaultCard(pm.id)}
                                                    style={s.setDefaultBtn}
                                                >
                                                    <Text style={s.setDefaultText}>Set Default</Text>
                                                </TouchableOpacity>
                                            )}
                                            <TestPaymentButton customerId={userId} paymentMethodId={pm.id} />
                                            {!isGuest && (
                                                <TouchableOpacity onPress={() => handleDeleteCard(pm.id)}>
                                                    <Octicons name="trash" size={18} color="#ef4444" />
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    </View>
                                ))}
                                <TouchableOpacity style={s.addCardBtn} onPress={() => setShowAddCardModal(true)}>
                                    <Octicons name="plus" size={16} color={GREEN} />
                                    <Text style={s.addCardText}>Add New Card</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={{ alignItems: 'center' }}>
                                <Text style={s.emptyText}>No saved cards yet</Text>
                                <TouchableOpacity style={s.addCardBtnFull} onPress={() => setShowAddCardModal(true)}>
                                    <Octicons name="plus" size={16} color={GREEN} style={{ marginRight: 6 }} />
                                    <Text style={s.addCardText}>Add Bank Card</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                        <Text style={s.stripeNote}>Powered by Stripe - PCI DSS compliant</Text>
                    </View>
                </View>

                {!isGuest && (
                    <AddCardModal
                        visible={showAddCardModal}
                        onClose={() => setShowAddCardModal(false)}
                        onSuccess={refreshPaymentMethods}
                        customerId={userId}
                    />
                )}



                {/* Help & Policies */}
                <View style={s.card}>
                    <View style={s.sectionHeader}>
                        <Octicons name="info" size={18} color={GREEN} style={{ marginRight: 8 }} />
                        <Text style={s.sectionTitle}>Help & Policies</Text>
                    </View>
                    <View style={s.sectionBody}>
                        {['Help', 'Policies'].map((item, i) => (
                            <TouchableOpacity key={item} style={[s.helpRow, i < 1 && s.helpRowBorder]}>
                                <Text style={s.helpText}>{item}</Text>
                                <Octicons name="chevron-right" size={16} color={TEXT_SOFT} />
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                {/* Admin Dashboards */}
                <View style={s.card}>
                    <View style={s.sectionHeader}>
                        <Octicons name="graph" size={18} color={GREEN} style={{ marginRight: 8 }} />
                        <Text style={s.sectionTitle}>Admin Dashboards</Text>
                    </View>
                    <View style={s.sectionBody}>
                        <TouchableOpacity
                            style={[s.helpRow, s.helpRowBorder]}
                            onPress={() => router.push('/AdminUnmetDemand')}
                        >
                            <Text style={s.helpText}>Unmet Demand Dashboard</Text>
                            <Octicons name="chevron-right" size={16} color={TEXT_SOFT} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={s.helpRow}
                            onPress={() => router.push('/FraudDesk')}
                        >
                            <Text style={s.helpText}>Fraud Desk</Text>
                            <Octicons name="chevron-right" size={16} color={TEXT_SOFT} />
                        </TouchableOpacity>
                    </View>
                </View>
            </>
            ) : (
                <>
                    {/* Chef Details */}
                    <View style={s.card}>
                        <View style={s.sectionHeader}>
                            <Text style={s.sectionTitle}>Chef Details</Text>
                            {!editingDetails && (
                                <TouchableOpacity onPress={() => setEditingDetails(true)} style={s.editBtn}>
                                    <Octicons name="pencil" size={16} color={GREEN} />
                                </TouchableOpacity>
                            )}
                        </View>
                        <View style={s.sectionBody}>
                            {editingDetails ? (
                                <View>
                                    <Text style={s.editLabel}>Meal Timings</Text>
                                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                                        {['Breakfast', 'Lunch', 'Dinner'].map((timing) => (
                                            <TouchableOpacity
                                                key={timing}
                                                onPress={() => toggleMealTiming(timing)}
                                                style={[s.toggleTag, selectedMealTimings.includes(timing) && s.toggleTagActive]}
                                            >
                                                <Text style={[s.toggleTagText, selectedMealTimings.includes(timing) && s.toggleTagTextActive]}>
                                                    {timing}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    <Text style={s.editLabel}>Cuisines ({selectedCuisines.length} selected)</Text>
                                    <ScrollView style={{ maxHeight: 240, marginBottom: 16, borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 10 }}>
                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                            {allCuisines.sort((a, b) => a.name.localeCompare(b.name)).map((cuisine) => (
                                                <TouchableOpacity
                                                    key={cuisine.id}
                                                    onPress={() => toggleCuisine(cuisine.name)}
                                                    style={[s.toggleTag, selectedCuisines.includes(cuisine.name) && s.toggleTagActive]}
                                                >
                                                    <Text style={[s.toggleTagText, selectedCuisines.includes(cuisine.name) && s.toggleTagTextActive]}>
                                                        {cuisine.name}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </ScrollView>
                                    <View style={{ flexDirection: 'row', gap: 10 }}>
                                        <TouchableOpacity
                                            style={[s.actionBtn, s.actionBtnSecondary, { flex: 1 }]}
                                            onPress={() => { setSelectedCuisines(profileData?.cuisines || []); setSelectedMealTimings(profileData?.meal_timings || ['Breakfast', 'Lunch', 'Dinner']); setEditingDetails(false); }}
                                        >
                                            <Text style={s.actionBtnSecondaryText}>Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[s.actionBtn, s.actionBtnPrimary, { flex: 1 }]}
                                            onPress={handleSaveDetails}
                                            disabled={savingDetails}
                                        >
                                            <Text style={s.actionBtnPrimaryText}>{savingDetails ? 'Saving...' : 'Save'}</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : (
                                <View style={{ alignItems: 'center' }}>
                                    <Text style={s.detailServes}>Serves: {selectedMealTimings.join(', ')}</Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 8 }}>
                                        {profileData?.cuisines && profileData.cuisines.length > 0 ? (
                                            <TagsBox words={profileData?.cuisines} theme='light' />
                                        ) : (
                                            <Text style={s.emptyText}>No cuisines set</Text>
                                        )}
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* About */}
                    <View style={s.card}>
                        <View style={s.sectionHeader}>
                            <Text style={s.sectionTitle}>About</Text>
                            {!editingAbout && (
                                <TouchableOpacity onPress={() => setEditingAbout(true)} style={s.editBtn}>
                                    <Octicons name="pencil" size={16} color={GREEN} />
                                </TouchableOpacity>
                            )}
                        </View>
                        <View style={s.sectionBody}>
                            {editingAbout ? (
                                <View>
                                    <Input
                                        value={aboutText}
                                        onChangeText={setAboutText}
                                        placeholder="Tell customers about yourself and your cooking..."
                                        isTextArea={true}
                                        maxLength={500}
                                        multiline={true}
                                    />
                                    <Text style={{ fontSize: 12, color: TEXT_SOFT, textAlign: 'right', marginBottom: 12 }}>
                                        {aboutText.length}/500
                                    </Text>
                                    <View style={{ flexDirection: 'row', gap: 10 }}>
                                        <TouchableOpacity
                                            style={[s.actionBtn, s.actionBtnSecondary, { flex: 1 }]}
                                            onPress={() => { setAboutText(profileData?.description || ''); setEditingAbout(false); }}
                                        >
                                            <Text style={s.actionBtnSecondaryText}>Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[s.actionBtn, s.actionBtnPrimary, { flex: 1 }]}
                                            onPress={handleSaveAbout}
                                            disabled={savingAbout}
                                        >
                                            <Text style={s.actionBtnPrimaryText}>{savingAbout ? 'Saving...' : 'Save'}</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : (
                                <Text style={s.aboutText}>
                                    {profileData?.description || 'No description available. Tap edit to add one.'}
                                </Text>
                            )}
                        </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                        <TouchableOpacity style={s.outlineBtn} onPress={() => router.push('/ChefMenuScreen')} activeOpacity={0.85}>
                            <Text style={s.outlineBtnText}>Manage Menu</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.outlineBtn} onPress={() => router.push(`/ChefProfileScreen/${profileId}`)} activeOpacity={0.85}>
                            <Text style={s.outlineBtnText}>Customer View</Text>
                        </TouchableOpacity>
                    </View>
                </>
            )}

            {/* Log out */}
            <TouchableOpacity style={s.logoutBtn} onPress={() => {
                if (isGuest) {
                    router.push('/');
                } else {
                    logout();
                }
            }} activeOpacity={0.85}>
                <Text style={s.logoutText}>Log out</Text>
            </TouchableOpacity>

        </ScrollView>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: BG },
    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: BORDER,
        marginBottom: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
        elevation: 2,
    },
    cardTopActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
        padding: 12,
        paddingBottom: 0,
    },
    iconBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: GREEN_LIGHT,
        alignItems: 'center', justifyContent: 'center',
    },
    profileCenter: {
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 20,
        paddingTop: 8,
    },
    profileName: {
        fontSize: 20, fontWeight: '800', color: TEXT,
        letterSpacing: -0.5, marginTop: 12, marginBottom: 4,
    },
    profileRole: { fontSize: 15, color: TEXT_MID, fontWeight: '500' },
    reviewCount: { fontSize: 13, color: TEXT_SOFT, marginTop: 2 },
    memberRow: {
        marginTop: 12, paddingTop: 12,
        borderTopWidth: 1, borderTopColor: BORDER,
        width: '100%', alignItems: 'center',
    },
    memberText: { fontSize: 13, color: TEXT_SOFT },
    sectionHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: TEXT, flex: 1 },
    sectionBody: { padding: 16 },
    editBtn: {
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: GREEN_LIGHT,
        alignItems: 'center', justifyContent: 'center',
    },
    editLabel: {
        fontSize: 13, fontWeight: '700', color: TEXT_MID,
        textTransform: 'uppercase', letterSpacing: 0.8,
        marginBottom: 8,
    },
    toggleTag: {
        paddingHorizontal: 14, paddingVertical: 7,
        borderRadius: 20, borderWidth: 1.5, borderColor: BORDER,
        backgroundColor: '#fff',
    },
    toggleTagActive: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
    toggleTagText: { fontSize: 13, fontWeight: '600', color: TEXT_SOFT },
    toggleTagTextActive: { color: GREEN },
    actionBtn: {
        paddingVertical: 12, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center',
    },
    actionBtnPrimary: { backgroundColor: GREEN },
    actionBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    actionBtnSecondary: { borderWidth: 1.5, borderColor: BORDER, backgroundColor: '#f8faf8' },
    actionBtnSecondaryText: { color: TEXT_MID, fontWeight: '600', fontSize: 14 },
    detailServes: { fontSize: 15, fontWeight: '600', color: TEXT_MID },
    aboutText: { fontSize: 15, color: TEXT_MID, lineHeight: 22, textAlign: 'center' },
    emptyText: { fontSize: 14, color: TEXT_SOFT, textAlign: 'center', marginBottom: 12 },
    cardRow: {
        flexDirection: 'row', alignItems: 'center',
        padding: 12, borderRadius: 12,
        borderWidth: 1, borderColor: BORDER,
        marginBottom: 10, backgroundColor: '#f8faf8',
    },
    cardNumber: { fontSize: 15, fontWeight: '700', color: TEXT },
    cardMeta: { fontSize: 12, color: TEXT_SOFT, marginTop: 2 },
    defaultBadge: { fontSize: 12, color: GREEN, fontWeight: '600', marginTop: 3 },
    setDefaultBtn: {
        paddingHorizontal: 10, paddingVertical: 5,
        backgroundColor: GREEN_LIGHT, borderRadius: 8,
    },
    setDefaultText: { fontSize: 12, color: GREEN, fontWeight: '600' },
    addCardBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 10, marginTop: 4,
    },
    addCardBtnFull: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 13, paddingHorizontal: 24,
        borderRadius: 12, borderWidth: 1.5, borderColor: GREEN,
        backgroundColor: '#f0f7f0', marginBottom: 4,
    },
    addCardText: { fontSize: 14, fontWeight: '600', color: GREEN },
    stripeNote: { fontSize: 11, color: TEXT_SOFT, textAlign: 'center', marginTop: 10 },
    helpRow: {
        flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between', paddingVertical: 14,
    },
    helpRowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
    helpText: { fontSize: 15, color: TEXT_MID, fontWeight: '500' },
    logoutBtn: {
        backgroundColor: GREEN, paddingVertical: 16,
        borderRadius: 14, alignItems: 'center',
        shadowColor: GREEN, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
    },
    logoutText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
    outlineBtn: {
        flex: 1, paddingVertical: 14, borderRadius: 14,
        alignItems: 'center', borderWidth: 1.5,
        borderColor: BORDER, backgroundColor: '#fff',
    },
    outlineBtnText: { color: TEXT_MID, fontSize: 14, fontWeight: '600' },
});