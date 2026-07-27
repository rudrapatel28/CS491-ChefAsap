import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useLocalSearchParams, Stack, useRouter, useFocusEffect } from 'expo-router';
import { ScrollView, Text, Alert, View, Modal, Image, TouchableOpacity, StyleSheet, TextInput, Pressable } from "react-native";
import { Octicons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import getEnvVars from "../../config";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import LoadingIcon from "../components/LoadingIcon";
import ProfilePicture from "../components/ProfilePicture";
import RatingsDisplay from '../components/RatingsDisplay';

import { getCartConflicts, getMealTypeForHour, MEAL_TIME_WINDOWS } from '../../utils/mealTimeUtils';

import { logAppEvent } from '../../utils/analytics';

const GREEN       = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';
const BG          = '#fefce8';
const BORDER      = '#e2ece2';
const TEXT        = '#1a2e1a';
const TEXT_MID    = '#4a7c59';
const TEXT_SOFT   = '#8aab8a';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const FIXED_SECTIONS = [
    { id: 'Breakfast',   label: 'Breakfast',   subtitle: '6 AM – 11 AM',  color: '#fef9c3', textColor: '#92400e', mealType: 'Breakfast'  },
    { id: 'Lunch',       label: 'Lunch',       subtitle: '11 AM – 3 PM',  color: '#dcfce7', textColor: '#166534', mealType: 'Lunch'      },
    { id: 'Dinner',      label: 'Dinner',      subtitle: '5 PM – 11 PM',  color: '#ede9fe', textColor: '#5b21b6', mealType: 'Dinner'     },
    { id: 'Specialties', label: 'Specialties', subtitle: 'Any time',      color: GREEN_LIGHT, textColor: GREEN,   mealType: 'Any'        },
];

const getSectionForItem = (item) => {
    if (!item) return null;
    if (item.meal_type === 'Breakfast') return FIXED_SECTIONS[0];
    if (item.meal_type === 'Lunch')     return FIXED_SECTIONS[1];
    if (item.meal_type === 'Dinner')    return FIXED_SECTIONS[2];
    if (item.meal_type === 'Any')       return FIXED_SECTIONS[3];
    const byName = FIXED_SECTIONS.find(s => s.id === item.category_name);
    if (byName) return byName;
    return null;
};

const getImageSource = (photoUrl, apiUrl) => {
    if (!photoUrl) return null;
    if (photoUrl.startsWith('data:')) return { uri: photoUrl };
    return { uri: `${apiUrl}${photoUrl}` };
};

const parseZipFromLocation = (locationText) => {
    if (!locationText) return '';
    const match = String(locationText).match(/\b\d{5}\b/);
    return match ? match[0] : '';
};

const getDefaultBookingDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { month: tomorrow.getMonth(), day: tomorrow.getDate(), year: tomorrow.getFullYear(), hour: 12, minute: 0 };
};

