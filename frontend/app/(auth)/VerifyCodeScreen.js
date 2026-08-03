import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useRef, useEffect } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, TextInput, Keyboard, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import getEnvVars from '../../config';
import { useAuth } from '../context/AuthContext';

const BG = '#fefce8';
const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';
const TEXT = '#1a2e1a';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

const ERROR_MESSAGES = {
  invalid_code: 'Incorrect code, please try again.',
  expired: 'This code has expired. Tap resend to get a new one.',
  too_many_attempts: 'Too many incorrect attempts. Tap resend to get a new code.',
  no_code: 'No active code found. Tap resend to get a new one.',
};

export default function VerifyCodeScreen() {
  const router = useRouter();
  const { email, purpose = 'signup' } = useLocalSearchParams();
  const { apiUrl } = getEnvVars();
  const { login, clearPendingVerification } = useAuth();

  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRefs = useRef([]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleVerify = async (code) => {
    if (verifying || code.length !== CODE_LENGTH) return;
    setVerifying(true);
    setError('');
    try {
      const verifyEndpoint = purpose === 'login_2fa' ? '/auth/verify-2fa' : '/auth/verify-signup';
      const response = await fetch(`${apiUrl}${verifyEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(ERROR_MESSAGES[data.error] || data.error || 'Verification failed');
        setDigits(Array(CODE_LENGTH).fill(''));
        inputRefs.current[0]?.focus();
        return;
      }
      clearPendingVerification();
      await login(data.token, data.user_type, data.user_id, data.profile_id);
      router.replace(data.user_type === 'chef' ? '/(tabs)/BookingsScreen' : '/(tabs)/SearchScreen');
    } catch (e) {
      setError('Network error: ' + e.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleChangeDigit = (text, index) => {
    const clean = text.replace(/[^0-9]/g, '');
    const next = [...digits];

    if (!clean) {
      next[index] = '';
      setDigits(next);
      return;
    }

    next[index] = clean[clean.length - 1];
    setDigits(next);

    if (index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    } else {
      Keyboard.dismiss();
      if (next.every((d) => d !== '')) handleVerify(next.join(''));
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/auth/resend-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error === 'cooldown' && data.retry_after_seconds) {
          setCooldown(data.retry_after_seconds);
        } else {
          setError(data.error || 'Failed to resend code');
        }
        return;
      }
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setDigits(Array(CODE_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } catch (e) {
      setError('Network error: ' + e.message);
    } finally {
      setResending(false);
    }
  };

  const handleBack = () => {
    clearPendingVerification();
    if (router.canGoBack()) { router.back(); return; }
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <Text style={styles.title}>Verify your email</Text>
        <Text style={styles.subtitle}>
          We sent a {CODE_LENGTH}-digit code to{'\n'}
          <Text style={styles.emailText}>{email}</Text>
        </Text>

        <View style={styles.codeRow}>
          {digits.map((digit, i) => (
            <TextInput
              key={i}
              ref={(ref) => { inputRefs.current[i] = ref; }}
              style={[styles.codeBox, digit ? styles.codeBoxFilled : null, error ? styles.codeBoxError : null]}
              value={digit}
              onChangeText={(t) => handleChangeDigit(t, i)}
              onKeyPress={(e) => handleKeyPress(e, i)}
              keyboardType="number-pad"
              maxLength={1}
              textAlign="center"
              selectTextOnFocus
            />
          ))}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.primaryBtn, verifying && styles.primaryBtnDisabled]}
          onPress={() => handleVerify(digits.join(''))}
          disabled={verifying}
          activeOpacity={0.85}
        >
          {verifying ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleResend} disabled={cooldown > 0 || resending} style={styles.resendRow}>
          <Text style={styles.resendText}>
            {resending
              ? 'Sending...'
              : cooldown > 0
                ? `Resend code in ${cooldown}s`
                : "Didn't get a code? Resend"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: TEXT,
    letterSpacing: -0.5,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b8f71',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  emailText: { color: GREEN, fontWeight: '600' },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  codeBox: {
    width: 46,
    height: 56,
    borderWidth: 1.5,
    borderColor: '#dde8dd',
    borderRadius: 12,
    backgroundColor: '#fff',
    fontSize: 22,
    fontWeight: '700',
    color: TEXT,
  },
  codeBoxFilled: { borderColor: GREEN, backgroundColor: GREEN_LIGHT },
  codeBoxError: { borderColor: '#e53e3e' },
  errorText: { fontSize: 13, color: '#e53e3e', textAlign: 'center', marginBottom: 16 },
  primaryBtn: {
    backgroundColor: GREEN,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  resendRow: { alignItems: 'center', marginTop: 20 },
  resendText: { fontSize: 14, color: GREEN, fontWeight: '600' },
  backBtn: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  backBtnText: { fontSize: 14, color: '#8aab8a' },
});
