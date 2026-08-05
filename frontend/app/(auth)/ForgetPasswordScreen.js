import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import getEnvVars from '../../config';

const BG = '#fefce8';
const GREEN = '#2d6a4f';
const TEXT = '#1a2e1a';

const validateEmail = (email) => /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);

export default function ForgetPassword() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const router = useRouter();
  const { apiUrl } = getEnvVars();

  const handleBack = () => {
    if (router.canGoBack()) { router.back(); return; }
    router.replace('/');
  };

  const handleSendCode = async () => {
    if (!validateEmail(email) || sending) return;
    setSending(true);
    try {
      const response = await fetch(`${apiUrl}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      // Response is intentionally generic either way (doesn't reveal whether the
      // account exists), so we always move forward to the code-entry screen.
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        Alert.alert('Error', data.error || 'Something went wrong. Please try again.');
        return;
      }
      router.push({ pathname: '/ResetPasswordScreen', params: { email: email.trim().toLowerCase() } });
    } catch (e) {
      Alert.alert('Error', 'Network error: ' + e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>
          Enter your account email and we'll send you a code to reset your password.
        </Text>

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

        <TouchableOpacity
          style={[styles.primaryBtn, (!validateEmail(email) || sending) && styles.primaryBtnDisabled]}
          onPress={handleSendCode}
          disabled={!validateEmail(email) || sending}
          activeOpacity={0.85}
        >
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send Reset Code</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Return to Sign In</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  title: {
    fontSize: 26, fontWeight: '700', color: TEXT,
    letterSpacing: -0.5, marginBottom: 10, textAlign: 'center',
  },
  subtitle: {
    fontSize: 14, color: '#6b8f71', textAlign: 'center',
    marginBottom: 28, lineHeight: 20,
  },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#3d6b4f', marginBottom: 6 },
  input: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#dde8dd',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: TEXT, marginBottom: 20,
  },
  primaryBtn: {
    backgroundColor: GREEN, paddingVertical: 16, borderRadius: 14, alignItems: 'center',
    shadowColor: GREEN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  backBtn: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  backBtnText: { fontSize: 14, color: '#8aab8a' },
});
