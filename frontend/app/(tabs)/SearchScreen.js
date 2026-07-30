import { useState, useEffect, useRef } from 'react';
import { ScrollView, Text, View, TouchableOpacity, RefreshControl, Alert, StyleSheet } from "react-native";
import { Link, useRouter } from 'expo-router';
import getEnvVars from "../../config";
import { useAuth } from "../context/AuthContext";
import Octicons from '@expo/vector-icons/Octicons';

import Card from "../components/Card";
import Button from '../components/Button';
import LoadingIcon from "../components/LoadingIcon";
import SearchBarComponent from '../components/SearchBar';
import SearchResultCard from '../components/SearchResultCard';
import ProfilePicture from '../components/ProfilePicture';
import RatingsDisplay from '../components/RatingsDisplay';
import { logAppEvent } from '../../utils/analytics';

function PlannerBanner({ onPress }) {
    return (
        <TouchableOpacity style={banner.card} onPress={onPress} activeOpacity={0.85}>
            <View style={banner.iconWrap}>
                <Octicons name="sparkle-fill" size={22} color="#2d6a4f" />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={banner.title}>Plan an event with AI</Text>
                <Text style={banner.sub}>Get a full menu, ingredients & chef match in seconds</Text>
            </View>
            <Octicons name="arrow-right" size={18} color="#2d6a4f" />
        </TouchableOpacity>
    );
}

const banner = StyleSheet.create({
    card: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: '#fff',
        borderRadius: 16, borderWidth: 1.5, borderColor: '#d8f3dc',
        padding: 14, marginBottom: 16,
        shadowColor: '#2d6a4f', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
    },
    iconWrap: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: '#d8f3dc', alignItems: 'center', justifyContent: 'center',
    },
    title: { fontSize: 14, fontWeight: '800', color: '#1a2e1a', marginBottom: 2 },
    sub: { fontSize: 12, color: '#8aab8a', lineHeight: 16 },
});

