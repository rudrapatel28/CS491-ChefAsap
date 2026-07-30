import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import getEnvVars from '../../config';


export const AuthContext = createContext({
    isAuthenticated: false,
    isGuest: false,
    isBrowsingGuest: false,
    userType: null,
    userId: null,
    profileId: null,
    token: null,
    login: async () => { },
    guestLogin: async (guestInfo) => { },
    enterGuestMode: () => { },
    logout: async () => { },
});


export const useAuth = () => useContext(AuthContext);




export function AuthProvider({ children }) {

    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isGuest, setIsGuest] = useState(false);
    const [isBrowsingGuest, setIsBrowsingGuest] = useState(false);

    const [userType, setUserType] = useState(null);
    const [userId, setUserId] = useState(null);
    const [profileId, setProfileId] = useState(null);

    const [token, setToken] = useState(null);

    const [isLoading, setIsLoading] = useState(true);

    const router = useRouter();
    const { apiUrl } = getEnvVars();



    useEffect(() => {


        const loadSession = async () => {

            try {

                const storedToken =
                    await SecureStore.getItemAsync('auth_token');

                const storedUserType =
                    await AsyncStorage.getItem('user_type');

                const storedUserId =
                    await AsyncStorage.getItem('user_id');

                const storedProfileId =
                    await AsyncStorage.getItem('profile_id');


                // Restore guest session
                if (
                    storedUserType === 'guest' &&
                    storedToken &&
                    storedUserId
                ) {

                    setToken(storedToken);

                    setUserType('guest');

                    setUserId(storedUserId);

                    setProfileId(storedProfileId);

                    setIsGuest(true);

                    setIsAuthenticated(true);

                }

                // Restore normal account
                else if (
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


            } catch (e) {

                console.error(
                    'Failed to load session:',
                    e
                );

            } finally {

                setIsLoading(false);

            }

        };


        loadSession();

    }, []);




    // Normal user login
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

            setIsGuest(false);
            setIsAuthenticated(true);


        } catch (e) {

            console.error(
                'Failed to save login:',
                e
            );

        }

    };

    // GuestMode
    const enterGuestMode = () => {
        setIsBrowsingGuest(true);
    };


    // Guest login

    const guestLogin = async (guestInfo) => {

        if (!guestInfo.email && !guestInfo.phone) {
            throw new Error("Email or phone is required");
        }

        try {

            const response = await fetch(`${apiUrl}/auth/guest`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    firstName: guestInfo.firstName,
                    lastName: guestInfo.lastName,
                    email: guestInfo.email,
                    phone: guestInfo.phone,
                }),
            });


            const data = await response.json();


            if (!response.ok) {
                throw new Error(data.error || "Guest login failed");
            }


            await AsyncStorage.setItem(
                "user_type",
                "guest"
            );


            await AsyncStorage.setItem(
                "user_id",
                String(data.guest_id)
            );


            await AsyncStorage.setItem(
                "profile_id",
                String(data.guest_id)
            );


            await SecureStore.setItemAsync(
                "auth_token",
                data.token
            );


            setToken(data.token);

            setUserType("guest");

            setUserId(data.guest_id);

            setProfileId(data.guest_id);

            setIsGuest(true);

            setIsAuthenticated(true);


        } catch (e) {

            console.error(
                "Failed to create guest account:",
                e
            );

            throw e;

        }

    };

    const logout = async () => {

        try {


            await SecureStore.deleteItemAsync(
                'auth_token'
            );


            await AsyncStorage.removeItem(
                'user_type'
            );


            await AsyncStorage.removeItem(
                'user_id'
            );


            await AsyncStorage.removeItem(
                'profile_id'
            );



            setToken(null);

            setUserType(null);

            setUserId(null);

            setProfileId(null);

            setIsGuest(false);

            setIsAuthenticated(false);



            router.replace('/(auth)');


        } catch (e) {

            console.error(
                'Failed to logout:',
                e
            );

        }

    };





    const contextValue = {
        isAuthenticated,

        isGuest,

        isBrowsingGuest,

        enterGuestMode,

        userType,

        userId,

        profileId,

        token,

        login,

        guestLogin,

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