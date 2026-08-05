import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';


export const AuthContext = createContext({
    isAuthenticated: false,
    isGuestBrowsing: false,
    userType: null,
    userId: null,
    profileId: null,
    token: null,
    sessionId: null,
    login: async () => {},
    enterGuestMode: () => {},
    logout: async () => {},
});


export const useAuth = () => useContext(AuthContext);


const generateSessionId = () => {
    return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
};


export function AuthProvider({ children }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isGuestBrowsing, setIsGuestBrowsing] = useState(false);
    const [userType, setUserType] = useState(null);
    const [userId, setUserId] = useState(null);
    const [profileId, setProfileId] = useState(null);
    const [token, setToken] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const router = useRouter();

    useEffect(() => {
        setSessionId(generateSessionId());

        const loadSession = async () => {
            try {
                const storedGuestMode = await AsyncStorage.getItem('guest_mode');

                if (storedGuestMode === 'true') {
                    setIsGuestBrowsing(true);
                    setIsAuthenticated(false);
                    setUserType('guest');
                    setToken(null);
                    setUserId(null);
                    setProfileId(null);
                    return;
                }

                const storedToken = await SecureStore.getItemAsync('auth_token');
                const storedUserType = await AsyncStorage.getItem('user_type');
                const storedUserId = await AsyncStorage.getItem('user_id');
                const storedProfileId = await AsyncStorage.getItem('profile_id');

                if (storedToken && storedUserType && storedUserId && storedProfileId) {
                    setToken(storedToken);
                    setUserType(storedUserType);
                    setUserId(storedUserId);
                    setProfileId(storedProfileId);
                    setIsAuthenticated(true);
                }
            } catch (error) {
                console.error('Failed loading session:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadSession();
    }, []);

    const login = async (newToken, newUserType, newUserId, newProfileId) => {
        try {
            await SecureStore.setItemAsync('auth_token', newToken);
            await AsyncStorage.setItem('user_type', newUserType);
            await AsyncStorage.setItem('user_id', String(newUserId));
            await AsyncStorage.setItem('profile_id', String(newProfileId));
            await AsyncStorage.removeItem('guest_mode');

            setToken(newToken);
            setUserType(newUserType);
            setUserId(newUserId);
            setProfileId(newProfileId);
            setIsAuthenticated(true);
            setIsGuestBrowsing(false);
        } catch (error) {
            console.error('Login save failed:', error);
        }
    };

    const enterGuestMode = async () => {
        try {
            await AsyncStorage.setItem('guest_mode', 'true');
        } catch (error) {
            console.error('Failed saving guest mode:', error);
        }

        setIsGuestBrowsing(true);
        setIsAuthenticated(false);
        setUserType('guest');
        setUserId(null);
        setProfileId(null);
        setToken(null);

        router.replace('/(tabs)/SearchScreen');
    };

    const logout = async () => {
        try {
            await SecureStore.deleteItemAsync('auth_token');
            await AsyncStorage.removeItem('user_type');
            await AsyncStorage.removeItem('user_id');
            await AsyncStorage.removeItem('profile_id');
            await AsyncStorage.removeItem('guest_mode');

            setToken(null);
            setUserId(null);
            setProfileId(null);
            setUserType(null);
            setIsAuthenticated(false);
            setIsGuestBrowsing(false);

            router.replace('/(auth)');
        } catch (error) {
            console.error('Logout failed:', error);
        }
    };

    const contextValue = {
        isAuthenticated,
        isGuestBrowsing,
        userType,
        userId,
        profileId,
        token,
        sessionId,
        login,
        enterGuestMode,
        logout,
        isLoading,
    };

    return (
        <AuthContext.Provider value={contextValue}>
            {children}
        </AuthContext.Provider>
    );
}


export default AuthProvider;