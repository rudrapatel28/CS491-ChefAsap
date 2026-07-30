import { Text, View, Image, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';

export default function LandingScreen() {
  const router = useRouter();
  const { enterGuestMode } = useAuth();

  const handleGuestLogin = () => {
    enterGuestMode();
    router.replace('/(tabs)/SearchScreen');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.inner}>

        {/* Logo + Branding */}
        <View style={styles.logoArea}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.appName}>ChefAsap</Text>
          <Text style={styles.tagline}>Book a personal chef in minutes</Text>
        </View>

        {/* Feature Pills */}
        <View style={styles.pillsRow}>
          {['🍳 Home Cooking', '📍 Near You', '⭐ Top Chefs'].map((label) => (
            <View key={label} style={styles.pill}>
              <Text style={styles.pillText}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Buttons */}
        <View style={styles.btnGroup}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push('/SignUpScreen')}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Get Started</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push('/SignInScreen')}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryBtnText}>
              I already have an account
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={handleGuestLogin}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryBtnText}>
              Continue as Guest
            </Text>
          </TouchableOpacity>
        </View>

      </View>
    </SafeAreaView>
  );
}

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8faf8'
  },

  inner: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
    paddingVertical: 24,
  },

  logoArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  logo: {
    width: 130,
    height: 130,
    marginBottom: 20,
    borderRadius: 32,
  },

  appName: {
    fontSize: 36,
    fontWeight: '800',
    color: '#1a2e1a',
    letterSpacing: -1,
    marginBottom: 8,
  },

  tagline: {
    fontSize: 16,
    color: '#6b8f71',
    textAlign: 'center',
  },

  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 32,
  },

  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: GREEN_LIGHT,
    borderRadius: 20,
  },

  pillText: {
    fontSize: 12,
    color: GREEN,
    fontWeight: '600',
  },

  btnGroup: {
    gap: 12,
    paddingBottom: 8
  },

  primaryBtn: {
    backgroundColor: GREEN,
    paddingVertical: 17,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },

  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  secondaryBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: GREEN,
    backgroundColor: '#fff',
  },

  secondaryBtnText: {
    color: GREEN,
    fontSize: 15,
    fontWeight: '600',
  },
});