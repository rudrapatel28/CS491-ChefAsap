import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { ScrollView, Text, Alert, View, TouchableOpacity, Image, StyleSheet } from "react-native";
import { Octicons } from '@expo/vector-icons';

import getEnvVars from "../../config";
import { useAuth } from "../context/AuthContext";

import LoadingIcon from "../components/LoadingIcon";
import ProfilePicture from "../components/ProfilePicture";
import RatingsDisplay from '../components/RatingsDisplay';
import TagsBox from '../components/TagsBox';
import { logAppEvent } from '../../utils/analytics';

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';
const BG = '#fefce8';
const BORDER = '#e2ece2';
const TEXT = '#1a2e1a';
const TEXT_MID = '#4a7c59';
const TEXT_SOFT = '#8aab8a';

const getImageSource = (photoUrl, apiUrl) => {
    if (!photoUrl) return null;
    if (photoUrl.startsWith('data:')) return { uri: photoUrl };
    return {
        uri: `${apiUrl.replace(/\/$/, '')}/${photoUrl.replace(/^\//, '')}`
    };
};

const FeaturedDishCard = ({ item, apiUrl }) => {
    const imgSrc = getImageSource(item.photo_url, apiUrl);
    return (
        <View style={s.dishCard}>
            {imgSrc ? (
                <Image source={imgSrc} style={s.dishImage} resizeMode="cover" />
            ) : (
                <View style={[s.dishImage, s.dishImageEmpty]}>
                    <Text style={s.dishImageEmptyText}>NO IMAGE</Text>
                </View>
            )}
            <Text style={s.dishName}>{item.dish_name}</Text>
            {item.description ? <Text style={s.dishDesc}>{item.description}</Text> : null}
            {item.price ? <Text style={s.dishPrice}> ${Number(item.price).toFixed(2)}</Text> : null}
            {item.prep_time ? <Text style={s.dishMeta}>Prep time: {item.prep_time} min</Text> : null}
        </View>
    );
};

