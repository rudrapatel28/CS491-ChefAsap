import React, { createContext, useContext, useState, useEffect } from 'react';
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
    pendingVerification: null,
    login: async () => {},
    enterGuestMode: () => {},
    logout: async () => {},
    setPendingVerification: () => {},
    clearPendingVerification: () => {},
});


export const useAuth = () => useContext(AuthContext);


// Generate session ID
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
    // Distinct from isAuthenticated: set while a signup or 2FA login is
    // waiting on an emailed/authenticator code, before a token exists.
    const [pendingVerification, setPendingVerificationState] = useState(null);

    const router = useRouter();



    useEffect(() => {

        setSessionId(generateSessionId());

        const loadSession = async () => {

            try {

                const storedToken = await SecureStore.getItemAsync('auth_token');
                const storedUserType = await AsyncStorage.getItem('user_type');
                const storedUserId = await AsyncStorage.getItem('user_id');
                const storedProfileId = await AsyncStorage.getItem('profile_id');


                // Normal logged in user
                if (
                    storedToken &&
                    storedUserType &&
                    storedUserId &&
                    storedProfileId
                ) {

                    setToken(storedToken);
                    setUserType(storedUserType);
                    setUserId(storedUserId);
                    setProfileId(storedProfileId);

                    setIsAuthenticated(true);
                }


            } catch (error) {

                console.error("Failed loading session:", error);

            } finally {

                setIsLoading(false);

            }

        };


        loadSession();

    }, []);




    // Normal account login
    const login = async (
        newToken,
        newUserType,
        newUserId,
        newProfileId
    ) => {

        try {

            await SecureStore.setItemAsync(
                'auth_token',
                newToken
            );

            await AsyncStorage.setItem(
                'user_type',
                newUserType
            );

            await AsyncStorage.setItem(
                'user_id',
                String(newUserId)
            );

            await AsyncStorage.setItem(
                'profile_id',
                String(newProfileId)
            );


            setToken(newToken);
            setUserType(newUserType);
            setUserId(newUserId);
            setProfileId(newProfileId);

            setIsAuthenticated(true);
            setIsGuestBrowsing(false);


        } catch(error) {

            console.error("Login save failed:", error);

        }

    };





    // Guest browsing (no account, no backend)
    const enterGuestMode = () => {

        setIsGuestBrowsing(true);

        // IMPORTANT:
        // Guest is allowed into the app
        // but is NOT authenticated

        setIsAuthenticated(false);

        setUserType("guest");

        router.replace("/(tabs)/SearchScreen");

    };





    const logout = async () => {

        try {

            await SecureStore.deleteItemAsync('auth_token');

            await AsyncStorage.removeItem('user_type');
            await AsyncStorage.removeItem('user_id');
            await AsyncStorage.removeItem('profile_id');


            setToken(null);
            setUserId(null);
            setProfileId(null);
            setUserType(null);

            setIsAuthenticated(false);
            setIsGuestBrowsing(false);


            router.replace('/(auth)');


        } catch(error) {

            console.error("Logout failed:", error);

        }

    };


    const setPendingVerification = (email, purpose = 'signup') => {
        setPendingVerificationState({ email, purpose });
    };

    const clearPendingVerification = () => {
        setPendingVerificationState(null);
    };

    const contextValue = {

        isAuthenticated,

        isGuestBrowsing,

        userType,

        userId,

        profileId,

        token,

        sessionId,
        pendingVerification,
        login,

        enterGuestMode,

        logout,

        isLoading,
        setPendingVerification,
        clearPendingVerification,
    };



    return (

        <AuthContext.Provider value={contextValue}>

            {children}

        </AuthContext.Provider>

    );

}


export default AuthProvider;