const formatBookingDate = (bookingDate, bookingTime) => {
    if (!bookingDate) return 'Recent booking';
    const date = new Date(bookingDate);
    const datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = bookingTime ? new Date(`2000-01-01T${bookingTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    return timePart ? `${datePart} · ${timePart}` : datePart;
};

const formatRecentStatus = (status) => {
    const value = String(status || 'completed').toLowerCase();
    return value.charAt(0).toUpperCase() + value.slice(1);
};

// ── Stepper ───────────────────────────────────────────────────────────────────
const Stepper = ({ label, value, onDecrement, onIncrement }) => (
    <View style={{ alignItems: 'center', flex: 1 }}>
        <Text style={st.stepperLabel}>{label}</Text>
        <View style={st.stepperRow}>
            <TouchableOpacity style={st.stepperBtn} onPress={onDecrement} activeOpacity={0.7}>
                <Text style={st.stepperBtnTxt}>−</Text>
            </TouchableOpacity>
            <Text style={st.stepperVal}>{value}</Text>
            <TouchableOpacity style={st.stepperBtn} onPress={onIncrement} activeOpacity={0.7}>
                <Text style={st.stepperBtnTxt}>+</Text>
            </TouchableOpacity>
        </View>
    </View>
);

// ── Menu item card ────────────────────────────────────────────────────────────
const MenuItemCard = ({ item, onAddToOrder, onQtyDec, onQtyInc, apiUrl, userType, quantity = 0 }) => {
    const imgSrc  = getImageSource(item?.photo_url, apiUrl);
    const canOrder = userType !== 'chef' && item?.is_available;
    const section  = getSectionForItem(item);
    const isSelected = quantity > 0;

    return (
        <View style={[st.menuCard, isSelected && st.menuCardSelected]}>
            {isSelected ? (
                <View style={st.selectedBadge}>
                    <Octicons name="check" size={11} color={GREEN} />
                    <Text style={st.selectedBadgeTxt}>{quantity} selected</Text>
                </View>
            ) : null}
            <Text style={st.menuItemName}>{item?.dish_name || 'Dish Name'}</Text>
            {section ? (
                <View style={[st.mealBadge, { backgroundColor: section.color }]}>
                    <Text style={[st.mealBadgeTxt, { color: section.textColor }]}>
                        {section.label + ' · ' + section.subtitle}
                    </Text>
                </View>
            ) : null}
            <View style={st.menuItemBody}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                    {item?.description  ? <Text style={st.menuItemDesc}>{item.description}</Text>  : null}
                    {item?.servings     ? <Text style={st.menuItemMeta}>{'Servings: ' + item.servings}</Text>   : null}
                    {item?.spice_level  ? <Text style={st.menuItemMeta}>{'Spice: ' + item.spice_level}</Text>   : null}
                </View>
                <View style={{ width: 120 }}>
                    {imgSrc ? (
                        <Image source={imgSrc} style={st.menuItemImage} resizeMode="cover" />
                    ) : (
                        <View style={[st.menuItemImage, st.menuItemImageEmpty]}>
                            <Text style={st.menuItemImageEmptyTxt}>NO IMAGE</Text>
                        </View>
                    )}
                </View>
            </View>
            <View style={st.menuItemFooter}>
                {item?.prep_time != null ? <Text style={st.menuItemFooterMeta}>{'Prep: ' + item.prep_time + ' min'}</Text> : null}
                {item?.price     != null ? <Text style={st.menuItemPrice}>{'$' + Number(item.price).toFixed(2)}</Text>     : null}
            </View>
            {isSelected ? (
                <View style={st.itemActionRow}>
                    <TouchableOpacity style={st.qtyBtn} onPress={() => onQtyDec?.(item)} activeOpacity={0.7}>
                        <Text style={st.qtyBtnTxt}>−</Text>
                    </TouchableOpacity>
                    <View style={st.qtyPill}>
                        <Text style={st.qtyPillTxt}>{quantity}</Text>
                    </View>
                    <TouchableOpacity style={st.qtyBtn} onPress={() => onQtyInc?.(item)} activeOpacity={0.7}>
                        <Text style={st.qtyBtnTxt}>+</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <TouchableOpacity
                    style={[st.addBtn, !canOrder && st.addBtnDisabled]}
                    onPress={() => canOrder && onAddToOrder?.(item)}
                    disabled={!canOrder}
                    activeOpacity={0.85}
                >
                    <Text style={[st.addBtnTxt, !canOrder && st.addBtnTxtDisabled]}>
                        {item?.is_available ? 'Add' : 'Not available'}
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    );
};

// ── Collapsible section card ──────────────────────────────────────────────────
const SectionCard = ({ section, items, onAddToOrder, onQtyDec, onQtyInc, orderItems, apiUrl, userType, defaultExpanded = true }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    if (!items.length) return null;

    return (
        <View style={st.sectionCard}>
            <TouchableOpacity
                style={[st.sectionHeader, { backgroundColor: section.color }]}
                onPress={() => setExpanded(!expanded)}
                activeOpacity={0.8}
            >
                <View>
                    <Text style={[st.sectionTitle, { color: section.textColor }]}>{section.label}</Text>
                    <Text style={[st.sectionSub,   { color: section.textColor }]}>{section.subtitle}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={[st.sectionCount, { borderColor: section.textColor }]}>
                        <Text style={[st.sectionCountTxt, { color: section.textColor }]}>
                            {items.length + ' item' + (items.length !== 1 ? 's' : '')}
                        </Text>
                    </View>
                    <Octicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={section.textColor} />
                </View>
            </TouchableOpacity>
            {expanded ? (
                <View style={st.sectionBody}>
                    {items.map(item => (
                        <MenuItemCard
                            key={item.id}
                            item={item}
                            onAddToOrder={onAddToOrder}
                            onQtyDec={onQtyDec}
                            onQtyInc={onQtyInc}
                            apiUrl={apiUrl}
                            userType={userType}
                            quantity={orderItems.find(o => o.id === item.id)?.quantity || 0}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
};

// ── Main screen ───────────────────────────────────────────────────────────────
export default function ChefMenu() {
    const { id } = useLocalSearchParams();
    const router  = useRouter();
    const insets  = useSafeAreaInsets();
    const { token, userId, profileId, userType, sessionId } = useAuth();
    const {
        cartReady,
        activeChefId,
        orderItems,
        setActiveChefId,
        updateOrderItems,
        clearActiveCart,
    } = useCart();

    const startTimeRef = useRef(null);

    useFocusEffect(
        useCallback(() => {
            startTimeRef.current = Date.now();
            return () => {
                if (startTimeRef.current && userType === 'customer') {
                    const timeSpentMs = Date.now() - startTimeRef.current;
                    const timeSpentSeconds = Math.round(timeSpentMs / 1000);
                    if (timeSpentSeconds >= 30) {
                        logAppEvent({
                            token: token,
                            eventCategory: 'navigation',
                            eventAction: 'view_chef_menu',
                            actorType: userType,
                            actorId: profileId,
                            sessionId: sessionId,
                            eventData: { viewed_chef_id: parseInt(id, 10), time_spent_seconds: timeSpentSeconds }
                        });
                    }
                }
            };
        }, [id, token, profileId, userType, sessionId])
    );

    const { apiUrl } = getEnvVars();

    const [chefData,     setChefData]     = useState(null);
    const [menuItems,    setMenuItems]    = useState([]);
    const [featuredItems,setFeaturedItems]= useState([]);
    const [loading,      setLoading]      = useState(true);
    const [showOrderModal, setShowOrderModal] = useState(false);
    const [showCartDrawer, setShowCartDrawer] = useState(false);
    const [drawerTab, setDrawerTab] = useState('draft');
    const [recentOrders, setRecentOrders] = useState([]);
    const [recentOrdersLoading, setRecentOrdersLoading] = useState(false);

    const defaults = getDefaultBookingDate();
    const [selectedMonth,  setSelectedMonth]  = useState(defaults.month);
    const [selectedDay,    setSelectedDay]    = useState(defaults.day);
    const [selectedYear,   setSelectedYear]   = useState(defaults.year);
    const [selectedHour,   setSelectedHour]   = useState(defaults.hour);
    const [selectedMinute, setSelectedMinute] = useState(defaults.minute);

    const [paymentMethods,        setPaymentMethods]        = useState([]);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
    const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
    const [paymentProcessing,     setPaymentProcessing]     = useState(false);
    const [pricingQuote,          setPricingQuote]          = useState(null);
    const [pricingLoading,        setPricingLoading]        = useState(false);
    const [eventZip,              setEventZip]              = useState('');
    const hasShownSurgeAlertRef = useRef(false);

    const now = new Date();
    const currentYear  = now.getFullYear();
    const isCurrentYear  = selectedYear  === currentYear;
    const isCurrentMonth = isCurrentYear && selectedMonth === now.getMonth();
    const isToday        = isCurrentMonth && selectedDay  === now.getDate();
    const minMonth = isCurrentYear ? now.getMonth() : 0;
    const minDay   = isCurrentMonth ? now.getDate()  : 1;
    const minHour  = isToday ? now.getHours() + 1   : 0;
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();

    const handleMonthDec = () => {
        if (selectedMonth <= minMonth && isCurrentYear) return;
        const m = selectedMonth - 1;
        setSelectedMonth(m);
        const max = new Date(selectedYear, m + 1, 0).getDate();
        if (selectedDay > max) setSelectedDay(max);
    };
    const handleMonthInc = () => {
        if (selectedMonth >= 11) return;
        const m = selectedMonth + 1;
        setSelectedMonth(m);
        const max = new Date(selectedYear, m + 1, 0).getDate();
        if (selectedDay > max) setSelectedDay(max);
    };
    const handleDayDec  = () => { if (selectedDay   > minDay)       setSelectedDay(selectedDay - 1); };
    const handleDayInc  = () => { if (selectedDay   < daysInMonth)  setSelectedDay(selectedDay + 1); };
    const handleYearDec = () => { if (selectedYear  > currentYear)  setSelectedYear(selectedYear - 1); };
    const handleYearInc = () => { if (selectedYear  < currentYear+2) setSelectedYear(selectedYear + 1); };
    const handleHourDec = () => { if (selectedHour  > minHour)      setSelectedHour(selectedHour - 1); };
    const handleHourInc = () => { if (selectedHour  < 23)           setSelectedHour(selectedHour + 1); };
    const handleMinDec  = () => {
        const mins = [0,15,30,45]; const i = mins.indexOf(selectedMinute);
        if (i > 0) setSelectedMinute(mins[i-1]);
    };
    const handleMinInc  = () => {
        const mins = [0,15,30,45]; const i = mins.indexOf(selectedMinute);
        if (i < 3) setSelectedMinute(mins[i+1]);
    };

    useEffect(() => {
        if (!id) return;
        const chefId = parseInt(id, 10);
        const fetchData = async () => {
            setLoading(true);
            try {
                const [profileRes, menuRes, featuredRes] = await Promise.all([
                    fetch(`${apiUrl}/profile/chef/${chefId}/public`,    { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } }),
                    fetch(`${apiUrl}/api/menu/chef/${chefId}`,          { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } }),
                    fetch(`${apiUrl}/api/menu/chef/${chefId}/featured`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } }),
                ]);
                const [profileData, menuData, featuredData] = await Promise.all([
                    profileRes.json(), menuRes.json(), featuredRes.json(),
                ]);
                if (profileRes.ok)  setChefData(profileData.profile);
                if (menuRes.ok)     setMenuItems(menuData.menu_items    || []);
                if (featuredRes.ok) setFeaturedItems(featuredData.featured_items || []);
            } catch { Alert.alert('Error', 'Network error. Could not load menu.'); }
            finally { setLoading(false); }
        };
        fetchData();
    }, [id, apiUrl, token]);

    useEffect(() => {
        if (!id) return;
        setActiveChefId(String(id));

        return () => {
            setActiveChefId(null);
        };
    }, [id, setActiveChefId]);

    const itemsBySection = useMemo(() => {
        const grouped = {};
        FIXED_SECTIONS.forEach(sec => { grouped[sec.id] = []; });
        grouped['other'] = [];
        menuItems.forEach(item => {
            const sec = getSectionForItem(item);
            if (sec) grouped[sec.id].push(item);
            else     grouped['other'].push(item);
        });
        return grouped;
    }, [menuItems]);

    const handleAddToOrder = (item) => {
        if (!item.is_available) { Alert.alert('Not Available', 'This dish is currently unavailable.'); return; }
        logAppEvent({
            token: token,
            eventCategory: 'interaction',
            eventAction: 'add_to_cart',
            actorType: userType,
            actorId: profileId,
            sessionId: sessionId,
            eventData: { dish_name: item.dish_name, price: item.price, chef_id: id }
        });
        updateOrderItems((currentItems) => {
            const existing = currentItems.find((o) => o.id === item.id);
            if (existing) return currentItems.map((o) => o.id === item.id ? { ...o, quantity: o.quantity + 1 } : o);
            return [...currentItems, { ...item, quantity: 1 }];
        });
    };

    const handleQtyDec = (item) => {
        updateOrderItems((currentItems) => {
            const current = currentItems.find((o) => o.id === item.id);
            if (!current) return currentItems;
            if (current.quantity > 1) {
                return currentItems.map((o) => o.id === item.id ? { ...o, quantity: o.quantity - 1 } : o);
            }
            return currentItems.filter((o) => o.id !== item.id);
        });
    };
    const handleQtyInc = (item) => {
        updateOrderItems((currentItems) => currentItems.map((o) => o.id === item.id ? { ...o, quantity: o.quantity + 1 } : o));
    };

    const fetchRecentOrders = useCallback(async () => {
        if (!profileId || userType !== 'customer') return;
        setRecentOrdersLoading(true);
        try {
            const res = await fetch(`${apiUrl}/booking/customer/${profileId}/dashboard`, {
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (res.ok) {
                const dashboard = data.data || {};
                const combined = [
                    ...(dashboard.upcoming_bookings || []),
                    ...(dashboard.todays_bookings || []),
                    ...(dashboard.previous_bookings || []),
                ].sort((a, b) => {
                    const aDate = new Date(`${a.booking_date || '1970-01-01'}T${a.booking_time || '00:00:00'}`);
                    const bDate = new Date(`${b.booking_date || '1970-01-01'}T${b.booking_time || '00:00:00'}`);
                    return bDate - aDate;
                });
                setRecentOrders(combined);
            }
        } catch {
            setRecentOrders([]);
        } finally {
            setRecentOrdersLoading(false);
        }
    }, [apiUrl, profileId, token, userType]);

    const fetchPaymentMethods = async () => {
        const uid = userId || profileId;
        if (!uid) return;
        setLoadingPaymentMethods(true);
        try {
            const res  = await fetch(`${apiUrl}/stripe-payment/payment-methods?customer_id=${uid}`, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
            const data = await res.json();
            if (res.ok) {
                setPaymentMethods(data.payment_methods || []);
                const def = data.payment_methods?.find(pm => pm.is_default);
                if (def) setSelectedPaymentMethod(def.id);
            }
        } catch {} finally { setLoadingPaymentMethods(false); }
    };

    useEffect(() => { if (showOrderModal && userType === 'customer') fetchPaymentMethods(); }, [showOrderModal]);
    useEffect(() => {
        if (showCartDrawer && userType === 'customer') fetchRecentOrders();
    }, [showCartDrawer, userType, fetchRecentOrders]);
    useEffect(() => { if (chefData?.public_location) setEventZip(parseZipFromLocation(chefData.public_location)); }, [chefData?.public_location]);

    const mealConflicts = useMemo(() => {
        const bookingTime = new Date(selectedYear, selectedMonth, selectedDay, selectedHour, selectedMinute);
        return getCartConflicts(orderItems, bookingTime);
    }, [orderItems, selectedHour, selectedYear, selectedMonth, selectedDay, selectedMinute]);

    const currentMealType = getMealTypeForHour(selectedHour);

    useEffect(() => {
        if (!showOrderModal || !orderItems.length || !eventZip || !profileId) return;
        const eventDate = new Date(selectedYear, selectedMonth, selectedDay, selectedHour, selectedMinute);
        const basePrice = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        if (!basePrice || isNaN(basePrice)) return;
        let isMounted = true;
        const tid = setTimeout(async () => {
            setPricingLoading(true);
            try {
                const res  = await fetch(`${apiUrl}/api/v1/pricing/quote`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ base_price: Number(basePrice.toFixed(2)), event_date: eventDate.toISOString(), location_zip: eventZip, chef_id: Number(id), customer_id: profileId }),
                });
                const data = await res.json();
                if (!isMounted) return;
                if (res.ok && data?.quote) {
                    setPricingQuote(data.quote);
                    if (Number(data.quote.multiplier) > 1.0 && !hasShownSurgeAlertRef.current) {
                        hasShownSurgeAlertRef.current = true;
                        const fee = Math.max(0, Number(data.quote.final_price || basePrice) - basePrice);
                        Alert.alert('High Demand Pricing', `Rush fee of $${fee.toFixed(2)} applied.`);
                    }
                    if (Number(data.quote.multiplier) <= 1.0) hasShownSurgeAlertRef.current = false;
                }
            } catch {}
            finally { if (isMounted) setPricingLoading(false); }
        }, 350);
        return () => { isMounted = false; clearTimeout(tid); };
    }, [showOrderModal, selectedYear, selectedMonth, selectedDay, selectedHour, selectedMinute, eventZip, orderItems]);

    const handlePlaceOrder = async () => {
        if (!selectedPaymentMethod) { Alert.alert('Payment Required', 'Please select a payment method.'); return; }
        const selected = new Date(selectedYear, selectedMonth, selectedDay, selectedHour, selectedMinute);
        if (selected <= new Date()) { Alert.alert('Invalid Date', 'Please select a future date and time.'); return; }
        if (mealConflicts.length > 0) {
            const lines = mealConflicts.map(c => '• ' + c.item.dish_name + ': ' + c.mealType + ' only (' + c.allowedLabel + ')').join('\n');
            Alert.alert('Meal Time Mismatch', 'Some items can\'t be served at this time:\n\n' + lines + '\n\nAdjust your booking time or remove the conflicting items.');
            return;
        }
        setPaymentProcessing(true);
        try {
            const baseTotal    = orderItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const quoteMult    = Number(pricingQuote?.multiplier || 1);
            const dynamicTotal = Number(pricingQuote?.final_price || baseTotal);
            const payableTotal = dynamicTotal > 0 ? dynamicTotal : baseTotal;

            const bookRes  = await fetch(`${apiUrl}/booking/create`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    customer_id: profileId, cuisine_type: orderItems[0]?.cuisine_type || 'Mixed',
                    meal_type: currentMealType, event_type: 'dinner',
                    booking_date: selected.toISOString().split('T')[0],
                    booking_time: selected.toTimeString().split(' ')[0].substring(0, 5),
                    produce_supply: 'chef', number_of_people: orderItems.reduce((s, i) => s + i.quantity, 0),
                    base_price: Number(baseTotal.toFixed(2)), dynamic_price: Number(payableTotal.toFixed(2)),
                    pricing_multiplier: Number(quoteMult.toFixed(2)), pricing_features: pricingQuote?.features_logged || {},
                    total_cost: Number(payableTotal.toFixed(2)),
                    special_notes: 'Order: ' + orderItems.map(i => i.dish_name + ' (x' + i.quantity + ')').join(', ') + '. Total: $' + payableTotal.toFixed(2) + '.',
                    menu_item_ids: orderItems.map(i => i.id),
                }),
            });
            const bookResult = await bookRes.json();
            if (!bookRes.ok) { Alert.alert('Booking Error', bookResult.error || 'Booking failed.'); setPaymentProcessing(false); return; }

            const chefRes  = await fetch(`${apiUrl}/booking/book-chef`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ booking_id: bookResult.booking_id, chef_id: parseInt(id, 10) }),
            });
            const chefResult = await chefRes.json();
            if (!chefRes.ok) { Alert.alert('Booking Error', chefResult.error || 'Chef booking failed.'); setPaymentProcessing(false); return; }

            const payRes  = await fetch(`${apiUrl}/stripe-payment/create-payment-intent`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ booking_id: bookResult.booking_id, customer_id: userId || profileId, payment_method_id: selectedPaymentMethod, event_zip: eventZip }),
            });
            const payData = await payRes.json();
            if (payRes.status === 403) { Alert.alert('Transaction Declined', 'Flagged for suspicious activity. Contact support.'); setPaymentProcessing(false); return; }
            if (!payRes.ok) { Alert.alert('Payment Failed', payData.error || 'Payment failed.'); setPaymentProcessing(false); return; }

            setShowOrderModal(false);
            setPaymentProcessing(false);
            const card = paymentMethods.find(pm => pm.id === selectedPaymentMethod);

            logAppEvent({
                token: token,
                eventCategory: 'transaction',
                eventAction: 'checkout_success',
                actorType: userType,
                actorId: profileId,
                sessionId: sessionId,
                eventData: { booking_id: bookResult.booking_id, total_paid: payableTotal.toFixed(2), item_count: orderItems.length, surge_multiplier: quoteMult }
            });

            Alert.alert('Booking Confirmed! 🎉',
                'Booking #' + bookResult.booking_id + '\nAmount: $' + payableTotal.toFixed(2) + '\nCard: ' + card?.brand?.toUpperCase() + ' •••• ' + card?.last4 + '\nDate: ' + selected.toLocaleString('en-US'),
                [{ text: 'OK', onPress: () => { clearActiveCart(); setSelectedPaymentMethod(null); } }]
            );
        } catch { Alert.alert('Error', 'Network error.'); setPaymentProcessing(false); }
    };

    const orderTotal    = orderItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
    const quoteFinal    = Number(pricingQuote?.final_price || orderTotal);
    const quoteMult     = Number(pricingQuote?.multiplier  || 1);
    const rushFee       = Math.max(0, quoteFinal - orderTotal);
    const formattedDT   = MONTHS_SHORT[selectedMonth] + ' ' + String(selectedDay).padStart(2,'0') + ', ' + selectedYear + '  ' + String(selectedHour).padStart(2,'0') + ':' + String(selectedMinute).padStart(2,'00');
    const selectedItemCount = orderItems.reduce((sum, item) => sum + item.quantity, 0);

    if (loading || !cartReady) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[st.screen, { justifyContent: 'center', alignItems: 'center' }]}>
                    <LoadingIcon message="Loading Chef Menu..." />
                </View>
            </>
        );
    }

    return (
        <>
            <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: BG } }} />
            <View style={st.screen}>
            <ScrollView style={st.screen} contentContainerStyle={{ paddingTop: insets.top + 10, padding: 20, paddingBottom: orderItems.length > 0 ? 170 : 40 }}>

                <View style={st.topNavRow}>
                    <TouchableOpacity style={st.backPill} onPress={() => router.back()} activeOpacity={0.85}>
                        <Octicons name="chevron-left" size={18} color={GREEN} />
                        <Text style={st.backPillTxt}>Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={st.cartBtn} onPress={() => setShowCartDrawer(true)} activeOpacity={0.85}>
                        <Feather name="shopping-bag" size={18} color={GREEN} />
                        {selectedItemCount > 0 ? (
                            <View style={st.cartBadge}>
                                <Text style={st.cartBadgeTxt}>{selectedItemCount}</Text>
                            </View>
                        ) : null}
                    </TouchableOpacity>
                </View>

                <View style={st.titleBlock}>
                    <Text style={st.menuTitle}>Chef's Specialty Menu</Text>
                    <Text style={st.menuSubtitle}>Select dishes, adjust quantities, then review your booking.</Text>
                </View>

                {/* Chef header */}
                <View style={st.chefHeader}>
                    <View style={st.chefHeaderTop}>
                        <View style={{ flex: 1 }}>
                            <Text style={st.chefName}>{(chefData?.first_name || '') + ' ' + (chefData?.last_name || '')}</Text>
                            {chefData?.meal_timings?.length > 0 ? (
                                <Text style={st.chefAvail}>{'Available: ' + chefData.meal_timings.join(', ')}</Text>
                            ) : null}
                        </View>
                        <ProfilePicture photoUrl={chefData?.photo_url} firstName={chefData?.first_name} lastName={chefData?.last_name} size={18} />
                    </View>
                    <View style={st.chefHeaderBottom}>
                        <RatingsDisplay rating={chefData?.average_rating} />
                        {chefData?.cuisines?.length > 0 ? (
                            <View style={st.cuisineRow}>
                                {chefData.cuisines.slice(0, 4).map((c, i) => (
                                    <View key={i} style={st.cuisineTag}>
                                        <Text style={st.cuisineTagTxt}>{c}</Text>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                        <Text style={st.lastUpdated}>{'Last Updated: ' + (chefData?.member_since || '')}</Text>
                    </View>
                </View>

                {/* Featured dishes */}
                {featuredItems.length > 0 ? (
                    <View style={st.sectionCard}>
                        <TouchableOpacity style={[st.sectionHeader, { backgroundColor: '#fff' }]} activeOpacity={1}>
                            <View>
                                <Text style={[st.sectionTitle, { color: TEXT }]}>⭐ Featured Dishes</Text>
                            </View>
                            <View style={[st.sectionCount, { borderColor: TEXT_SOFT }]}>
                                <Text style={[st.sectionCountTxt, { color: TEXT_SOFT }]}>
                                    {featuredItems.length + ' item' + (featuredItems.length !== 1 ? 's' : '')}
                                </Text>
                            </View>
                        </TouchableOpacity>
                        <View style={st.sectionBody}>
                            {featuredItems.map(item => (
                                <MenuItemCard key={item.id} item={item} onAddToOrder={handleAddToOrder} onQtyDec={handleQtyDec} onQtyInc={handleQtyInc} apiUrl={apiUrl} userType={userType} quantity={orderItems.find(o => o.id === item.id)?.quantity || 0} />
                            ))}
                        </View>
                    </View>
                ) : null}

                {/* 4 fixed sections */}
                {FIXED_SECTIONS.map((section, idx) => (
                    <SectionCard
                        key={section.id}
                        section={section}
                        items={itemsBySection[section.id] || []}
                        onAddToOrder={handleAddToOrder}
                        onQtyDec={handleQtyDec}
                        onQtyInc={handleQtyInc}
                        orderItems={orderItems}
                        apiUrl={apiUrl}
                        userType={userType}
                        defaultExpanded={idx === 0}
                    />
                ))}

                {/* Other / uncategorised */}
                {itemsBySection['other']?.length > 0 ? (
                    <SectionCard
                        section={{ id: 'other', label: 'Other Dishes', subtitle: 'Various', color: '#f8faf8', textColor: TEXT_MID }}
                        items={itemsBySection['other']}
                        onAddToOrder={handleAddToOrder}
                        onQtyDec={handleQtyDec}
                        onQtyInc={handleQtyInc}
                        orderItems={orderItems}
                        apiUrl={apiUrl}
                        userType={userType}
                        defaultExpanded={false}
                    />
                ) : null}

                {/* ── Booking modal ── */}
                <Modal visible={showOrderModal} transparent animationType="slide" onRequestClose={() => setShowOrderModal(false)}>
                    <View style={st.modalOverlay}>
                        <View style={st.modalCard}>
                            <View style={st.modalHeader}>
                                <Text style={st.modalTitle}>Place Booking</Text>
                                <TouchableOpacity onPress={() => setShowOrderModal(false)} style={st.modalCloseBtn}>
                                    <Octicons name="x" size={18} color={GREEN} />
                                </TouchableOpacity>
                            </View>

                            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>

                                {/* Summary */}
                                <View style={st.modalSection}>
                                    <Text style={st.modalSectionLabel}>Booking Summary</Text>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                                        <Text style={st.modalTxt}>{'Items: ' + orderItems.length}</Text>
                                        <Text style={[st.modalTxt, { fontWeight: '700', color: GREEN }]}>{'$' + quoteFinal.toFixed(2)}</Text>
                                    </View>
                                    {quoteMult > 1.0 ? (
                                        <View style={st.surgeBadge}>
                                            <Text style={st.surgeBadgeTxt}>{'⚡ High Demand: +$' + rushFee.toFixed(2) + ' rush fee'}</Text>
                                        </View>
                                    ) : null}
                                    {pricingLoading ? <Text style={[st.modalTxt, { marginTop: 6, color: TEXT_SOFT }]}>Refreshing price...</Text> : null}
                                </View>

                                {/* Date/time display */}
                                <View style={[st.modalSection, { backgroundColor: GREEN_LIGHT, borderColor: GREEN }]}>
                                    <Text style={st.modalSectionLabel}>Selected Date & Time</Text>
                                    <Text style={{ fontSize: 16, fontWeight: '700', color: GREEN, marginTop: 4 }}>{formattedDT}</Text>
                                    <Text style={{ fontSize: 12, color: TEXT_MID, marginTop: 4 }}>{'Meal time: ' + currentMealType}</Text>
                                </View>

                                {/* Conflict banner */}
                                {mealConflicts.length > 0 ? (
                                    <View style={st.conflictBanner}>
                                        <Octicons name="alert" size={15} color="#92400e" />
                                        <View style={{ flex: 1 }}>
                                            <Text style={st.conflictTitle}>Meal Time Mismatch</Text>
                                            {mealConflicts.map((c, i) => (
                                                <Text key={i} style={st.conflictItem}>{'• ' + c.item.dish_name + ' → ' + c.mealType + ' only (' + c.allowedLabel + ')'}</Text>
                                            ))}
                                            <Text style={st.conflictHint}>Adjust the hour or remove the conflicting item.</Text>
                                        </View>
                                    </View>
                                ) : null}

                                {/* Date steppers */}
                                <View style={st.modalSection}>
                                    <Text style={st.modalSectionLabel}>Booking Date</Text>
                                    <View style={st.stepperGroup}>
                                        <Stepper label="Month"  value={MONTHS_SHORT[selectedMonth]}          onDecrement={handleMonthDec} onIncrement={handleMonthInc} />
                                        <View style={st.stepperDivider} />
                                        <Stepper label="Day"    value={String(selectedDay).padStart(2,'0')}   onDecrement={handleDayDec}   onIncrement={handleDayInc}   />
                                        <View style={st.stepperDivider} />
                                        <Stepper label="Year"   value={String(selectedYear)}                  onDecrement={handleYearDec}  onIncrement={handleYearInc}  />
                                    </View>
                                </View>

                                {/* Time steppers */}
                                <View style={st.modalSection}>
                                    <Text style={st.modalSectionLabel}>Time</Text>
                                    <View style={st.stepperGroup}>
                                        <Stepper label="Hour"   value={String(selectedHour).padStart(2,'0')}   onDecrement={handleHourDec}  onIncrement={handleHourInc}  />
                                        <View style={st.stepperDivider} />
                                        <Stepper label="Minute" value={String(selectedMinute).padStart(2,'00')} onDecrement={handleMinDec}   onIncrement={handleMinInc}   />
                                    </View>
                                </View>

                                {/* ZIP */}
                                <View style={st.modalSection}>
                                    <Text style={st.modalSectionLabel}>Event Location ZIP</Text>
                                    <TextInput value={eventZip} onChangeText={setEventZip} placeholder="e.g. 10001" keyboardType="number-pad" maxLength={5} style={st.zipInput} placeholderTextColor={TEXT_SOFT} />
                                </View>

                                {/* Payment */}
                                <View style={st.modalSection}>
                                    <Text style={st.modalSectionLabel}>Payment Method</Text>
                                    {loadingPaymentMethods ? (
                                        <LoadingIcon icon="spinner" size={40} message="" />
                                    ) : paymentMethods.length === 0 ? (
                                        <View>
                                            <Text style={[st.modalTxt, { textAlign: 'center', marginBottom: 8 }]}>No payment methods saved</Text>
                                            <TouchableOpacity style={st.returnBtn} onPress={() => { setShowOrderModal(false); router.push('/(tabs)/Profile'); }}>
                                                <Text style={st.returnBtnTxt}>Add Card in Profile</Text>
                                            </TouchableOpacity>
                                        </View>
                                    ) : (
                                        paymentMethods.map(method => (
                                            <TouchableOpacity key={method.id} onPress={() => setSelectedPaymentMethod(method.id)} style={[st.paymentRow, selectedPaymentMethod === method.id && st.paymentRowSelected]}>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={st.paymentCardNum}>{method.brand.toUpperCase() + ' •••• ' + method.last4}</Text>
                                                    <Text style={st.paymentCardMeta}>{'Expires ' + method.exp_month + '/' + method.exp_year}</Text>
                                                </View>
                                                <View style={[st.radio, selectedPaymentMethod === method.id && st.radioSelected]}>
                                                    {selectedPaymentMethod === method.id ? <View style={st.radioDot} /> : null}
                                                </View>
                                            </TouchableOpacity>
                                        ))
                                    )}
                                </View>

                                {/* Actions */}
                                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                                    <TouchableOpacity style={[st.returnBtn, { flex: 1 }]} onPress={() => setShowOrderModal(false)} disabled={paymentProcessing}>
                                        <Text style={st.returnBtnTxt}>Cancel</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[st.placeOrderBtn, { flex: 1, marginTop: 0 }, (paymentProcessing || !paymentMethods.length || mealConflicts.length > 0) && { backgroundColor: '#c8ddd0' }]}
                                        onPress={handlePlaceOrder}
                                        disabled={paymentProcessing || !paymentMethods.length || mealConflicts.length > 0}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={st.placeOrderBtnTxt}>{paymentProcessing ? 'Processing...' : 'Confirm & Pay'}</Text>
                                    </TouchableOpacity>
                                </View>

                            </ScrollView>
                        </View>
                    </View>
                </Modal>
            </ScrollView>
            {orderItems.length > 0 ? (
                <View style={[st.stickyBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                    <View>
                        <Text style={st.stickyBarTitle}>{selectedItemCount} item{selectedItemCount !== 1 ? 's' : ''} selected</Text>
                        <Text style={st.stickyBarSub}>{'$' + orderTotal.toFixed(2)} estimated subtotal</Text>
                    </View>
                    <TouchableOpacity style={st.reviewBtn} onPress={() => setShowOrderModal(true)} activeOpacity={0.85}>
                        <Text style={st.reviewBtnTxt}>Proceed to Checkout</Text>
                    </TouchableOpacity>
                </View>
            ) : null}

            <Modal visible={showCartDrawer} transparent animationType="fade" onRequestClose={() => setShowCartDrawer(false)}>
                <View style={st.drawerOverlay}>
                    <Pressable style={st.drawerBackdrop} onPress={() => setShowCartDrawer(false)} />
                    <View style={st.drawerCard}>
                        <View style={st.drawerHandle} />
                        <View style={st.drawerHeader}>
                            <Text style={st.drawerTitle}>Cart & Orders</Text>
                            <TouchableOpacity onPress={() => setShowCartDrawer(false)} style={st.modalCloseBtn}>
                                <Octicons name="x" size={18} color={GREEN} />
                            </TouchableOpacity>
                        </View>

                        <View style={st.drawerTabs}>
                            {[
                                { key: 'draft', label: 'Current Items' },
                                { key: 'recent', label: 'Recent Orders' },
                            ].map(tab => (
                                <TouchableOpacity key={tab.key} onPress={() => setDrawerTab(tab.key)} style={[st.drawerTab, drawerTab === tab.key && st.drawerTabActive]}>
                                    <Text style={[st.drawerTabTxt, drawerTab === tab.key && st.drawerTabTxtActive]}>{tab.label}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {drawerTab === 'draft' ? (
                            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 8 }}>
                                {orderItems.length > 0 ? orderItems.map((item) => (
                                    <View key={item.id} style={st.drawerItemRow}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={st.drawerItemTitle}>{item.dish_name}</Text>
                                            <Text style={st.drawerItemMeta}>{'$' + Number(item.price).toFixed(2)} each</Text>
                                        </View>
                                        <View style={st.drawerQtyControls}>
                                            <TouchableOpacity style={st.qtyBtn} onPress={() => handleQtyDec(item)} activeOpacity={0.7}><Text style={st.qtyBtnTxt}>−</Text></TouchableOpacity>
                                            <View style={st.qtyPill}><Text style={st.qtyPillTxt}>{item.quantity}</Text></View>
                                            <TouchableOpacity style={st.qtyBtn} onPress={() => handleQtyInc(item)} activeOpacity={0.7}><Text style={st.qtyBtnTxt}>+</Text></TouchableOpacity>
                                        </View>
                                    </View>
                                )) : (
                                    <View style={st.emptyDraftCard}>
                                        <Text style={st.emptyTxt}>Your cart is empty.</Text>
                                    </View>
                                )}

                                <View style={st.summaryCard}>
                                    <View style={st.summaryRow}><Text style={st.summaryLabel}>Selected items</Text><Text style={st.summaryValue}>{selectedItemCount}</Text></View>
                                    <View style={st.summaryRow}><Text style={st.summaryLabel}>Subtotal</Text><Text style={st.summaryValue}>{'$' + orderTotal.toFixed(2)}</Text></View>
                                    <View style={st.summaryRow}><Text style={st.summaryLabel}>Estimated total</Text><Text style={[st.summaryValue, { color: GREEN }]}>{'$' + quoteFinal.toFixed(2)}</Text></View>
                                </View>

                                <TouchableOpacity style={st.reviewBtn} onPress={() => { setShowCartDrawer(false); setShowOrderModal(true); }} activeOpacity={0.85}>
                                    <Text style={st.reviewBtnTxt}>Proceed to Checkout</Text>
                                </TouchableOpacity>
                            </ScrollView>
                        ) : (
                            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 8 }}>
                                {recentOrdersLoading ? (
                                    <View style={st.emptyDraftCard}><Text style={st.emptyTxt}>Loading recent orders...</Text></View>
                                ) : recentOrders.length > 0 ? recentOrders.map((order) => (
                                    <View key={order.booking_id} style={st.recentOrderCard}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={st.drawerItemTitle}>{'Order #' + order.booking_id}</Text>
                                            <Text style={st.drawerItemMeta}>{order.chef_name || (chefData?.first_name || '') + ' ' + (chefData?.last_name || '')}</Text>
                                            <Text style={st.drawerItemMeta}>{formatBookingDate(order.booking_date, order.booking_time)}</Text>
                                        </View>
                                        <View style={st.statusPill}><Text style={st.statusPillTxt}>{formatRecentStatus(order.status || 'completed')}</Text></View>
                                    </View>
                                )) : (
                                    <View style={st.emptyDraftCard}><Text style={st.emptyTxt}>No recent orders found.</Text></View>
                                )}
                                <TouchableOpacity style={st.secondaryLinkBtn} onPress={() => { setShowCartDrawer(false); router.push('/(tabs)/BookingsScreen'); }} activeOpacity={0.85}>
                                    <Text style={st.secondaryLinkTxt}>Open Bookings</Text>
                                </TouchableOpacity>
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal>
            </View>
        </>
    );
}

const st = StyleSheet.create({
    screen:           { flex: 1, backgroundColor: BG },
    chefHeader:       { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
    chefHeaderTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 12 },
    chefName:         { fontSize: 22, fontWeight: '800', color: TEXT, letterSpacing: -0.5 },
    chefAvail:        { fontSize: 13, color: TEXT_SOFT, marginTop: 3 },
    chefHeaderBottom: { padding: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: BORDER },
    cuisineRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    cuisineTag:       { backgroundColor: GREEN_LIGHT, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    cuisineTagTxt:    { fontSize: 12, fontWeight: '600', color: GREEN },
    lastUpdated:      { fontSize: 12, color: TEXT_SOFT, marginTop: 8 },
    sectionCard:      { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 14, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
    sectionHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
    sectionTitle:     { fontSize: 16, fontWeight: '800' },
    sectionSub:       { fontSize: 12, fontWeight: '500', marginTop: 2, opacity: 0.85 },
    sectionCount:     { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
    sectionCountTxt:  { fontSize: 12, fontWeight: '700' },
    sectionBody:      { padding: 12 },
    menuCard:         { backgroundColor: '#f8faf8', borderRadius: 12, borderWidth: 1, borderColor: BORDER, marginBottom: 10, padding: 12 },
    menuCardSelected: { borderColor: GREEN, backgroundColor: '#f3fbf5', shadowColor: GREEN, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
    selectedBadge:    { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8 },
    selectedBadgeTxt: { fontSize: 11, fontWeight: '700', color: GREEN },
    menuItemName:     { fontSize: 15, fontWeight: '700', color: TEXT, textAlign: 'center', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 8 },
    mealBadge:        { alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, marginBottom: 8 },
    mealBadgeTxt:     { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
    menuItemBody:     { flexDirection: 'row', marginBottom: 8 },
    menuItemDesc:     { fontSize: 13, color: TEXT_MID, lineHeight: 18, marginBottom: 4 },
    menuItemMeta:     { fontSize: 12, color: TEXT_SOFT, marginBottom: 2 },
    menuItemImage:    { width: 120, height: 110, borderRadius: 10 },
    menuItemImageEmpty:   { backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center' },
    menuItemImageEmptyTxt:{ fontSize: 12, color: GREEN, fontWeight: '600' },
    menuItemFooter:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: BORDER, marginBottom: 10 },
    menuItemFooterMeta:{ fontSize: 12, color: TEXT_SOFT },
    menuItemPrice:    { fontSize: 18, fontWeight: '800', color: GREEN },
    addBtn:           { backgroundColor: GREEN, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
    addBtnDisabled:   { backgroundColor: '#e2ece2' },
    addBtnTxt:        { color: '#fff', fontWeight: '700', fontSize: 14 },
    addBtnTxtDisabled:{ color: TEXT_SOFT },
    itemActionRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    emptyCard:        { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 32, alignItems: 'center' },
    emptyTxt:         { fontSize: 14, color: TEXT_SOFT },
    orderRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
    orderItemName:    { fontSize: 14, fontWeight: '600', color: TEXT },
    orderItemMeta:    { fontSize: 12, color: TEXT_SOFT, marginTop: 2 },
    qtyRow:           { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 10 },
    qtyBtn:           { width: 34, height: 34, borderRadius: 17, backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
    qtyBtnTxt:        { fontSize: 20, fontWeight: '700', color: GREEN, lineHeight: 24 },
    qtyPill:          { minWidth: 34, minHeight: 28, paddingHorizontal: 10, borderRadius: 999, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
    qtyPillTxt:       { fontSize: 14, fontWeight: '700', color: '#fff' },
    qtyTxt:           { fontSize: 16, fontWeight: '700', color: TEXT, minWidth: 22, textAlign: 'center' },
    orderItemTotal:   { fontSize: 14, fontWeight: '700', color: GREEN, minWidth: 52, textAlign: 'right' },
    orderTotalRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 4 },
    orderTotalLabel:  { fontSize: 16, fontWeight: '700', color: TEXT },
    orderTotalAmt:    { fontSize: 20, fontWeight: '800', color: GREEN },
    placeOrderBtn:    { backgroundColor: GREEN, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 12, shadowColor: GREEN, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3 },
    placeOrderBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
    returnBtn:        { paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: BORDER, backgroundColor: '#fff' },
    returnBtnTxt:     { color: TEXT_MID, fontWeight: '600', fontSize: 14 },
    topNavRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    backPill:         { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
    backPillTxt:      { fontSize: 13, fontWeight: '700', color: GREEN },
    cartBtn:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, position: 'relative' },
    cartBadge:        { position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' },
    cartBadgeTxt:     { fontSize: 11, color: '#fff', fontWeight: '800' },
    titleBlock:       { marginBottom: 12 },
    menuTitle:        { fontSize: 20, fontWeight: '900', color: TEXT, letterSpacing: -0.4 },
    menuSubtitle:     { fontSize: 13, color: TEXT_SOFT, marginTop: 4 },
    stickyBar:        { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: 16, paddingTop: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: -2 }, elevation: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    stickyBarTitle:   { fontSize: 14, fontWeight: '800', color: TEXT },
    stickyBarSub:     { fontSize: 12, color: TEXT_SOFT, marginTop: 2 },
    reviewBtn:        { backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', shadowColor: GREEN, shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
    reviewBtnTxt:     { color: '#fff', fontWeight: '800', fontSize: 14 },
    drawerOverlay:    { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    drawerBackdrop:   { ...StyleSheet.absoluteFillObject },
    drawerCard:       { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingBottom: 16, maxHeight: '85%' },
    drawerHandle:     { width: 48, height: 5, borderRadius: 999, backgroundColor: '#d1ddd1', alignSelf: 'center', marginTop: 8, marginBottom: 12 },
    drawerHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    drawerTitle:      { fontSize: 18, fontWeight: '900', color: TEXT },
    drawerTabs:       { flexDirection: 'row', gap: 8, marginBottom: 12 },
    drawerTab:        { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center', backgroundColor: '#f8faf8' },
    drawerTabActive:  { borderColor: GREEN, backgroundColor: GREEN_LIGHT },
    drawerTabTxt:     { fontSize: 13, fontWeight: '700', color: TEXT_SOFT },
    drawerTabTxtActive:{ color: GREEN },
    drawerItemRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 12 },
    drawerItemTitle:  { fontSize: 14, fontWeight: '800', color: TEXT },
    drawerItemMeta:   { fontSize: 12, color: TEXT_SOFT, marginTop: 2 },
    drawerQtyControls:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
    summaryCard:      { backgroundColor: '#f8faf8', borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 12, marginTop: 12, marginBottom: 12 },
    summaryRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
    summaryLabel:     { fontSize: 13, color: TEXT_MID },
    summaryValue:     { fontSize: 13, fontWeight: '800', color: TEXT },
    recentOrderCard:  { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 12 },
    statusPill:       { backgroundColor: GREEN_LIGHT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
    statusPillTxt:    { fontSize: 11, fontWeight: '800', color: GREEN },
    secondaryLinkBtn: { paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: BORDER, backgroundColor: '#fff', alignItems: 'center', marginTop: 12 },
    secondaryLinkTxt: { color: GREEN, fontWeight: '800', fontSize: 14 },
    emptyDraftCard:   { backgroundColor: '#f8faf8', borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 18, alignItems: 'center' },
    modalOverlay:     { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    modalCard:        { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
    modalHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
    modalTitle:       { fontSize: 18, fontWeight: '800', color: TEXT },
    modalCloseBtn:    { width: 34, height: 34, borderRadius: 17, backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center' },
    modalSection:     { backgroundColor: '#f8faf8', borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 14, marginBottom: 10 },
    modalSectionLabel:{ fontSize: 11, fontWeight: '700', color: TEXT_MID, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 },
    modalTxt:         { fontSize: 14, color: TEXT_MID },
    surgeBadge:       { marginTop: 8, backgroundColor: '#fde68a', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
    surgeBadgeTxt:    { fontSize: 12, fontWeight: '700', color: '#92400e' },
    conflictBanner:   { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#fef9c3', borderRadius: 12, borderWidth: 1, borderColor: '#fde68a', padding: 12, marginBottom: 10 },
    conflictTitle:    { fontSize: 13, fontWeight: '700', color: '#92400e', marginBottom: 4 },
    conflictItem:     { fontSize: 12, color: '#78350f', marginBottom: 2 },
    conflictHint:     { fontSize: 11, color: '#92400e', marginTop: 4, fontStyle: 'italic' },

    // ✅ FIXED: smaller buttons + tighter spacing so 3 steppers fit without overlap
    stepperGroup:     { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    stepperDivider:   { width: 1, height: 36, backgroundColor: BORDER, marginHorizontal: 2 },
    stepperLabel:     { fontSize: 10, color: TEXT_SOFT, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, fontWeight: '600', textAlign: 'center' },
    stepperRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
    stepperBtn:       { width: 28, height: 28, borderRadius: 14, backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
    stepperBtnTxt:    { fontSize: 16, fontWeight: '700', color: GREEN, lineHeight: 20 },
    stepperVal:       { fontSize: 14, fontWeight: '700', color: TEXT, minWidth: 30, textAlign: 'center' },

    zipInput:         { borderWidth: 1.5, borderColor: BORDER, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: TEXT, fontSize: 15, fontWeight: '600', marginTop: 6 },
    paymentRow:       { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff', marginTop: 8 },
    paymentRowSelected:{ borderColor: GREEN, backgroundColor: '#f0f7f0' },
    paymentCardNum:   { fontSize: 14, fontWeight: '600', color: TEXT },
    paymentCardMeta:  { fontSize: 12, color: TEXT_SOFT, marginTop: 2 },
    radio:            { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
    radioSelected:    { borderColor: GREEN },
    radioDot:         { width: 11, height: 11, borderRadius: 6, backgroundColor: GREEN },
});