import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useRef, useEffect } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, TextInput, Keyboard, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import getEnvVars from '../../config';

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

const validatePassword = (password) => {
  const requirements = [
    { test: /.{8,}/, message: 'At least 8 characters' },
    { test: /[A-Z]/, message: 'At least one uppercase letter' },
    { test: /[a-z]/, message: 'At least one lowercase letter' },
    { test: /[0-9]/, message: 'At least one number' },
    { test: /[!@#$%^&*(),.?":{}|<>]/, message: 'At least one special character' },
  ];
  return requirements.map((req) => ({ message: req.message, met: req.test.test(password) }));
};

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams();
  const { apiUrl } = getEnvVars();

  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRefs = useRef([]);

  const passwordRequirements = validatePassword(password);
  const passwordValid = passwordRequirements.every((r) => r.met);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const codeComplete = digits.every((d) => d !== '');
  const canSubmit = codeComplete && passwordValid && passwordsMatch && !submitting;

  useEffect(() => {
    const timer = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: digits.join(''), new_password: password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(ERROR_MESSAGES[data.error] || data.error || 'Reset failed');
        return;
      }
      Alert.alert('Success', 'Your password has been reset. Please sign in.', [
        { text: 'OK', onPress: () => router.replace('/SignInScreen') },
      ], { cancelable: false });
    } catch (e) {
      setError('Network error: ' + e.message);
    } finally {
      setSubmitting(false);
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
        body: JSON.stringify({ email, purpose: 'password_reset' }),
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
    if (router.canGoBack()) { router.back(); return; }
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>
          Enter the {CODE_LENGTH}-digit code sent to{'\n'}
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

        <TouchableOpacity onPress={handleResend} disabled={cooldown > 0 || resending} style={styles.resendRow}>
          <Text style={styles.resendText}>
            {resending ? 'Sending...' : cooldown > 0 ? `Resend code in ${cooldown}s` : "Didn't get a code? Resend"}
          </Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <Text style={styles.inputLabel}>New password</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="New password"
            placeholderTextColor="#aab4a8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!passwordVisible}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setPasswordVisible(!passwordVisible)}>
            <Text style={styles.eyeIcon}>{passwordVisible ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.inputLabel}>Confirm new password</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Confirm new password"
            placeholderTextColor="#aab4a8"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!confirmVisible}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setConfirmVisible(!confirmVisible)}>
            <Text style={styles.eyeIcon}>{confirmVisible ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>
        {confirmPassword.length > 0 && !passwordsMatch && (
          <Text style={styles.errorText}>Passwords do not match</Text>
        )}

        {password.length > 0 && (
          <View style={styles.reqBox}>
            {passwordRequirements.map((req, i) => (
              <Text key={i} style={[styles.reqText, { color: req.met ? GREEN : '#9ca3af' }]}>
                {req.met ? '✓' : '○'}  {req.message}
              </Text>
            ))}
          </View>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.85}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Reset Password</Text>}
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
    fontSize: 26, fontWeight: '700', color: TEXT,
    letterSpacing: -0.5, marginBottom: 10, textAlign: 'center',
  },
  subtitle: {
    fontSize: 14, color: '#6b8f71', textAlign: 'center',
    marginBottom: 20, lineHeight: 20,
  },
  emailText: { color: GREEN, fontWeight: '600' },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  codeBox: {
    width: 46, height: 56, borderWidth: 1.5, borderColor: '#dde8dd', borderRadius: 12,
    backgroundColor: '#fff', fontSize: 22, fontWeight: '700', color: TEXT,
  },
  codeBoxFilled: { borderColor: GREEN, backgroundColor: GREEN_LIGHT },
  codeBoxError: { borderColor: '#e53e3e' },
  resendRow: { alignItems: 'center', marginBottom: 8 },
  resendText: { fontSize: 14, color: GREEN, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#e2ece2', marginVertical: 16 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#3d6b4f', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#dde8dd',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: TEXT,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#dde8dd', borderRadius: 12, paddingRight: 12,
  },
  eyeBtn: { padding: 4 },
  eyeIcon: { fontSize: 16 },
  reqBox: { backgroundColor: GREEN_LIGHT, borderRadius: 12, padding: 12, marginTop: 10 },
  reqText: { fontSize: 12, marginBottom: 3 },
  errorText: { fontSize: 13, color: '#e53e3e', marginTop: 8 },
  primaryBtn: {
    backgroundColor: GREEN, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 18,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  backBtn: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  backBtnText: { fontSize: 14, color: '#8aab8a' },
});