export default function ChefProfileScreen() {
    const { id, distance } = useLocalSearchParams();
    const {
        token,
        userId,
        profileId,
        userType,
        isGuestBrowsing,
    } = useAuth();
    const { apiUrl } = getEnvVars();
    const router = useRouter();

    const requireAccount = () => {
        Alert.alert(
            "Account Required",
            "Create an account to chat with chefs, book experiences, and save favorites.",
            [
                {
                    text: "Not Now",
                    style: "cancel",
                },
                {
                    text: "Create Account",
                    onPress: () => router.replace("/(auth)"),
                },
            ]
        );
    };

    const [chefData, setChefData] = useState(null);
    const [featuredItems, setFeaturedItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [chefCuisines, setChefCuisines] = useState([]);
    const [mealTimings, setMealTimings] = useState([]);
    const [isFavorited, setIsFavorited] = useState(false);
    const [updatingFavoriteStatus, setUpdatingFavoriteStatus] = useState(false);

    useEffect(() => {
        if (!id) return;
        const chefId = parseInt(id, 10);
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const profileResponse = await fetch(`${apiUrl}/profile/chef/${chefId}/public`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                });
                const profileData = await profileResponse.json();
                if (profileResponse.ok) {
                    setChefData(profileData.profile);
                    setChefCuisines(profileData.profile.cuisines || []);
                    setMealTimings(profileData.profile.meal_timings || ['Breakfast', 'Lunch', 'Dinner']);
                } else {
                    setError(profileData.error || 'Failed to load profile.');
                }

                const featuredResponse = await fetch(`${apiUrl}/api/menu/chef/${chefId}/featured`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                });
                const featuredData = await featuredResponse.json();
                if (featuredResponse.ok) setFeaturedItems(featuredData.featured_items || []);

                if (!isGuestBrowsing && profileId) {
                    const faveResponse = await fetch(
                        `${apiUrl}/booking/customer/${profileId}/favorite-chefs/${chefId}`,
                        {
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`,
                            },
                        }
                    );

                    const faveData = await faveResponse.json();

                    if (faveResponse.ok) {
                        setIsFavorited(faveData.is_favorited || false);
                    }
                }



                if (userType === 'customer' && profileId) {
                    await fetch(`${apiUrl}/search/viewed-chefs/${profileId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ chef_id: chefId }),
                    }).catch(() => { });

                    console.log('Analytics firing with profileId:', profileId, 'userId:', userId);
                    logAppEvent({
                        token,
                        eventCategory: 'navigation',
                        eventAction: 'view_chef_profile',
                        actorId: profileId || userId,
                        eventData: {
                            chef_id: chefId,
                            source: 'chef_profile_screen',
                        },
                    });
                }
            } catch (err) {
                setError('Network error. Could not connect to API.');
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [
        id,
        apiUrl,
        token,
        isGuestBrowsing,
        profileId,
        userType,
        userId
    ]);

    const handleFavoriting = async () => {

        if (isGuestBrowsing) {
            requireAccount();
            return;
        }

        const chefId = parseInt(id, 10);
        setUpdatingFavoriteStatus(true);
        try {
            await fetch(`${apiUrl}/booking/customer/${profileId}/favorite-chefs/${chefId}`, {
                method: isFavorited ? 'DELETE' : 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });
            setIsFavorited(!isFavorited);
        } catch (err) {
            Alert.alert('Error', 'Could not update favorite status.');
        } finally {
            setUpdatingFavoriteStatus(false);
        }
    };

    const handleChatPress = () => {

        if (isGuestBrowsing) {
            requireAccount();
            return;
        }

        if (userType !== 'customer') {
            Alert.alert('Error', 'Only customers can message chefs.');
            return;
        }

        router.push({
            pathname: '/ChatScreen',
            params: {
                otherUserId: id,
                otherUserName: `${chefData?.first_name} ${chefData?.last_name}`,
            },
        });
    };

    if (loading) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[s.screen, { justifyContent: 'center', alignItems: 'center' }]}>
                    <LoadingIcon message="Loading Chef Profile..." />
                </View>
            </>
        );
    }

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <ScrollView style={s.screen} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>

                {/* Hero Card */}
                <View style={s.card}>

                    <TouchableOpacity
                        onPress={handleFavoriting}
                        disabled={updatingFavoriteStatus}
                        style={s.favoriteBtn}
                    >
                        <Octicons
                            name={
                                updatingFavoriteStatus
                                    ? 'sync'
                                    : isFavorited
                                        ? 'heart-fill'
                                        : 'heart'
                            }
                            size={20}
                            color={isFavorited ? '#ef4444' : GREEN}
                        />
                    </TouchableOpacity>

                    <View style={s.profileCenter}>
                        <ProfilePicture
                            photoUrl={chefData?.photo_url}
                            firstName={chefData?.first_name}
                            lastName={chefData?.last_name}
                            size={128}
                        />

                        <Text style={s.chefName}>
                            {chefData?.first_name} {chefData?.last_name}
                        </Text>
                        <RatingsDisplay rating={chefData?.average_rating} />
                        <Text style={s.reviewCount}>{chefData?.total_reviews} Total Reviews</Text>
                        <View style={s.memberRow}>
                            <Text style={s.memberText}>Serving Since: {chefData?.member_since}</Text>
                        </View>
                    </View>
                </View>

                {/* Location Card */}
                <View style={s.card}>
                    <View style={s.sectionBody}>
                        <View style={s.infoRow}>
                            <Octicons name="location" size={16} color={GREEN} />
                            <Text style={s.infoText}>Located in: {chefData?.public_location}</Text>
                        </View>
                        {distance && (
                            <View style={[s.infoRow, { marginTop: 6 }]}>
                                <Octicons name="arrow-both" size={16} color={TEXT_SOFT} />
                                <Text style={s.infoTextSoft}>Distance from you: {distance} miles</Text>
                            </View>
                        )}
                    </View>
                </View>

                {/* Serves & Cuisines */}
                <View style={s.card}>
                    <View style={s.sectionBody}>
                        {mealTimings.length > 0 && (
                            <View style={s.detailBlock}>
                                <Text style={s.detailLabel}>Serves:</Text>
                                <Text style={s.detailValue}>{mealTimings.join(', ')}</Text>
                            </View>
                        )}
                        <View style={[s.detailBlock, { marginBottom: 0 }]}>
                            <Text style={s.detailLabel}>Cuisine Specialties:</Text>
                            {chefCuisines.length > 0 ? (
                                <TagsBox words={chefCuisines} theme='light' />
                            ) : (
                                <Text style={s.emptyText}>No cuisine specialties listed</Text>
                            )}
                        </View>
                    </View>
                </View>

                {/* About */}
                <View style={s.card}>
                    <View style={s.sectionHeader}>
                        <Text style={s.sectionTitle}>About</Text>
                    </View>
                    <View style={s.sectionBody}>
                        <Text style={s.aboutText}>
                            {chefData?.description || 'No description available'}
                        </Text>
                    </View>
                </View>

                {/* Featured Dishes */}
                <View style={s.card}>
                    <View style={s.sectionHeader}>
                        <Text style={s.sectionTitle}>Featured Dishes</Text>
                    </View>
                    <View style={{ flexDirection: 'row', padding: 12, gap: 12 }}>
                        {featuredItems.length > 0 ? (
                            featuredItems.map(item => (
                                <FeaturedDishCard key={item.id} item={item} apiUrl={apiUrl} />
                            ))
                        ) : (
                            <Text style={[s.emptyText, { padding: 8 }]}>No featured dishes available</Text>
                        )}
                    </View>
                </View>

                {/* Actions */}
                <TouchableOpacity style={s.primaryBtn} onPress={() => router.push(`/ChefMenu/${id}`)} activeOpacity={0.85}>
                    <Text style={s.primaryBtnText}>View Menu</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[s.primaryBtn, { marginTop: 10 }]} onPress={handleChatPress} activeOpacity={0.85}>
                    <Octicons name="comment" size={16} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={s.primaryBtnText}>Chat</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[s.secondaryBtn, { marginTop: 10 }]} onPress={() => router.back()} activeOpacity={0.85}>
                    <Text style={s.secondaryBtnText}>← Return</Text>
                </TouchableOpacity>

            </ScrollView >
        </>
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
    favoriteBtn: {
        position: 'absolute', top: 12, right: 12, zIndex: 10,
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: GREEN_LIGHT,
        alignItems: 'center', justifyContent: 'center',
    },
    profileCenter: {
        alignItems: 'center',
        padding: 20, paddingTop: 24,
    },
    chefName: {
        fontSize: 22, fontWeight: '800', color: TEXT,
        letterSpacing: -0.5, marginTop: 12, marginBottom: 4,
    },
    reviewCount: { fontSize: 13, color: TEXT_SOFT, marginTop: 2 },
    memberRow: {
        marginTop: 12, paddingTop: 12,
        borderTopWidth: 1, borderTopColor: BORDER,
        width: '100%', alignItems: 'center',
    },
    memberText: { fontSize: 13, color: TEXT_SOFT },
    sectionHeader: {
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: TEXT },
    sectionBody: { padding: 16 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    infoText: { fontSize: 15, fontWeight: '600', color: TEXT_MID },
    infoTextSoft: { fontSize: 14, color: TEXT_SOFT },
    detailBlock: { marginBottom: 14 },
    detailLabel: {
        fontSize: 13, fontWeight: '700', color: TEXT_MID,
        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
    },
    detailValue: { fontSize: 15, color: TEXT },
    aboutText: { fontSize: 15, color: TEXT_MID, lineHeight: 22, textAlign: 'center' },
    emptyText: { fontSize: 14, color: TEXT_SOFT },
    dishCard: {
        width: 180, backgroundColor: '#f8faf8',
        borderRadius: 14, overflow: 'hidden',
        borderWidth: 1, borderColor: BORDER,
    },
    dishImage: { width: 180, height: 180 },
    dishImageEmpty: {
        backgroundColor: GREEN_LIGHT,
        alignItems: 'center', justifyContent: 'center',
    },
    dishImageEmptyText: { color: GREEN, fontWeight: '600', fontSize: 13 },
    dishName: {
        fontSize: 14, fontWeight: '700', color: TEXT,
        textAlign: 'center', paddingHorizontal: 10, paddingTop: 10,
    },
    dishDesc: {
        fontSize: 12, color: TEXT_SOFT,
        textAlign: 'center', paddingHorizontal: 10, paddingTop: 4,
    },
    dishPrice: {
        fontSize: 16, fontWeight: '800', color: GREEN,
        textAlign: 'center', paddingTop: 6,
    },
    dishMeta: {
        fontSize: 11, color: TEXT_SOFT,
        textAlign: 'center', paddingBottom: 10,
    },
    primaryBtn: {
        backgroundColor: GREEN, paddingVertical: 16,
        borderRadius: 14, alignItems: 'center', justifyContent: 'center',
        flexDirection: 'row',
        shadowColor: GREEN, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
    },
    primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
    secondaryBtn: {
        paddingVertical: 15, borderRadius: 14,
        alignItems: 'center', borderWidth: 1.5,
        borderColor: BORDER, backgroundColor: '#fff',
    },
    secondaryBtnText: { color: TEXT_MID, fontSize: 15, fontWeight: '600' },
});