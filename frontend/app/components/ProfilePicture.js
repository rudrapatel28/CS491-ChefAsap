import { View, Text, Image } from "react-native";
import getEnvVars from "../../config";

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';

export default function ProfilePicture({
    photoUrl = '',
    firstName = '',
    lastName = '',
    size = 128,
}) {
    const { apiUrl } = getEnvVars();

    const diameter = size;
    const borderWidth = Math.max(2, size / 16);
    const fontSize = size * 0.35;

    const initials =
        `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();

    const getImageUri = () => {
        if (!photoUrl) return null;
        if (photoUrl.startsWith('data:')) return photoUrl;
        if (photoUrl.startsWith('http')) return photoUrl;
        if (photoUrl.startsWith('/static/')) return null;

        return `${apiUrl}${photoUrl}`;
    };

    const imageUri = getImageUri();

    return (
        <View style={{ alignItems: 'center' }}>
            {imageUri ? (
                <Image
                    source={{ uri: imageUri }}
                    style={{
                        width: diameter,
                        height: diameter,
                        borderRadius: diameter / 2,
                        borderWidth,
                        borderColor: GREEN_LIGHT,
                    }}
                    resizeMode="cover"
                />
            ) : (
                <View
                    style={{
                        width: diameter,
                        height: diameter,
                        borderRadius: diameter / 2,
                        borderWidth,
                        borderColor: GREEN,
                        backgroundColor: GREEN_LIGHT,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Text
                        style={{
                            fontSize,
                            fontWeight: '700',
                            color: GREEN,
                        }}
                    >
                        {initials}
                    </Text>
                </View>
            )}
        </View>
    );
}