export default function SearchScreen() {
    const router = useRouter();

    const [formData, setFormData] = useState({
        searchQuery: '',
        searchType: 'chef',
        radius: 10,
        gender: 'all',
        timing: 'all',
        locationAddress: '',
        locationDisplayLine: '',
        locationPostalCode: '',
        latitude: null,
        longitude: null,
        min_rating: 0,
        max_price: 500,
        sort_by: 'distance',
        limit: 20,
        offset: 0,
    });

    const { apiUrl } = getEnvVars();
    const { token, userId, profileId, isGuest } = useAuth();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchResults, setSearchResults] = useState([]);
    const [recentSearches, setRecentSearches] = useState([]);
    const [recentChefs, setRecentChefs] = useState([]);
    const [favoriteChefs, setFavoriteChefs] = useState([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [autoLoadCompleted, setAutoLoadCompleted] = useState(false);
    const [loadingFaves, setLoadingFaves] = useState(false);
    const [loadingRecent, setLoadingRecent] = useState(false);
    const [refreshing, setRefreshing] = useState(null);

    const errorAlertShownRef = useRef(false);
    const autoLoadDoneRef = useRef(false);

    const onRefresh = () => {
        setRefreshing(true);
        errorAlertShownRef.current = false;
        autoLoadDoneRef.current = false;

        if (!isGuest) {
            fetchRecentSearches();
            fetchRecentChefs();
            fetchFavoriteChefs();
        }

        fetchSearchResults();
    };

    useEffect(() => {
        if (refreshing) setRefreshing(loading || loadingFaves || loadingRecent);
    }, [loading, loadingFaves, loadingRecent]);

    useEffect(() => {
        if (formData.latitude && formData.longitude && token && !autoLoadDoneRef.current) {
            autoLoadDoneRef.current = true;
            fetchSearchResults();
            setAutoLoadCompleted(true);
        }
    }, [formData.latitude, formData.longitude, token]);

    useEffect(() => {
        if (!isGuest && token && profileId) {
            fetchRecentSearches();
            fetchRecentChefs();
            fetchFavoriteChefs();
        }
    }, [token, profileId, isGuest]);

    const handleSearch = () => {
        if (formData.locationPostalCode) {
            logAppEvent({
                token,
                eventCategory: 'interaction',
                eventAction: 'search_zip_code',
                actorId: profileId || userId,
                eventData: {
                    zip_code: formData.locationPostalCode,
                    radius: formData.radius,
                    search_query: formData.searchQuery || '',
                },
            });
        }
        errorAlertShownRef.current = false;
        fetchSearchResults();
    };

    const fetchRecentSearches = async () => {
        if (!profileId) return;
        try {
            const url = `${apiUrl}/search/recent/${profileId}?limit=5`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });
            const data = await response.json();
            if (response.ok && data.success) setRecentSearches(data.recent_searches || []);
        } catch (err) {
            console.error('Failed to fetch recent searches:', err);
        }
    };

    const fetchRecentChefs = async () => {
        if (!profileId) return;
        try {
            setLoadingRecent(true);
            const url = `${apiUrl}/search/viewed-chefs/${profileId}?limit=5`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });
            const data = await response.json();
            if (response.ok && data.success) setRecentChefs(data.viewed_chefs || []);
        } catch (err) {
            console.error('[SearchScreen] Failed to fetch recent chefs:', err);
        } finally {
            setLoadingRecent(false);
        }
    };

    const fetchFavoriteChefs = async () => {
        if (!profileId) return;
        try {
            setLoadingFaves(true);
            const url = `${apiUrl}/booking/customer/${profileId}/favorite-chefs`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });
            const data = await response.json();
            if (response.ok && data.success) setFavoriteChefs(data.favorite_chefs || []);
        } catch (err) {
            console.error('[SearchScreen] Failed to fetch favorite chefs:', err);
        } finally {
            setLoadingFaves(false);
        }
    };

    const fetchSearchResults = async () => {
        setLoading(true);
        setError(null);
        try {
            const searchParams = new URLSearchParams();
            const apiParams = ['latitude', 'longitude', 'radius', 'min_rating', 'gender', 'max_price', 'sort_by', 'limit', 'offset'];
            const otherFutureParams = ['searchQuery', 'searchType', 'gender', 'timing', 'cuisine'];
            const allRelevantParams = [...apiParams, ...otherFutureParams];

            if (!isGuest && profileId) {
                searchParams.append('customer_id', profileId);
            }

            for (const key of allRelevantParams) {
                const value = formData[key];
                if (value !== null && value !== '' && value !== undefined) {
                    searchParams.append(key, value);
                }
            }

            if (!formData.latitude || !formData.longitude) {
                setError('Location is required for search. Please enable GPS or enter an address manually.');
                if (!errorAlertShownRef.current) {
                    errorAlertShownRef.current = true;
                    Alert.alert('Location Required', 'Please enable GPS or enter an address manually to search for nearby chefs.');
                }
                setLoading(false);
                return;
            }

            const url = `${apiUrl}/search/chefs/nearby?${searchParams.toString()}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });
            const data = await response.json();

            if (response.ok) {
                const transformedResults = (data.chefs || []).map(chef => ({
                    chef_id: chef.chef_id,
                    first_name: chef.first_name,
                    last_name: chef.last_name,
                    distance: chef.distance_miles,
                    cuisine: chef.cuisines || [],
                    timing: chef.meal_timings || [],
                    average_rating: chef.rating?.average_rating ?? null,
                    review_count: chef.rating?.total_reviews ?? 0,
                    hourly_rate: chef.pricing?.base_rate_per_person ?? null,
                }));
                setSearchResults(transformedResults);
                setError(null);
                errorAlertShownRef.current = false;
                if (!isGuest) {
                    fetchRecentSearches();
                }

                setRefreshKey(prev => prev + 1);
            } else {
                setError(data.error || 'Failed to load results.');
                if (!errorAlertShownRef.current) {
                    errorAlertShownRef.current = true;
                    Alert.alert('Error', data.error || 'Failed to load results.');
                }
            }
        } catch (err) {
            setError(err.message || 'Network error. Could not connect to API.');
            if (!errorAlertShownRef.current) {
                errorAlertShownRef.current = true;
                Alert.alert('Error', err.message || 'Network error. Could not connect to API.');
            }
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const renderSmallCard = (chef) => (
        <Link key={chef.chef_id} href={`/ChefProfileScreen/${chef.chef_id}`} asChild>
            <TouchableOpacity style={{
                marginRight: 12, borderRadius: 14, overflow: 'hidden',
                backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2ece2',
                shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, width: 110,
            }}>
                <View style={{ padding: 8, alignItems: 'center' }}>
                    <ProfilePicture size={20} photoUrl={chef.photo_url} firstName={chef.first_name} lastName={chef.last_name} />
                </View>
                <View style={{ backgroundColor: '#f8faf8', borderTopWidth: 1, borderTopColor: '#e2ece2', padding: 8, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#1a2e1a', textAlign: 'center' }} numberOfLines={1}>
                        {chef.full_name}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#6b8f71', textAlign: 'center', marginTop: 2 }} numberOfLines={1}>
                        {chef.cuisines && chef.cuisines.length > 0 ? chef.cuisines.slice(0, 1).join(', ') : 'Chef'}
                    </Text>
                    <RatingsDisplay rating={chef.rating && chef.rating.average_rating ? chef.rating.average_rating : 0} />
                </View>
            </TouchableOpacity>
        </Link>
    );

    const handleRecentSearchClick = (search) => {
        setFormData({
            ...formData,
            searchQuery: search.search_query || '',
            cuisine: search.cuisine || '',
            gender: search.gender || 'all',
            timing: search.meal_timing || 'all',
            min_rating: search.min_rating || 0,
            max_price: search.max_price || 500,
            radius: search.radius || 10,
            latitude: search.latitude || formData.latitude,
            longitude: search.longitude || formData.longitude,
            locationDisplayLine: '',
            locationPostalCode: '',
        });
        setTimeout(() => fetchSearchResults(), 100);
    };

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: '#fefce8' }}
            contentContainerStyle={{ padding: 20 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
            <SearchBarComponent
                key={refreshKey}
                formData={formData}
                setFormData={setFormData}
                handleSearch={handleSearch}
            />
            {!isGuest && (
                <Card
                    title="Favorite Chefs"
                    headerIcon="heart"
                    isCollapsible={true}
                    isScrollable={true}
                    scrollDirection="horizontal"
                >
                    {loadingFaves ? (
                        <LoadingIcon message="" size={64} icon="spinner" />
                    ) : favoriteChefs.length > 0 ? (
                        favoriteChefs.map((chef) => renderSmallCard(chef))
                    ) : (
                        <View className="p-4">
                            <Text className="text-primary-700 dark:text-dark-700 text-center">
                                Favorited chefs will appear here.
                            </Text>
                        </View>
                    )}
                </Card>
            )}
            {!isGuest && (<Card
                title="Recent Chefs"
                headerIcon="history"
                isCollapsible={true}
                isScrollable={true}
                scrollDirection="horizontal"
            >
                {loadingRecent ? <LoadingIcon message='' size={64} icon='spinner' /> : recentChefs.length > 0 ? (
                    recentChefs.map((chef) => renderSmallCard(chef))
                ) : (
                    <View className="p-4">
                        <Text className="text-primary-700 dark:text-dark-700 text-center">
                            Recently ordered from chefs will appear here.
                        </Text>
                    </View>
                )}
            </Card>
            )}

            {/* AI Event Planner banner */}
            <PlannerBanner onPress={() => router.push('/MenuPlannerScreen')} />

            <Card
                title="Nearby Chefs"
                headerIcon="location"
                isScrollable={true}
                scrollDirection="vertical"
            >
                {searchResults.length !== 0 ? searchResults.map((result, index) =>
                    <SearchResultCard
                        key={index}
                        chef_id={result["chef_id"]}
                        first_name={result["first_name"]}
                        last_name={result["last_name"]}
                        distance={result["distance"]}
                        cuisine={result["cuisine"]}
                        timing={result["timing"]}
                        average_rating={result["average_rating"]}
                        review_count={result["review_count"]}
                        hourly_rate={result["hourly_rate"]}
                    />)
                    :
                    <LoadingIcon icon='food' size={64} message='Fetching Nearby Chefs...' />
                }
            </Card>
            <View className="h-8" />
        </ScrollView>
    );
}