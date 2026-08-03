import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View, TouchableOpacity, StyleSheet, TextInput, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import getEnvVars from '../../config';
import { useAuth } from '../context/AuthContext';

export default function Signin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const router = useRouter();
  const { apiUrl } = getEnvVars();
  const { login } = useAuth();

  const handleBack = () => {
    if (router.canGoBack()) { router.back(); return; }
    router.replace('/');
  };

  const handleSignin = async () => {
    try {
      const response = await fetch(`${apiUrl}/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === 'account_not_verified') {
          router.push({ pathname: '/VerifyCodeScreen', params: { email: data.email || email, purpose: 'signup' } });
          return;
        }
        Alert.alert('Sign In Failed', data.error || 'Please check your credentials.');
        return;
      }
      if (data.requires_2fa) {
        router.push({ pathname: '/VerifyCodeScreen', params: { email, purpose: 'login_2fa' } });
        return;
      }
      await login(data.token, data.user_type, data.user_id, data.profile_id);
      if (data.user_type === 'customer') router.replace('/(tabs)/SearchScreen');
      else if (data.user_type === 'chef') router.replace('/(tabs)/BookingsScreen');
    } catch (error) {
      Alert.alert('Error', 'Could not connect to server: ' + error.message);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.inner}>

        {/* Logo */}
        <View style={styles.logoArea}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your ChefAsap account</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>

          {/* Email */}
          <Text style={styles.inputLabel}>Email address</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor="#aab4a8"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          {/* Password */}
          <Text style={styles.inputLabel}>Password</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Enter your password"
              placeholderTextColor="#aab4a8"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!passwordVisible}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setPasswordVisible(!passwordVisible)}
            >
              <Text style={styles.eyeIcon}>{passwordVisible ? '🙈' : '👁'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => router.push('/ForgetPasswordScreen')} style={styles.forgotRow}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        {/* Sign In Button */}
        <TouchableOpacity style={styles.primaryBtn} onPress={handleSignin} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Sign In</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Create Account */}
        <View style={styles.signupRow}>
          <Text style={styles.signupPrompt}>Don't have an account?</Text>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push('/SignUpScreen')}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryBtnText}>Create Account</Text>
          </TouchableOpacity>
        </View>

      </View>

      {/* Back */}
      <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
        <Text style={styles.backBtnText}>← Back</Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8faf8' },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  logoArea: { alignItems: 'center', marginBottom: 32 },
  logo: { width: 100, height: 100, borderRadius: 28, marginBottom: 16 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1a2e1a',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: { fontSize: 14, color: '#6b8f71', textAlign: 'center' },
  form: { marginBottom: 8 },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3d6b4f',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#dde8dd',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#1a2e1a',
    marginBottom: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#dde8dd',
    borderRadius: 12,
    marginBottom: 4,
    paddingRight: 12,
  },
  eyeBtn: { padding: 4 },
  eyeIcon: { fontSize: 16 },
  forgotRow: { alignSelf: 'flex-end', marginTop: 8, marginBottom: 4 },
  forgotText: { fontSize: 13, color: GREEN, fontWeight: '500' },
  primaryBtn: {
    backgroundColor: GREEN,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 22 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e2ece2' },
  dividerText: { marginHorizontal: 12, fontSize: 13, color: '#8aab8a' },
  signupRow: { alignItems: 'center', gap: 10 },
  signupPrompt: { fontSize: 14, color: '#6b8f71' },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: GREEN,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  secondaryBtnText: { color: GREEN, fontSize: 15, fontWeight: '600' },
  backBtn: { paddingVertical: 16, alignItems: 'center' },
  backBtnText: { fontSize: 14, color: '#8aab8a' },
});