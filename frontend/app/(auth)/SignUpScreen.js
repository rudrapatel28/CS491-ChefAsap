import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CustomPicker from "../components/Picker";
import getEnvVars from '../../config';
import { useAuth } from '../context/AuthContext';

const validatePassword = (password) => {
  const requirements = [
    { test: /.{8,}/, message: 'At least 8 characters' },
    { test: /[A-Z]/, message: 'At least one uppercase letter' },
    { test: /[a-z]/, message: 'At least one lowercase letter' },
    { test: /[0-9]/, message: 'At least one number' },
    { test: /[!@#$%^&*]/, message: 'At least one special character (!@#$%^&*)' }
  ];
  return requirements.map(req => ({ message: req.message, met: req.test.test(password) }));
};

const validateEmail = (email) => /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
const filterName = (t) => t.replace(/[^a-zA-Z\s'-]/g, '');
const filterDigits = (t) => t.replace(/[^0-9]/g, '');
const filterAddress = (t) => t.replace(/[^a-zA-Z0-9\s.,\-\/#]/g, '');
const filterAlpha = (t) => t.replace(/[^a-zA-Z\s'-]/g, '');

const US_STATES = [
  { label: "State", value: "" },
  { label: "Alabama", value: "AL" }, { label: "Alaska", value: "AK" },
  { label: "Arizona", value: "AZ" }, { label: "Arkansas", value: "AR" },
  { label: "California", value: "CA" }, { label: "Colorado", value: "CO" },
  { label: "Connecticut", value: "CT" }, { label: "Delaware", value: "DE" },
  { label: "Florida", value: "FL" }, { label: "Georgia", value: "GA" },
  { label: "Hawaii", value: "HI" }, { label: "Idaho", value: "ID" },
  { label: "Illinois", value: "IL" }, { label: "Indiana", value: "IN" },
  { label: "Iowa", value: "IA" }, { label: "Kansas", value: "KS" },
  { label: "Kentucky", value: "KY" }, { label: "Louisiana", value: "LA" },
  { label: "Maine", value: "ME" }, { label: "Maryland", value: "MD" },
  { label: "Massachusetts", value: "MA" }, { label: "Michigan", value: "MI" },
  { label: "Minnesota", value: "MN" }, { label: "Mississippi", value: "MS" },
  { label: "Missouri", value: "MO" }, { label: "Montana", value: "MT" },
  { label: "Nebraska", value: "NE" }, { label: "Nevada", value: "NV" },
  { label: "New Hampshire", value: "NH" }, { label: "New Jersey", value: "NJ" },
  { label: "New Mexico", value: "NM" }, { label: "New York", value: "NY" },
  { label: "North Carolina", value: "NC" }, { label: "North Dakota", value: "ND" },
  { label: "Ohio", value: "OH" }, { label: "Oklahoma", value: "OK" },
  { label: "Oregon", value: "OR" }, { label: "Pennsylvania", value: "PA" },
  { label: "Rhode Island", value: "RI" }, { label: "South Carolina", value: "SC" },
  { label: "South Dakota", value: "SD" }, { label: "Tennessee", value: "TN" },
  { label: "Texas", value: "TX" }, { label: "Utah", value: "UT" },
  { label: "Vermont", value: "VT" }, { label: "Virginia", value: "VA" },
  { label: "Washington", value: "WA" }, { label: "West Virginia", value: "WV" },
  { label: "Wisconsin", value: "WI" }, { label: "Wyoming", value: "WY" },
];

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';

// Lightweight input using StyleSheet — consistent with SignIn
const FormInput = ({ placeholder, value, onChangeText, keyboardType, autoCapitalize, secureTextEntry, maxLength, error, showToggle, onToggle, visible }) => (
  <View style={{ marginBottom: 10 }}>
    <View style={[
      styles.inputRow,
      error ? { borderColor: '#e53e3e' } : {}
    ]}>
      <TextInput
        style={[styles.input, showToggle && { flex: 1, marginBottom: 0 }]}
        placeholder={placeholder}
        placeholderTextColor="#aab4a8"
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize || 'sentences'}
        secureTextEntry={showToggle ? !visible : secureTextEntry}
        maxLength={maxLength}
      />
      {showToggle && (
        <TouchableOpacity style={{ padding: 4, paddingRight: 12 }} onPress={onToggle}>
          <Text style={{ fontSize: 16 }}>{visible ? '🙈' : '👁'}</Text>
        </TouchableOpacity>
      )}
    </View>
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
  </View>
);

export default function Signup() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [passwordMatchError, setPasswordMatchError] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [address2, setAddress2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [userType, setUserType] = useState('customer');
  const [passwordRequirements, setPasswordRequirements] = useState([]);
  const router = useRouter();
  const { apiUrl } = getEnvVars();
  const { setPendingVerification } = useAuth();

  const handleBack = () => {
    if (router.canGoBack()) { router.back(); return; }
    router.replace('/');
  };

  const showAlert = (title, message, onPress = null) => {
    Alert.alert(title, message, [{ text: 'OK', onPress: () => { if (onPress) onPress(); } }], { cancelable: false });
  };

  const handleSignup = async () => {
    if (!passwordRequirements.every(req => req.met)) { showAlert('Error', 'Please meet all password requirements'); return; }
    if (password !== confirmPassword) { showAlert('Error', 'Passwords do not match'); return; }
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !address.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      showAlert('Error', 'Please fill in all required fields'); return;
    }
    try {
      const response = await fetch(`${apiUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, password, user_type: userType, phone, address, address2, city, state, zip }),
      });
      const data = await response.json();
      if (!response.ok) { Alert.alert('Error', data.error || 'Signup failed'); return; }
      setPendingVerification(email, 'signup');
      router.push({ pathname: '/VerifyCodeScreen', params: { email, purpose: 'signup' } });
    } catch (error) {
      showAlert('Error', 'Network error: ' + error.message);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>
            Already have one?{' '}
            <Text style={styles.link} onPress={() => router.replace('/SignInScreen')}>Sign in</Text>
          </Text>
        </View>

        {/* Personal Info */}
        <Text style={styles.sectionLabel}>Personal Information</Text>
        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 6 }}>
            <FormInput placeholder="First Name" value={firstName} onChangeText={(t) => setFirstName(filterName(t))} />
          </View>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <FormInput placeholder="Last Name" value={lastName} onChangeText={(t) => setLastName(filterName(t))} />
          </View>
        </View>
        <FormInput
          placeholder="Email address"
          value={email}
          onChangeText={(t) => { setEmail(t); setEmailError(t.length > 0 && !validateEmail(t) ? 'Please enter a valid email' : ''); }}
          keyboardType="email-address"
          autoCapitalize="none"
          error={emailError}
        />
        <FormInput placeholder="Phone number" value={phone} onChangeText={(t) => setPhone(filterDigits(t))} keyboardType="phone-pad" maxLength={10} />

        <View style={styles.divider} />

        {/* Password */}
        <Text style={styles.sectionLabel}>Password</Text>
        <FormInput
          placeholder="Create a password"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            setPasswordRequirements(validatePassword(t));
            if (confirmPassword && t !== confirmPassword) setPasswordMatchError('Passwords do not match');
            else setPasswordMatchError('');
          }}
          showToggle
          visible={passwordVisible}
          onToggle={() => setPasswordVisible(!passwordVisible)}
        />
        <FormInput
          placeholder="Confirm password"
          value={confirmPassword}
          onChangeText={(t) => { setConfirmPassword(t); if (password && t !== password) setPasswordMatchError('Passwords do not match'); else setPasswordMatchError(''); }}
          showToggle
          visible={confirmVisible}
          onToggle={() => setConfirmVisible(!confirmVisible)}
          error={passwordMatchError}
        />
        {passwordRequirements.length > 0 && (
          <View style={styles.reqBox}>
            {passwordRequirements.map((req, i) => (
              <Text key={i} style={[styles.reqText, { color: req.met ? GREEN : '#9ca3af' }]}>
                {req.met ? '✓' : '○'}  {req.message}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.divider} />

        {/* Address */}
        <Text style={styles.sectionLabel}>Your Address</Text>
        <FormInput placeholder="Street address" value={address} onChangeText={(t) => setAddress(filterAddress(t))} />
        <FormInput placeholder="Apt, Suite, etc. (Optional)" value={address2} onChangeText={(t) => setAddress2(filterAddress(t))} />
        <FormInput placeholder="City" value={city} onChangeText={(t) => setCity(filterAlpha(t))} />
        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 6 }}>
            <CustomPicker prompt="State" selectedValue={state} onValueChange={(v) => setState(v)} items={US_STATES} />
          </View>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <FormInput placeholder="Zip Code" value={zip} onChangeText={(t) => setZip(filterDigits(t))} keyboardType="numeric" maxLength={5} />
          </View>
        </View>

        <View style={styles.divider} />

        {/* User Type */}
        <Text style={styles.sectionLabel}>I am a...</Text>
        <View style={styles.row}>
          {[
            { type: 'customer', label: 'Customer', sub: 'Looking for chefs' },
            { type: 'chef', label: 'Chef', sub: 'Offering services' },
          ].map(({ type, label, sub }) => (
            <TouchableOpacity
              key={type}
              style={[
                styles.typeCard,
                userType === type ? styles.typeCardActive : styles.typeCardInactive,
                type === 'customer' ? { marginRight: 6 } : { marginLeft: 6 }
              ]}
              onPress={() => setUserType(type)}
              activeOpacity={0.8}
            >
              <Text style={[styles.typeLabel, { color: userType === type ? GREEN : '#6b8f71' }]}>{label}</Text>
              <Text style={styles.typeSub}>{sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.divider} />

        {/* Submit */}
        <TouchableOpacity style={styles.primaryBtn} onPress={handleSignup} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Create Account</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8faf8' },
  scrollContent: { paddingHorizontal: 28, paddingBottom: 32 },
  header: { marginTop: 24, marginBottom: 28 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a2e1a', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#6b8f71' },
  link: { color: GREEN, fontWeight: '600' },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#8aab8a',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12,
  },
  row: { flexDirection: 'row' },
  divider: { height: 1, backgroundColor: '#e2ece2', marginVertical: 20 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#dde8dd',
    borderRadius: 12,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#1a2e1a',
    flex: 1,
  },
  errorText: { fontSize: 12, color: '#e53e3e', marginTop: 4, marginLeft: 4 },
  reqBox: { backgroundColor: GREEN_LIGHT, borderRadius: 12, padding: 12, marginBottom: 10 },
  reqText: { fontSize: 12, marginBottom: 3 },
  typeCard: {
    flex: 1, paddingVertical: 18, borderRadius: 14,
    alignItems: 'center', borderWidth: 1.5, marginBottom: 8,
  },
  typeCardActive: { backgroundColor: GREEN_LIGHT, borderColor: GREEN },
  typeCardInactive: { backgroundColor: '#fff', borderColor: '#dde8dd' },
  typeLabel: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  typeSub: { fontSize: 12, color: '#8aab8a' },
  primaryBtn: {
    backgroundColor: GREEN, paddingVertical: 17, borderRadius: 14, alignItems: 'center',
    shadowColor: GREEN, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  backBtn: { paddingVertical: 16, alignItems: 'center' },
  backBtnText: { fontSize: 14, color: '#8aab8a' },
});