import { Stack, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from './context/AuthContext';
import CartProvider from './context/CartContext';
import { View } from 'react-native';
import LoadingIcon from './components/LoadingIcon';
import ThemeProvider from './providers/ThemeProvider';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';

import 'react-native-reanimated';
import { enableScreens } from 'react-native-screens';
import '../global.css';

enableScreens(true);
SplashScreen.preventAutoHideAsync();

const STRIPE_PUBLISHABLE_KEY = 'pk_test_51Tw7iOHafQUeyNJlOYQOVtxxwHwwpp1OCtjBBSIzMniDsNVYsbbW18CReVRMJIlRoePXJkY1hrFqUsb5gwOvPVxB00l3hT754D';
const CREAM = '#fefce8';

export default function RootLayout() {
    return (
        <SafeAreaProvider>
            <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
                <AuthProvider>
                    <CartProvider>
                        <ThemeProvider>
                            <RootStack />
                        </ThemeProvider>
                    </CartProvider>
                </AuthProvider>
            </StripeProvider>
        </SafeAreaProvider>
    );
}

function RootStack() {
    const { isLoading } = useAuth();
    const segments = useSegments();
    const isAuthRoute = segments[0] === '(auth)';

    useEffect(() => {
        if (!isLoading) SplashScreen.hide();
    }, [isLoading]);

    if (isLoading) return null;

    return (
        <SafeAreaView
            style={{ flex: 1, backgroundColor: CREAM }}
            edges={isAuthRoute ? [] : ['top', 'bottom']}
        >
            <Stack
                screenOptions={{
                    headerShown: false,
                    animation: 'default',
                    gestureEnabled: true,
                    fullScreenGestureEnabled: true,
                    contentStyle: { backgroundColor: CREAM },
                }}
            >
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                    name="ChefProfileScreen/[id]"
                    options={{ animation: 'default', gestureEnabled: true, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: CREAM } }}
                />
                <Stack.Screen
                    name="ChefMenu/[id]"
                    options={{ animation: 'default', gestureEnabled: true, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: CREAM } }}
                />
                <Stack.Screen
                    name="ChefProductivityScreen"
                    options={{ animation: 'default', gestureEnabled: true, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: CREAM } }}
                />
                <Stack.Screen
                    name="ChefOrdersScreen"
                    options={{ animation: 'default', gestureEnabled: true, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: CREAM } }}
                />
                <Stack.Screen
                    name="CustomerBookingsScreen"
                    options={{ animation: 'default', gestureEnabled: true, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: CREAM } }}
                />
                <Stack.Screen
                    name="MenuPlannerScreen"
                    options={{ animation: 'default', gestureEnabled: true, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: CREAM } }}
                />
            </Stack>
        </SafeAreaView>
    );
}