import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Alert, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import * as Location from 'expo-location';
import Octicons from '@expo/vector-icons/Octicons';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTailwindColor } from '../utils/getTailwindColor';
import { useTheme } from '../providers/ThemeProvider';

const ROW_SURFACE = 'bg-white dark:bg-base-dark-100';
const ROW_RADIUS = 'rounded-2xl';
const ROW_MIN_H = 'min-h-[52px]';

function buildDisplayFromPlacemark(p) {
    if (!p) return { displayLine: '', postalCode: '', fullAddress: '' };
    const line = [p.city, p.region].filter(Boolean).join(', ');
    const zip = p.postalCode || '';
    const fullAddress = [p.name, p.street, line, zip].filter(Boolean).join(', ');
    return { displayLine: line, postalCode: zip, fullAddress };
}

export default function LocationInput({ formData, setFormData }) {
    const { manualTheme } = useTheme();
    const [addressInput, setAddressInput] = useState(formData.locationAddress || '');
    const [loading, setLoading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    const lastEnrichedCoords = useRef('');
    const skipGeocodeOnBlur = useRef(false);
    const prevLocationDisplayLine = useRef(formData.locationDisplayLine);

    const pinColor = manualTheme === 'light'
        ? getTailwindColor('primary.400')
        : getTailwindColor('dark.400');

    const mergeLocation = (latitude, longitude, { fullAddress, displayLine, postalCode }) => {
        setFormData((prev) => ({
            ...prev,
            latitude,
            longitude,
            locationAddress: fullAddress ?? prev.locationAddress,
            locationDisplayLine: displayLine ?? prev.locationDisplayLine,
            locationPostalCode: postalCode ?? prev.locationPostalCode,
        }));
    };

    useEffect(() => {
        const loadLocation = async () => {
            const storedLocation = await AsyncStorage.getItem(
                formData.profileId
                    ? `last-used-location-${formData.profileId}`
                    : 'guest-last-used-location'
            );
            if (storedLocation) {
                setAddressInput(storedLocation);
                geocodeAddress(storedLocation);
            } else {
                getCurrentLocation();
            }
        };
        loadLocation();
    }, []);

    useEffect(() => {
        if (formData.locationAddress && formData.locationAddress !== addressInput && !isEditing) {
            setAddressInput(formData.locationAddress);
        }
    }, [formData.locationAddress]);

    useEffect(() => {
        if (prevLocationDisplayLine.current && !formData.locationDisplayLine) {
            lastEnrichedCoords.current = '';
        }
        prevLocationDisplayLine.current = formData.locationDisplayLine;
    }, [formData.locationDisplayLine]);

    useEffect(() => {
        if (!formData.latitude || !formData.longitude) return;
        if (formData.locationDisplayLine) return;
        const key = `${formData.latitude},${formData.longitude}`;
        if (lastEnrichedCoords.current === key) return;
        lastEnrichedCoords.current = key;
        (async () => {
            try {
                const results = await Location.reverseGeocodeAsync({
                    latitude: formData.latitude,
                    longitude: formData.longitude,
                });
                const p = results[0];
                if (!p) return;
                const { displayLine, postalCode, fullAddress } = buildDisplayFromPlacemark(p);
                setFormData((prev) => ({
                    ...prev,
                    locationDisplayLine: displayLine || prev.locationDisplayLine,
                    locationPostalCode: postalCode || prev.locationPostalCode,
                    locationAddress: prev.locationAddress || fullAddress,
                }));
            } catch (e) {
                console.warn('[LocationInput] reverse geocode:', e);
            }
        })();
    }, [formData.latitude, formData.longitude, formData.locationDisplayLine]);

    const updateSavedLocation = async (newLocation) => {
        await AsyncStorage.setItem('last-used-location', newLocation);
    };

    const getCurrentLocation = async () => {
        setLoading(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                // Don't alert — user will enter manually
                return;
            }

            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
                timeout: 10000,
                maximumAge: 10000,
            });
            const { latitude, longitude } = location.coords;

            const reverseGeo = await Location.reverseGeocodeAsync({ latitude, longitude });
            const primaryAddress = reverseGeo[0];
            const { displayLine, postalCode, fullAddress } = buildDisplayFromPlacemark(primaryAddress);

            setAddressInput(fullAddress);
            mergeLocation(latitude, longitude, { fullAddress, displayLine, postalCode });

            // Save only if user has an account
            if (formData.profileId) {
                await updateSavedLocation(fullAddress);
            }

            setSelection({ start: 0, end: 0 });
            setIsEditing(false);
        } catch (err) {
            // Silently handle location unavailable — user can enter address manually
            console.warn('GPS unavailable:', err?.message || err);
            // Only show alert if user explicitly tapped the GPS button (not on auto-load)
        } finally {
            setLoading(false);
        }
    };

    const getCurrentLocationManual = async () => {
        setLoading(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Location permission is required to use GPS. Please enter your address manually.');
                return;
            }

            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
                timeout: 10000,
                maximumAge: 10000,
            });
            const { latitude, longitude } = location.coords;

            const reverseGeo = await Location.reverseGeocodeAsync({ latitude, longitude });
            const primaryAddress = reverseGeo[0];
            const { displayLine, postalCode, fullAddress } = buildDisplayFromPlacemark(primaryAddress);

            setAddressInput(fullAddress);
            mergeLocation(latitude, longitude, { fullAddress, displayLine, postalCode });
            await updateSavedLocation(fullAddress);
            setSelection({ start: 0, end: 0 });
            setIsEditing(false);
        } catch (err) {
            console.warn('GPS Error:', err?.message || err);
            if (err?.message?.includes('unavailable') || err?.code === 'E_LOCATION_UNAVAILABLE') {
                Alert.alert(
                    'GPS Unavailable',
                    'Location services are off or unavailable. Please enter your address manually.',
                );
            } else {
                Alert.alert('Location Error', 'Could not get your location. Please enter your address manually.');
            }
        } finally {
            setLoading(false);
        }
    };

    const geocodeAddress = async (addressToGeocode) => {
        const address = typeof addressToGeocode === 'string' ? addressToGeocode : addressInput;
        if (address.trim() === '') {
            Alert.alert('Address required', 'Please enter a street, city, or ZIP code.');
            return;
        }

        setLoading(true);
        try {
            const geocodeResult = await Location.geocodeAsync(address);

            if (geocodeResult.length === 0) {
                Alert.alert('Address Error', "We couldn't find a location for that address.");
                return;
            }

            const { latitude, longitude } = geocodeResult[0];
            let displayLine = '';
            let postalCode = '';
            try {
                const reverse = await Location.reverseGeocodeAsync({ latitude, longitude });
                const built = buildDisplayFromPlacemark(reverse[0]);
                displayLine = built.displayLine;
                postalCode = built.postalCode;
            } catch (_) {
                /* keep forward-geocode only */
            }

            const fullAddress = address.trim();
            mergeLocation(latitude, longitude, {
                fullAddress,
                displayLine: displayLine || fullAddress.split(',')[0]?.trim() || fullAddress,
                postalCode,
            });
            await updateSavedLocation(fullAddress);
            setAddressInput(fullAddress);
            setSelection({ start: 0, end: 0 });
            setIsEditing(false);
        } catch (err) {
            console.error('Geocoding Error:', err);
            Alert.alert('Error', 'Geocoding failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const rowClass = `${ROW_SURFACE} ${ROW_RADIUS} ${ROW_MIN_H} px-3`;

    if (isEditing) {
        return (
            <View className={`flex-row items-center ${rowClass} gap-2`}>
                <TouchableOpacity
                    onPress={getCurrentLocationManual}
                    disabled={loading}
                    accessibilityLabel="Use current location"
                    className="h-10 w-10 items-center justify-center"
                >
                    {loading ? (
                        <ActivityIndicator size="small" color={pinColor} />
                    ) : (
                        <Ionicons name="location-outline" size={22} color={pinColor} />
                    )}
                </TouchableOpacity>
                <TextInput
                    className="flex-1 py-2.5 px-1 text-base text-stone-800 dark:text-stone-100"
                    placeholder="Street, city, state, or ZIP"
                    placeholderTextColor="#9ca3af"
                    value={addressInput}
                    onChangeText={setAddressInput}
                    selection={selection}
                    onSelectionChange={({ nativeEvent: { selection: sel } }) => setSelection(sel)}
                    onSubmitEditing={() => geocodeAddress(addressInput)}
                    onBlur={() => {
                        if (skipGeocodeOnBlur.current) return;
                        geocodeAddress(addressInput);
                    }}
                    returnKeyType="search"
                    editable={!loading}
                />
                <TouchableOpacity
                    onPress={() => {
                        skipGeocodeOnBlur.current = true;
                        setIsEditing(false);
                        setAddressInput(formData.locationAddress || '');
                        setTimeout(() => {
                            skipGeocodeOnBlur.current = false;
                        }, 250);
                    }}
                    className="py-2 px-2"
                >
                    <Text className="text-sm font-semibold text-base-200 dark:text-base-dark-200">Cancel</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const title =
        formData.locationDisplayLine?.trim() ||
        (formData.locationAddress ? formData.locationAddress.split(',')[0]?.trim() : '') ||
        'Set your location';
    const zipLine = formData.locationPostalCode?.trim() || '';

    return (
        <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => {
                setAddressInput(formData.locationAddress || addressInput);
                setIsEditing(true);
            }}
            className={`flex-row items-center ${rowClass} gap-2`}
        >
            <View className="h-10 w-10 items-center justify-center">
                {loading ? (
                    <ActivityIndicator size="small" color={pinColor} />
                ) : (
                    <Ionicons name="location-outline" size={22} color={pinColor} />
                )}
            </View>

            <View className="flex-1 min-w-0 py-2 justify-center">
                <Text
                    numberOfLines={1}
                    className="text-base font-medium text-stone-800 dark:text-stone-100"
                >
                    {title}
                </Text>
                {zipLine ? (
                    <Text
                        numberOfLines={1}
                        className="text-xs text-stone-500 dark:text-stone-400 mt-0.5"
                    >
                        {zipLine}
                    </Text>
                ) : null}
            </View>

            <View className="flex-row items-center gap-1.5 shrink-0 py-2 pl-1">
                <Text className="text-sm text-stone-400 dark:text-stone-500">Change</Text>
                <Octicons name="pencil" size={16} color="#9ca3af" />
            </View>
        </TouchableOpacity>
    );
}