import { useState, useCallback, useMemo, useRef } from 'react';
import {
    FlatList,
    View,
    Text,
    TouchableOpacity,
    RefreshControl,
    TextInput,
    Pressable,
    ScrollView,
    Platform,
    Image,
} from 'react-native';
import { useRouter, useFocusEffect, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import getEnvVars from "../../config";
import { useAuth } from '../context/AuthContext';
import Octicons from '@expo/vector-icons/Octicons';
import { Feather } from '@expo/vector-icons';
import LoadingIcon from '../components/LoadingIcon';

const FILTER_TABS = ['All', 'Unread', 'Chefs', 'Bookings'];

const CREAM_BG = '#fefce8';
const CARD_BG = '#ffffff';
const TEXT_PRIMARY = '#1a2e1a';
const TEXT_SECONDARY = '#44403c';
const TEXT_MUTED = '#78716c';
const BORDER = '#e2ece2';
const GREEN = '#2d6a4f';
const GREEN_MUTED = '#4a7c59';

const AVATAR_PALETTE = ['#D1FAE5', '#E9D5FF', '#FEF3C7', '#BFDBFE', '#FECDD3', '#FDE68A'];

function hashString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

function getInitials(firstName, lastName) {
    const a = (firstName || '').trim();
    const b = (lastName || '').trim();
    const i1 = a[0] || '';
    const i2 = b[0] || (a[1] || '');
    return `${i1}${i2}`.toUpperCase();
}

export default function Messages() {
    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('All');
    const [searchQuery, setSearchQuery] = useState('');
    const searchRef = useRef(null);
    const { apiUrl } = getEnvVars();
    const { userType, token, profileId } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const pageBg = CREAM_BG;
    const cardBg = CARD_BG;
    const mutedText = TEXT_MUTED;
    const borderSubtle = BORDER;
    const iconMuted = '#57534e';

    const fetchConversations = async () => {
        try {
            const url = `${apiUrl}/api/chat/conversations?${userType}_id=${profileId}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
            });
            if (!response.ok) throw new Error('Failed to fetch conversations.');
            const data = await response.json();
            setConversations(data);
            setError(null);
        } catch (err) {
            console.error('Error fetching conversations: ', err);
            setError('Failed to load messages. Please try again.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            setLoading(true);
            fetchConversations();
        }, [profileId, userType])
    );

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchConversations();
    }, []);

    const handleConversationPress = (conversation) => {
        router.push({
            pathname: '/ChatScreen',
            params: {
                chatId: conversation.chat_id,
                otherUserId: userType === 'chef' ? conversation.customer_id : conversation.chef_id,
                otherUserName: userType === 'chef'
                    ? `${conversation.customer_first_name} ${conversation.customer_last_name}`
                    : `${conversation.chef_first_name} ${conversation.chef_last_name}`,
            }
        });
    };

    const formatListTimestamp = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const getMessagePreview = (conversation) => {
        const preview = conversation?.last_message?.trim();
        if (preview) return preview;
        return 'No message preview yet';
    };

    const getOtherName = (item) => {
        if (userType === 'chef') return `${item.customer_first_name} ${item.customer_last_name}`;
        return `${item.chef_first_name} ${item.chef_last_name}`;
    };

    const getPhotoFirstLast = (item) => {
        if (userType === 'chef') return { first: item.customer_first_name, last: item.customer_last_name, url: item.photo_url };
        return { first: item.chef_first_name, last: item.chef_last_name, url: item.photo_url };
    };

    const filteredConversations = useMemo(() => {
        let list = conversations;
        if (filter === 'Unread') list = list.filter((c) => c.unread_count > 0);
        else if (filter === 'Chefs') list = list.filter((c) => !c.booking_id);
        else if (filter === 'Bookings') list = list.filter((c) => !!c.booking_id);
        const q = searchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter((c) => {
                const name = getOtherName(c).toLowerCase();
                const preview = (c.last_message || '').toLowerCase();
                return name.includes(q) || preview.includes(q);
            });
        }
        return list;
    }, [conversations, filter, searchQuery, userType]);

    const openCompose = () => {
        if (userType === 'chef') router.push('/(tabs)/BookingsScreen');
        else router.push('/(tabs)/SearchScreen');
    };

    const renderConversation = ({ item }) => {
        const otherUserName = getOtherName(item);
        const { first, last, url } = getPhotoFirstLast(item);
        const hasUnread = item.unread_count > 0;
        const initials = getInitials(first, last);
        const bgColor = AVATAR_PALETTE[hashString(otherUserName) % AVATAR_PALETTE.length];
        const initialsColor = GREEN;

        return (
            <Pressable
                onPress={() => handleConversationPress(item)}
                android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
                style={({ pressed }) => ({ backgroundColor: pressed ? 'rgba(0,0,0,0.03)' : 'transparent' })}
            >
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
                    <View style={{ marginRight: 12 }}>
                        <View style={{
                            width: 52, height: 52, borderRadius: 26, overflow: 'hidden',
                            borderWidth: 1, borderColor: borderSubtle, backgroundColor: bgColor,
                            alignItems: 'center', justifyContent: 'center',
                        }}>
                            {url ? (
                                <Image
                                    source={{ uri: url?.startsWith('data:') ? url : `${apiUrl}${url}` }}
                                    style={{ width: 52, height: 52 }}
                                />
                            ) : initials ? (
                                <Feather name="shopping-bag" size={18} color={GREEN} />
                            ) : (
                                <Feather name="shopping-bag" size={18} color={GREEN} />
                            )}
                        </View>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                            <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                                <Text style={{ fontSize: 16, fontWeight: hasUnread ? '700' : '600', color: TEXT_PRIMARY }} numberOfLines={1}>
                                    {otherUserName}
                                </Text>
                                <Text style={{ marginTop: 4, fontSize: 14, color: hasUnread ? TEXT_SECONDARY : mutedText, fontWeight: hasUnread ? '600' : '400' }} numberOfLines={1}>
                                    {getMessagePreview(item)}
                                </Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                                <Text style={{ fontSize: 12, color: mutedText, fontWeight: '500' }}>
                                    {formatListTimestamp(item.last_message_at)}
                                </Text>
                                {hasUnread ? (
                                    <View style={{ marginTop: 6, minWidth: 22, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' }}>
                                        <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>
                                            {item.unread_count > 9 ? '9+' : item.unread_count}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                        </View>
                    </View>
                </View>
            </Pressable>
        );
    };

    if (loading && !refreshing) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: CREAM_BG }}>
                    <LoadingIcon message="Loading messages..." />
                </View>
            </>
        );
    }

    if (error) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={{ flex: 1, backgroundColor: CREAM_BG, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
                    <Octicons name="alert" size={48} color={GREEN} />
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 18, fontWeight: '600', marginTop: 16, textAlign: 'center' }}>{error}</Text>
                    <TouchableOpacity onPress={fetchConversations} style={{ backgroundColor: GREEN, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 16 }}>
                        <Text style={{ color: '#fff', fontWeight: '600' }}>Try Again</Text>
                    </TouchableOpacity>
                </View>
            </>
        );
    }

    const listEmpty = conversations.length === 0;
    const filteredEmpty = !listEmpty && filteredConversations.length === 0;

    return (
        <View style={{ flex: 1, backgroundColor: pageBg }}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* ✅ FIX: removed insets.top — SafeAreaView in _layout.js already handles it */}
            <View style={{ paddingTop: 8, paddingHorizontal: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: TEXT_PRIMARY, letterSpacing: -0.5 }}>
                        Messages
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity
                            onPress={() => searchRef.current?.focus()}
                            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: CARD_BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: borderSubtle }}
                            accessibilityLabel="Focus search"
                        >
                            <Octicons name="search" size={20} color={iconMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={openCompose}
                            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: CARD_BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: borderSubtle }}
                            accessibilityLabel="New message"
                        >
                            <Octicons name="comment" size={20} color={iconMuted} />
                        </TouchableOpacity>
                    </View>
                </View>

                <View style={{
                    flexDirection: 'row', alignItems: 'center', borderRadius: 999,
                    borderWidth: 1, borderColor: BORDER, backgroundColor: cardBg,
                    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 4, marginBottom: 14,
                }}>
                    <Octicons name="search" size={18} color={mutedText} style={{ marginRight: 8 }} />
                    <TextInput
                        ref={searchRef}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="Search messages..."
                        placeholderTextColor={mutedText}
                        style={{ flex: 1, fontSize: 16, color: TEXT_PRIMARY, paddingVertical: Platform.OS === 'android' ? 8 : 0 }}
                    />
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 16 }}>
                    {FILTER_TABS.map((tab) => {
                        const active = filter === tab;
                        return (
                            <Pressable
                                key={tab}
                                onPress={() => setFilter(tab)}
                                android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
                                style={{
                                    paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999,
                                    borderWidth: 1.5, borderColor: active ? GREEN : '#dde8dd',
                                    backgroundColor: active ? GREEN : CARD_BG,
                                }}
                            >
                                <Text style={{ fontSize: 14, fontWeight: '600', color: active ? '#ffffff' : GREEN_MUTED }}>
                                    {tab}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>

            {listEmpty ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
                    <Octicons name="comment-discussion" size={64} color={GREEN} />
                    <Text style={{ color: TEXT_PRIMARY, fontSize: 20, fontWeight: '600', marginTop: 16, textAlign: 'center' }}>No messages yet</Text>
                    <Text style={{ color: TEXT_MUTED, textAlign: 'center', marginTop: 8, fontSize: 15 }}>Book a chef to start chatting</Text>
                </View>
            ) : (
                <View style={{
                    flex: 1, marginHorizontal: 20,
                    marginBottom: Math.max(insets.bottom, 12),
                    borderRadius: 20, backgroundColor: cardBg,
                    borderWidth: 1, borderColor: borderSubtle, overflow: 'hidden',
                    ...Platform.select({
                        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12 },
                        android: { elevation: 3 },
                    }),
                }}>
                    {filteredEmpty ? (
                        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
                            <Octicons name="filter" size={40} color={mutedText} />
                            <Text style={{ marginTop: 12, fontSize: 16, fontWeight: '600', color: TEXT_SECONDARY }}>No conversations match</Text>
                            <Text style={{ marginTop: 4, fontSize: 14, color: mutedText, textAlign: 'center' }}>Try another filter or search term</Text>
                        </View>
                    ) : (
                        <FlatList
                            data={filteredConversations}
                            renderItem={renderConversation}
                            keyExtractor={(item) => item.chat_id.toString()}
                            ItemSeparatorComponent={() => (
                                <View style={{ height: 1, backgroundColor: borderSubtle, marginLeft: 80 }} />
                            )}
                            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GREEN} />}
                            contentContainerStyle={{ flexGrow: 1, paddingBottom: 8 }}
                            keyboardShouldPersistTaps="handled"
                        />
                    )}
                </View>
            )}
        </View>
    );
}