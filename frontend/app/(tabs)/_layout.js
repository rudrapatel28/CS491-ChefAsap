import { View, Modal, Platform, TouchableOpacity } from "react-native";
import { Tabs, useRouter } from 'expo-router';
import Octicons from '@expo/vector-icons/Octicons';
import { useAuth } from '../context/AuthContext';
import { useCallback, useEffect, useState } from 'react';
import BookingReviewModal from "../components/BookingReviewModal";
import OrderConfirmationModal from "../components/OrderConfirmationModal";
import getEnvVars from "../../config";
import CreateAccountModal from "../components/CreateAccountModal";

const CREAM = '#fefce8';
const GREEN = '#2d6a4f';
const GREEN_MUTED = '#a8c5b0';

export default function TabLayout() {

    const {
        isAuthenticated,
        userType,
        isLoading,
        profileId,
        token,
        isGuestBrowsing
    } = useAuth();


    const { apiUrl } = getEnvVars();
    const router = useRouter();

    const [bookings, setBookings] = useState([]);
    const [unreadMessageCount, setUnreadMessageCount] = useState(0);


    const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);

    const requireAccount = useCallback(() => {
        if (isGuestBrowsing || !token) {
            setShowCreateAccountModal(true);
            return false;
        }

        return true;
    }, [isGuestBrowsing, token]);

    useEffect(() => {

        // Guests do not need authentication redirect
        if (isGuestBrowsing) return;


        if (!isLoading && !isAuthenticated) {
            router.replace('/(auth)');
        }


        if (!isLoading && isAuthenticated) {

            const fetchBookings = async () => {

                if (!profileId) return;

                try {

                    const url = `${apiUrl}/booking/${userType}/${profileId}/bookings/finished`;

                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`,
                        },
                    });


                    const data = await response.json();


                    if (response.ok) {
                        setBookings(data.bookings || []);
                    }


                } catch (err) {
                    console.log("Failed fetching bookings:", err);
                }

            };


            fetchBookings();

        }

    }, [
        isLoading,
        isAuthenticated,
        router,
        isGuestBrowsing,
        profileId,
        apiUrl,
        token,
        userType
    ]);


            const fetchUnreadMessages = async () => {
                if (!profileId || !userType || !token) return;
                try {
                    const url = `${apiUrl}/api/chat/conversations?${userType}_id=${profileId}`;
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`,
                        },
                    });
                    if (!response.ok) return;
                    const data = await response.json();
                    const unreadTotal = Array.isArray(data)
                        ? data.reduce((total, conversation) => total + (Number(conversation.unread_count) || 0), 0)
                        : 0;
                    setUnreadMessageCount(unreadTotal);
                } catch (err) {
                    setUnreadMessageCount(0);
                }
            };
            fetchUnreadMessages();
        }
    }, [isLoading, isAuthenticated, router, apiUrl, profileId, token, userType]);

    const iconSize = 24;
    const isIOS = Platform.OS === 'ios';


    const tabBarOptions = {

        headerShown: false,

        tabBarActiveTintColor: GREEN,
        tabBarInactiveTintColor: GREEN_MUTED,

        tabBarHideOnKeyboard: true,

        sceneStyle: {
            backgroundColor: CREAM,
        },


        tabBarStyle: {
            backgroundColor: CREAM,
            height: isIOS ? 62 : 70,
            paddingTop: isIOS ? 6 : 4,
            paddingBottom: isIOS ? 6 : 8,
            borderTopWidth: 1,
            borderTopColor: '#e2ece2',
            elevation: 0,
            shadowOpacity: 0,
        },


        tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
            marginTop: isIOS ? 0 : 2,
        },

    };



    // ==========================
    // GUEST BROWSING
    // ALL TABS VISIBLE, PROTECTED TABS REQUIRE ACCOUNT
    // ==========================


    if (isGuestBrowsing) {

        return (

            <View style={{ flex: 1, backgroundColor: CREAM }}>

                <Modal
                    visible={showCreateAccountModal}
                    animationType="fade"
                    transparent={true}
                    onRequestClose={() => setShowCreateAccountModal(false)}
                >

                    <View
                        style={{
                            flex: 1,
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >

                        <CreateAccountModal
                            onClose={() => setShowCreateAccountModal(false)}
                        />

            <Tabs screenOptions={tabBarOptions}>
                <Tabs.Screen
                    name="BookingsScreen"
                    options={{
                        title: 'Bookings',
                        tabBarIcon: ({ color }) => <Octicons name="calendar" size={iconSize} color={color} />,
                    }}
                />
                <Tabs.Screen
                    name="Messages"
                    options={{
                        title: 'Messages',
                        tabBarIcon: ({ color }) => <Octicons name="comment-discussion" size={iconSize} color={color} />,
                        tabBarBadge: unreadMessageCount > 0 ? unreadMessageCount : undefined,
                        tabBarBadgeStyle: { backgroundColor: '#ef4444', color: '#ffffff', fontSize: 10 },
                    }}
                />
                <Tabs.Screen
                    name="Profile"
                    options={{
                        title: 'Profile',
                        tabBarIcon: ({ color }) => <Octicons name="person" size={iconSize} color={color} />,
                    }}
                />
                <Tabs.Screen name="SearchScreen" options={{ href: null }} />
            </Tabs>
        </View>
    );

    return (

        <View style={{ flex: 1, backgroundColor: CREAM }}>


            <Modal
                visible={bookings.length > 0}
                animationType="fade"
                transparent={true}
                onRequestClose={() => setBookings([])}
            >

                <View
                    style={{
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        flex: 1,
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >

                    {bookings.length > 0 &&
                        <BookingReviewModal
                            key={bookings[0].booking_id}
                            onClose={() =>
                                setBookings(
                                    bookings.filter(
                                        b => b.booking_id !== bookings[0].booking_id
                                    )
                                )
                            }
                            customerId={profileId}
                            booking={bookings[0]}
                        />
                    }

                </View>

            </Modal>



            <Tabs screenOptions={tabBarOptions}>


                <Tabs.Screen
                    name="SearchScreen"
                    options={{
                        href: 'SearchScreen',
                        title: 'Search',
                        tabBarIcon: ({ color }) =>
                            <Octicons
                                name="search"
                                size={iconSize}
                                color={color}
                            />,
                    }}
                />


                <Tabs.Screen
                    name="BookingsScreen"
                    options={{
                        title: 'Bookings',
                        tabBarIcon: ({ color }) =>
                            <Octicons
                                name="calendar"
                                size={iconSize}
                                color={color}
                            />,
                    }}
                />


                <Tabs.Screen
                    name="Messages"
                    options={{
                        title: 'Messages',
                        tabBarIcon: ({ color }) => <Octicons name="comment-discussion" size={iconSize} color={color} />,
                        tabBarBadge: unreadMessageCount > 0 ? unreadMessageCount : undefined,
                        tabBarBadgeStyle: { backgroundColor: '#ef4444', color: '#ffffff', fontSize: 10 },
                    }}
                />


                <Tabs.Screen
                    name="Profile"
                    options={{
                        title: 'Profile',
                        tabBarIcon: ({ color }) =>
                            <Octicons
                                name="person"
                                size={iconSize}
                                color={color}
                            />,
                    }}
                />


            </Tabs>


        </View>

    );

}