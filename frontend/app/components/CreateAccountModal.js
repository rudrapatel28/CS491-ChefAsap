import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

export default function CreateAccountModal({ onClose }) {

    return (
        <View style={styles.container}>

            <Text style={styles.title}>
                Create an Account
            </Text>

            <Text style={styles.message}>
                Create an account to access bookings, messages, and your profile.
            </Text>

            <TouchableOpacity
                style={styles.button}
                onPress={onClose}
            >
                <Text style={styles.buttonText}>
                    Close
                </Text>
            </TouchableOpacity>

        </View>
    );
}


const styles = StyleSheet.create({

    container: {
        width: "80%",
        backgroundColor: "#fefce8",
        borderRadius: 15,
        padding: 25,
        alignItems: "center",
    },

    title: {
        fontSize: 20,
        fontWeight: "700",
        marginBottom: 10,
        color: "#2d6a4f",
    },

    message: {
        textAlign: "center",
        marginBottom: 20,
        color: "#444",
    },

    button: {
        backgroundColor: "#2d6a4f",
        paddingHorizontal: 25,
        paddingVertical: 12,
        borderRadius: 10,
    },

    buttonText: {
        color: "white",
        fontWeight: "600",
    }

});