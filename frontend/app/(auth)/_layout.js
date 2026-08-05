import { Stack } from 'expo-router';
import { useTheme } from '../providers/ThemeProvider';
import { useEffect } from 'react';

export default function AuthLayout() {
    const { setIsOnAuthPage } = useTheme();
    const handleMount = () => {
        setIsOnAuthPage(true);
    };

    const handleUnmount = () => {
        setIsOnAuthPage(false);
    };

    useEffect(() => {
        handleMount();

        return handleUnmount;
    }, []);    
    
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                animation: 'default',
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
            }}
        >
            <Stack.Screen
                name="index"
            />

            <Stack.Screen
                name="SignInScreen"
            />

            <Stack.Screen
                name="SignUpScreen"
            />

            <Stack.Screen
                name="VerifyCodeScreen"
            />

            <Stack.Screen
                name="ForgetPasswordScreen"
            />

            <Stack.Screen
                name="ResetPasswordScreen"
            />
        </Stack>
    );
}