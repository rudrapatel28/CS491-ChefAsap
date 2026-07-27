import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';

const CART_STORAGE_PREFIX = 'chefasap-cart-state';

const CartContext = createContext({
    cartReady: false,
    activeChefId: null,
    orderItems: [],
    setActiveChefId: () => {},
    updateOrderItems: () => {},
    clearActiveCart: () => {},
});

export const useCart = () => useContext(CartContext);

export default function CartProvider({ children }) {
    const { profileId, userType } = useAuth();
    const [cartReady, setCartReady] = useState(false);
    const [activeChefId, setActiveChefId] = useState(null);
    const [cartsByChef, setCartsByChef] = useState({});

    const storageKey = useMemo(() => {
        if (!profileId || !userType) return null;
        return `${CART_STORAGE_PREFIX}:${userType}:${profileId}`;
    }, [profileId, userType]);

    useEffect(() => {
        const loadCartState = async () => {
            setCartReady(false);
            setActiveChefId(null);

            if (!storageKey) {
                setCartsByChef({});
                setCartReady(true);
                return;
            }

            try {
                const stored = await AsyncStorage.getItem(storageKey);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    setCartsByChef(parsed?.cartsByChef && typeof parsed.cartsByChef === 'object' ? parsed.cartsByChef : {});
                } else {
                    setCartsByChef({});
                }
            } catch (error) {
                console.error('Failed to load cart state:', error);
                setCartsByChef({});
            } finally {
                setCartReady(true);
            }
        };

        loadCartState();
    }, [storageKey]);

    useEffect(() => {
        if (!cartReady || !storageKey) return;

        const persistCartState = async () => {
            try {
                await AsyncStorage.setItem(storageKey, JSON.stringify({
                    cartsByChef,
                }));
            } catch (error) {
                console.error('Failed to save cart state:', error);
            }
        };

        persistCartState();
    }, [cartReady, cartsByChef, storageKey]);

    const orderItems = useMemo(() => {
        if (!activeChefId) return [];
        return cartsByChef[String(activeChefId)] || [];
    }, [activeChefId, cartsByChef]);

    const updateOrderItems = useCallback((updater) => {
        if (!activeChefId) return;

        setCartsByChef((previous) => {
            const chefKey = String(activeChefId);
            const currentItems = previous[chefKey] || [];
            const nextItems = typeof updater === 'function' ? updater(currentItems) : updater;

            return {
                ...previous,
                [chefKey]: nextItems,
            };
        });
    }, [activeChefId]);

    const clearActiveCart = useCallback(() => {
        if (!activeChefId) return;

        setCartsByChef((previous) => {
            const next = { ...previous };
            delete next[String(activeChefId)];
            return next;
        });
    }, [activeChefId]);

    const contextValue = {
        cartReady,
        activeChefId,
        orderItems,
        setActiveChefId,
        updateOrderItems,
        clearActiveCart,
    };

    return (
        <CartContext.Provider value={contextValue}>
            {children}
        </CartContext.Provider>
    );
}