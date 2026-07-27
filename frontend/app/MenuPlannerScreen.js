import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
    FlatList, View, Text, TouchableOpacity, TextInput,
    ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Octicons from '@expo/vector-icons/Octicons';
import getEnvVars from '../config';
import { useAuth } from './context/AuthContext';
import PlanCard from './components/PlanCard';

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';
const BG = '#fefce8';
const BORDER = '#e2ece2';
const TEXT = '#1a2e1a';
const TEXT_SOFT = '#8aab8a';

const EXAMPLE_PROMPTS = [
    'Italian dinner for 8 people',
    'Vegan brunch for 15 guests',
    'Birthday surprise for 20',
];

const GREETING = "Hi! I'm your Menu & Event Planner 🍽️\n\nTell me about your event — cuisine, number of guests, occasion, dietary needs — and I'll suggest a full menu, ingredients, estimated cost, and matching chefs near you.";

const GREETING_MESSAGE = { id: 'greeting', role: 'assistant', content: GREETING };

const conversationStorageKey = (userId) => `menu_planner_conversation_${userId}`;

async function postPlannerChat({ apiUrl, token, conversationId, message }) {
    const res = await fetch(`${apiUrl}/api/v1/menu-planner/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversation_id: conversationId, message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Planner request failed');
    return data; // { conversation_id, role, content, plan? }
}

export default function MenuPlannerScreen() {
    const { apiUrl } = getEnvVars();
    const { token, userId, logout } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const flatListRef = useRef();

    const [conversationId, setConversationId] = useState(null);
    const [messages, setMessages] = useState([GREETING_MESSAGE]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState(null);
    const [historyLoaded, setHistoryLoaded] = useState(false);

    // Restore the last saved conversation for this user on mount, so leaving
    // and re-entering the screen doesn't wipe the chat.
    useEffect(() => {
        if (!userId) { setHistoryLoaded(true); return; }
        (async () => {
            try {
                const saved = await AsyncStorage.getItem(conversationStorageKey(userId));
                if (saved) {
                    const parsed = JSON.parse(saved);
                    if (parsed.messages?.length) setMessages(parsed.messages);
                    if (parsed.conversationId) setConversationId(parsed.conversationId);
                }
            } catch (e) {
                console.error('Failed to load saved conversation:', e);
            } finally {
                setHistoryLoaded(true);
            }
        })();
    }, [userId]);

    // Persist on every change, once the initial load has finished (so we
    // don't clobber the saved conversation with the default greeting first).
    useEffect(() => {
        if (!historyLoaded || !userId) return;
        AsyncStorage.setItem(
            conversationStorageKey(userId),
            JSON.stringify({ conversationId, messages })
        ).catch(e => console.error('Failed to save conversation:', e));
    }, [historyLoaded, userId, conversationId, messages]);

    useLayoutEffect(() => {
        if (flatListRef.current && messages.length > 0) {
            flatListRef.current.scrollToEnd({ animated: false });
        }
    }, [messages]);

    const startNewChat = () => {
        Alert.alert(
            'Start a new chat?',
            'This clears your current conversation. It cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Start New',
                    style: 'destructive',
                    onPress: () => {
                        setMessages([GREETING_MESSAGE]);
                        setConversationId(null);
                        setError(null);
                        setInput('');
                        if (userId) AsyncStorage.removeItem(conversationStorageKey(userId)).catch(() => {});
                    },
                },
            ]
        );
    };

    const sendMessage = async (text) => {
        const trimmed = (text || input).trim();
        if (!trimmed || sending) return;

        setInput('');
        setError(null);
        setSending(true);

        const userMsg = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
        setMessages(prev => [...prev, userMsg]);

        try {
            const data = await postPlannerChat({ apiUrl, token, conversationId, message: trimmed });

            if (!conversationId && data.conversation_id) {
                setConversationId(data.conversation_id);
            }

            const assistantMsg = {
                id: `a-${Date.now()}`,
                role: 'assistant',
                content: data.content || null,
                plan: data.plan || null,
            };
            setMessages(prev => [...prev, assistantMsg]);
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

        } catch (err) {
            if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
                logout?.();
                return;
            }
            setError(err.message || 'Something went wrong. Please try again.');
            // Restore input so user can retry
            setInput(trimmed);
            // Remove the optimistic user bubble
            setMessages(prev => prev.filter(m => m.id !== userMsg.id));
        } finally {
            setSending(false);
        }
    };

    const retryLast = () => {
        if (!error || !input) return;
        sendMessage(input);
    };

    const renderMessage = ({ item }) => {
        const isUser = item.role === 'user';

        if (item.plan) {
            return (
                <View style={s.msgRowLeft}>
                    <View style={s.planBubbleWrapper}>
                        {item.content ? (
                            <Text style={s.planIntroText}>{item.content}</Text>
                        ) : null}
                        <PlanCard plan={item.plan} conversationId={conversationId} />
                    </View>
                </View>
            );
        }

        return (
            <View style={[s.msgRow, isUser ? s.msgRowRight : s.msgRowLeft]}>
                {!isUser && (
                    <View style={s.avatarDot}>
                        <Octicons name="sparkle-fill" size={12} color={GREEN} />
                    </View>
                )}
                <View style={[s.bubble, isUser ? s.bubbleSent : s.bubbleReceived]}>
                    <Text style={[s.bubbleText, isUser ? s.bubbleTextSent : s.bubbleTextReceived]}>
                        {item.content}
                    </Text>
                </View>
            </View>
        );
    };

    const renderTypingIndicator = () => {
        if (!sending) return null;
        return (
            <View style={s.msgRowLeft}>
                <View style={s.avatarDot}>
                    <Octicons name="sparkle-fill" size={12} color={GREEN} />
                </View>
                <View style={[s.bubble, s.bubbleReceived, s.typingBubble]}>
                    <View style={s.dotsRow}>
                        <View style={[s.dot, s.dot1]} />
                        <View style={[s.dot, s.dot2]} />
                        <View style={[s.dot, s.dot3]} />
                    </View>
                </View>
            </View>
        );
    };

    const showExampleChips = messages.length === 1; // only greeting shown

    return (
        <>
            <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: BG } }} />
            <View style={s.screen}>

                {/* Header */}
                <View style={s.header}>
                    <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
                        <Octicons name="chevron-left" size={24} color={GREEN} />
                    </TouchableOpacity>
                    <View style={s.headerCenter}>
                        <Text style={s.headerTitle}>Event Planner</Text>
                        <Text style={s.headerSub}>AI-powered menu suggestions</Text>
                    </View>
                    <TouchableOpacity onPress={startNewChat} style={s.newChatBtn}>
                        <Octicons name="plus" size={20} color={GREEN} />
                    </TouchableOpacity>
                </View>

                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={{ flex: 1 }}
                    keyboardVerticalOffset={insets.top}
                >
                    <FlatList
                        ref={flatListRef}
                        data={messages}
                        renderItem={renderMessage}
                        keyExtractor={item => item.id}
                        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
                        style={{ backgroundColor: BG }}
                        ListFooterComponent={renderTypingIndicator}
                        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                    />

                    {/* Example prompt chips — shown only before first user message */}
                    {showExampleChips && (
                        <View style={s.chipsRow}>
                            {EXAMPLE_PROMPTS.map(prompt => (
                                <TouchableOpacity
                                    key={prompt}
                                    style={s.chip}
                                    onPress={() => sendMessage(prompt)}
                                    activeOpacity={0.75}
                                >
                                    <Text style={s.chipText}>{prompt}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

                    {/* Error toast */}
                    {error ? (
                        <View style={s.errorToast}>
                            <Octicons name="alert" size={14} color="#991b1b" />
                            <Text style={s.errorText} numberOfLines={2}>{error}</Text>
                            <TouchableOpacity onPress={retryLast} style={s.retryBtn}>
                                <Text style={s.retryText}>Retry</Text>
                            </TouchableOpacity>
                        </View>
                    ) : null}

                    {/* Input bar */}
                    <View style={[s.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                        <TextInput
                            value={input}
                            onChangeText={setInput}
                            placeholder="Describe your event..."
                            placeholderTextColor="#aab4a8"
                            style={s.textInput}
                            multiline
                            returnKeyType="send"
                            blurOnSubmit={false}
                            onSubmitEditing={() => sendMessage()}
                            enablesReturnKeyAutomatically
                        />
                        <TouchableOpacity
                            onPress={() => sendMessage()}
                            disabled={sending || !input.trim()}
                            style={[s.sendBtn, (!input.trim() || sending) && s.sendBtnDisabled]}
                            activeOpacity={0.8}
                        >
                            {sending
                                ? <ActivityIndicator size="small" color="#fff" />
                                : <Octicons name="paper-airplane" size={18} color="#fff" />
                            }
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </View>
        </>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: BG },

    // Header
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: BORDER,
    },
    backBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center',
    },
    newChatBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center',
    },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
    headerSub: { fontSize: 11, color: TEXT_SOFT, marginTop: 1 },

    // Messages
    msgRow: { marginVertical: 3, flexDirection: 'row', alignItems: 'flex-end' },
    msgRowRight: { justifyContent: 'flex-end' },
    msgRowLeft: { justifyContent: 'flex-start', marginVertical: 3 },

    avatarDot: {
        width: 26, height: 26, borderRadius: 13,
        backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center',
        marginRight: 8, marginBottom: 2,
    },

    bubble: { maxWidth: '75%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
    bubbleSent: {
        backgroundColor: GREEN, borderBottomRightRadius: 4,
        shadowColor: GREEN, shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15, shadowRadius: 4, elevation: 2,
    },
    bubbleReceived: {
        backgroundColor: '#fff', borderBottomLeftRadius: 4,
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
        borderWidth: 1, borderColor: BORDER,
    },
    bubbleText: { fontSize: 15, lineHeight: 22 },
    bubbleTextSent: { color: '#fff' },
    bubbleTextReceived: { color: TEXT },

    // Plan card wrapper (full width)
    planBubbleWrapper: {
        flex: 1, marginLeft: 34, marginRight: 4,
    },
    planIntroText: {
        fontSize: 14, color: TEXT, marginBottom: 8, lineHeight: 20,
    },

    // Typing indicator
    typingBubble: { paddingVertical: 14, paddingHorizontal: 18 },
    dotsRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN_LIGHT },
    dot1: { opacity: 1 },
    dot2: { opacity: 0.65 },
    dot3: { opacity: 0.35 },

    // Example prompt chips
    chipsRow: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 8,
        paddingHorizontal: 16, paddingBottom: 12,
    },
    chip: {
        backgroundColor: '#fff', borderWidth: 1.5, borderColor: BORDER,
        borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    },
    chipText: { fontSize: 13, color: TEXT_SOFT, fontWeight: '600' },

    // Error toast
    errorToast: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: '#fee2e2', borderTopWidth: 1, borderTopColor: '#fecaca',
        paddingHorizontal: 16, paddingVertical: 10,
    },
    errorText: { flex: 1, fontSize: 13, color: '#991b1b' },
    retryBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#991b1b', borderRadius: 8 },
    retryText: { fontSize: 12, fontWeight: '700', color: '#fff' },

    // Input bar
    inputBar: {
        flexDirection: 'row', alignItems: 'flex-end',
        paddingHorizontal: 16, paddingTop: 10,
        backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: BORDER, gap: 10,
    },
    textInput: {
        flex: 1, backgroundColor: BG, borderWidth: 1.5, borderColor: '#dde8dd',
        borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10,
        fontSize: 15, color: TEXT, maxHeight: 120,
    },
    sendBtn: {
        width: 44, height: 44, borderRadius: 22, backgroundColor: GREEN,
        alignItems: 'center', justifyContent: 'center', marginBottom: 2,
        shadowColor: GREEN, shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
    },
    sendBtnDisabled: { backgroundColor: '#c8ddd0' },
});