import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import Octicons from '@expo/vector-icons/Octicons';
import CustomPicker from './Picker';
import LocationInput from './LocationInput';
import getEnvVars from '../../config';
import { useAuth } from '../context/AuthContext';

export default function SearchBarComponent({ formData, setFormData, handleSearch }) {
    const [recentSearches, setRecentSearches] = useState([]);
    const [isDropVisible, setIsDropVisible] = useState(false);
    const { apiUrl } = getEnvVars();
    const { token, profileId, isGuestBrowsing } = useAuth();

    useEffect(() => {
        const fetchRecentSearches = async () => {

            // Guests do not have saved searches
            if (isGuestBrowsing || !profileId || !token) return;

            try {
                const url = `${apiUrl}/search/recent/${profileId}?limit=3`;

                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token && {
                            'Authorization': `Bearer ${token}`
                        }),
                    },
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    const formattedSearches = data.recent_searches.map(search => ({
                        query: search.search_query || search.cuisine || 'Recent search',
                        type: search.cuisine && !search.search_query ? 'cuisine' : 'chef',
                        fullData: search,
                    }));

                    setRecentSearches(formattedSearches);
                }

            } catch (err) {
                console.error('Failed to fetch recent searches:', err);
            }
        };

        fetchRecentSearches();

    }, [profileId, token, apiUrl, isGuestBrowsing]);

    const genderItems = [
        { label: "All", value: "all" },
        { label: "Male", value: "male" },
        { label: "Female", value: "female" },
    ];

    const timingItems = [
        { label: "All", value: "all" },
        { label: "Breakfast", value: "breakfast" },
        { label: "Lunch", value: "lunch" },
        { label: "Dinner", value: "dinner" },
    ];

    const searchOptions = [
        { label: "Chef", value: "chef" },
        { label: "Cuisine", value: "cuisine" },
        { label: "Dish", value: "dish" },
    ];

    const handleHistoryClick = (item) => {
        if (item.fullData) {
            setFormData(prev => ({
                ...prev,
                searchQuery: item.fullData.search_query || '',
                cuisine: item.fullData.cuisine || '',
                gender: item.fullData.gender || 'all',
                timing: item.fullData.meal_timing || 'all',
                min_rating: item.fullData.min_rating || 0,
                max_price: item.fullData.max_price || 500,
                radius: item.fullData.radius || 10,
                latitude: item.fullData.latitude || prev.latitude,
                longitude: item.fullData.longitude || prev.longitude,
                locationDisplayLine: '',
                locationPostalCode: '',
            }));
        } else {
            setFormData(prev => ({ ...prev, searchQuery: item.query, searchType: item.type }));
        }
    };

    const renderDropView = () => (
        <View style={s.dropView}>
            {/* Row 1: Search By + Search Radius */}
            <View style={s.filterRow}>
                <View style={s.filterCell}>
                    <CustomPicker
                        label="Search By"
                        prompt="Select what to search by"
                        selectedValue={formData.searchType}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, searchType: v }))}
                        items={searchOptions}
                        labelStyle='text-center'
                    />
                </View>
                <View style={s.divider} />
                <View style={s.filterCell}>
                    {/* Search Radius — fully inline to avoid Android clipping */}
                    <Text style={s.filterLabel}>SEARCH RADIUS</Text>
                    <View style={s.radiusRow}>
                        <TouchableOpacity
                            style={s.radiusBtn}
                            onPress={() => setFormData(prev => ({ ...prev, radius: Math.max(5, (prev.radius || 10) - 5) }))}
                            activeOpacity={0.7}
                        >
                            <Text style={s.radiusBtnText}>−</Text>
                        </TouchableOpacity>
                        <Text style={s.radiusValue}>{formData.radius} mi</Text>
                        <TouchableOpacity
                            style={s.radiusBtn}
                            onPress={() => setFormData(prev => ({ ...prev, radius: Math.min(50, (prev.radius || 10) + 5) }))}
                            activeOpacity={0.7}
                        >
                            <Text style={s.radiusBtnText}>+</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            <View style={s.rowSpacer} />

            {/* Row 2: Meal Timing + Chef Gender */}
            <View style={s.filterRow}>
                <View style={s.filterCell}>
                    <CustomPicker
                        label="Meal Timing"
                        prompt="Select Mealtime"
                        selectedValue={formData.timing}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, timing: v }))}
                        items={timingItems}
                        labelStyle='text-center'
                    />
                </View>
                <View style={s.divider} />
                <View style={s.filterCell}>
                    <CustomPicker
                        label="Chef Gender"
                        prompt="Select Gender"
                        selectedValue={formData.gender}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, gender: v }))}
                        items={genderItems}
                        labelStyle='text-center'
                    />
                </View>
            </View>

            <View style={s.rowSpacer} />

            {/* Recent Searches */}
            <View>
                <Text style={s.recentLabel}>Recent Searches</Text>
                {recentSearches.length > 0 ? (
                    <View style={s.recentList}>
                        {recentSearches.map((item, index) => (
                            <TouchableOpacity
                                key={index}
                                onPress={() => handleHistoryClick(item)}
                                style={[s.recentItem, index < recentSearches.length - 1 && s.recentItemBorder]}
                            >
                                <Octicons name="search" size={14} color="#8aab8a" style={{ marginRight: 8 }} />
                                <Text style={s.recentItemText}>{item.query}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                ) : (
                    <Text style={s.recentEmpty}>No recent searches yet</Text>
                )}
            </View>

            <TouchableOpacity onPress={() => setIsDropVisible(false)} style={s.collapseBtn}>
                <Octicons name="chevron-up" size={20} color="#8aab8a" />
            </TouchableOpacity>
        </View>
    );

    return (
        <View style={s.wrapper}>
            <View style={s.banner}>
                {/* Search row */}
                <View style={s.searchRow}>
                    <Octicons name="search" size={18} color="#aab4a8" style={{ marginRight: 8, flexShrink: 0 }} />
                    <TextInput
                        placeholder="Search by name, cuisine, or event type…"
                        placeholderTextColor="#aab4a8"
                        value={formData.searchQuery}
                        onChangeText={(v) => setFormData(prev => ({ ...prev, searchQuery: v }))}
                        onFocus={() => setIsDropVisible(true)}
                        style={s.searchInput}
                    />
                    <TouchableOpacity
                        onPress={() => { handleSearch(); setIsDropVisible(false); }}
                        style={s.searchBtn}
                        activeOpacity={0.85}
                    >
                        <Octicons name="search" size={18} color="#fff" />
                    </TouchableOpacity>
                </View>

                {isDropVisible ? renderDropView() : null}

                <LocationInput formData={formData} setFormData={setFormData} />
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    wrapper: { width: '100%', paddingBottom: 16 },
    banner: {
        width: '100%',
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 16,
        gap: 10,
        borderWidth: 1,
        borderColor: '#e2ece2',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f8faf8',
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#dde8dd',
        paddingLeft: 12,
        paddingRight: 10,
        minHeight: 48,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: '#1a2e1a',
        paddingVertical: 10,
        minWidth: 0,
    },
    searchBtn: {
        width: 36, height: 36,
        borderRadius: 10,
        backgroundColor: '#2d6a4f',
        alignItems: 'center', justifyContent: 'center',
        marginLeft: 8,
        flexShrink: 0,
    },
    dropView: {
        backgroundColor: '#f8faf8',
        borderRadius: 14,
        padding: 12,
        borderWidth: 1,
        borderColor: '#e2ece2',
    },

    // Filter rows — each child gets flex:1 so they split evenly
    filterRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2ece2',
        overflow: 'hidden',
        minHeight: 72,
    },
    filterCell: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 4,
    },
    divider: {
        width: 1,
        alignSelf: 'stretch',
        backgroundColor: '#e2ece2',
    },
    rowSpacer: { height: 8 },

    // Inline radius control
    filterLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#2d6a4f',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 6,
        textAlign: 'center',
    },
    radiusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    radiusBtn: {
        width: 30,
        height: 30,
        borderRadius: 8,
        backgroundColor: '#d8f3dc',
        alignItems: 'center',
        justifyContent: 'center',
    },
    radiusBtnText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#2d6a4f',
        lineHeight: 22,
    },
    radiusValue: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1a2e1a',
        minWidth: 44,
        textAlign: 'center',
    },

    // Recent searches
    recentLabel: {
        fontSize: 11, fontWeight: '700', color: '#8aab8a',
        letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8,
    },
    recentList: {
        borderRadius: 10, borderWidth: 1, borderColor: '#e2ece2', overflow: 'hidden',
    },
    recentItem: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 12, paddingVertical: 10,
        backgroundColor: '#fff',
    },
    recentItemBorder: { borderBottomWidth: 1, borderBottomColor: '#f0f5f0' },
    recentItemText: { fontSize: 14, color: '#4a7c59' },
    recentEmpty: { fontSize: 13, color: '#aab4a8', textAlign: 'center', padding: 12 },
    collapseBtn: { alignItems: 'center', paddingTop: 8 },
});