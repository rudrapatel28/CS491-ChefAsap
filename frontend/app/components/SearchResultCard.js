import React, { useState, useEffect } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Octicons from '@expo/vector-icons/Octicons';
import getEnvVars from "../../config";
import { useAuth } from "../context/AuthContext";
import ProfilePicture from './ProfilePicture';
import RatingsDisplay from './RatingsDisplay';

const GREEN = '#2d6a4f';

function formatDistance(miles) {
    if (miles == null || miles === '') return '—';

    const n = Number(miles);

    if (Number.isNaN(n)) return '—';

    return `${n.toFixed(1)} mi`;
}


export default function SearchResultCard({
    chef_id,
    first_name,
    last_name,
    distance,
    cuisine,
    timing,
    average_rating,
    review_count,
    hourly_rate,
}) {

    const [photoData, setPhotoData] = useState(null);

    const {
        token,
        isGuestBrowsing
    } = useAuth();


    const router = useRouter();

    const { apiUrl } = getEnvVars();

    const [loading, setLoading] = useState(true);



    const handleChefPress = () => {
        router.push({
            pathname: `/ChefProfileScreen/${chef_id}`,
            params: {
                distance,
                guest: isGuestBrowsing ? "true" : "false",
            },
        });
    };



    useEffect(() => {

        const fetchPhoto = async () => {

            if (!chef_id) return;

            setLoading(true);


            try {

                const url = `${apiUrl}/profile/chef/${chef_id}/photo`;


                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token && {
                            'Authorization': `Bearer ${token}`
                        }),
                    },
                });


                const data = await response.json();


                if (response.ok) {
                    setPhotoData(data.photo_url);
                }


            } catch (err) {

            } finally {

                setLoading(false);

            }

        };


        fetchPhoto();


    }, [chef_id, token]);



    const cuisineLine = Array.isArray(cuisine) && cuisine.length > 0
        ? cuisine.filter(Boolean).join(' · ')
        : null;


    const timings = Array.isArray(timing)
        ? timing.filter(Boolean)
        : [];


    const rateNum = hourly_rate != null
        ? Number(hourly_rate)
        : null;


    const showRate = rateNum != null && !Number.isNaN(rateNum);



    return (

        <Pressable
            onPress={handleChefPress}
            style={({ pressed }) => [
                s.card,
                pressed && { opacity: 0.92 }
            ]}
        >

            <View style={s.body}>


                <View style={s.topRow}>


                    {
                        loading ? (

                            <View style={s.avatarPlaceholder}>
                                <ActivityIndicator
                                    size="small"
                                    color={GREEN}
                                />
                            </View>


                        ) : (
                            <View
                                style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: 24,
                                    overflow: 'hidden',
                                    flexShrink: 0,
                                }}
                            >
                                <ProfilePicture
                                    photoUrl={photoData}
                                    firstName={first_name}
                                    lastName={last_name}
                                    size={48}
                                />
                            </View>

                        )

                    }



                    <View style={s.nameBlock}>


                        <View style={s.nameRow}>


                            <Text
                                numberOfLines={1}
                                style={s.name}
                            >
                                {first_name} {last_name}
                            </Text>



                            <View style={s.distRow}>

                                <Octicons
                                    name="location"
                                    size={13}
                                    color="#8aab8a"
                                />

                                <Text style={s.distText}>
                                    {formatDistance(distance)}
                                </Text>

                            </View>


                        </View>



                        {
                            cuisineLine ? (

                                <Text
                                    numberOfLines={1}
                                    style={s.cuisine}
                                >
                                    {cuisineLine}
                                </Text>

                            ) : null
                        }


                    </View>


                </View>




                {
                    timings.length > 0 && (

                        <View style={s.tagsRow}>

                            {
                                timings.map((label, index) => (

                                    <View
                                        key={`${label}-${index}`}
                                        style={s.tag}
                                    >

                                        <Text style={s.tagText}>
                                            {label}
                                        </Text>


                                    </View>

                                ))
                            }


                        </View>

                    )
                }



            </View>





            <View style={s.footer}>


                <RatingsDisplay
                    rating={average_rating}
                    reviewCount={review_count ?? 0}
                    contentClassName="justify-start"
                />



                {
                    showRate ? (

                        <Text style={s.rate}>
                            from ${Math.round(rateNum)}/hr
                        </Text>


                    ) : (

                        <Text style={s.viewBtn}>
                            View
                        </Text>

                    )
                }


            </View>


        </Pressable>

    );

}




const s = StyleSheet.create({

    card: {
        backgroundColor: '#fff',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#e2ece2',
        marginBottom: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
        elevation: 2,
    },


    body: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 10,
    },


    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },


    avatarPlaceholder: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#d8f3dc',
        alignItems: 'center',
        justifyContent: 'center',
    },


    nameBlock: {
        flex: 1,
        minWidth: 0,
    },


    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },


    name: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1a2e1a',
        flex: 1,
    },


    distRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },


    distText: {
        fontSize: 13,
        color: '#8aab8a',
    },


    cuisine: {
        fontSize: 13,
        color: '#6b8f71',
        marginTop: 3,
    },


    tagsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 10,
        paddingLeft: 60,
    },


    tag: {
        backgroundColor: '#d8f3dc',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
    },


    tagText: {
        fontSize: 12,
        fontWeight: '600',
        color: GREEN,
    },


    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: '#f0f5f0',
        backgroundColor: '#f8faf8',
    },


    rate: {
        fontSize: 13,
        fontWeight: '700',
        color: GREEN,
    },


    viewBtn: {
        fontSize: 13,
        fontWeight: '600',
        color: GREEN,
    },

});