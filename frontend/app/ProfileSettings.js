import { useEffect, useState } from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch } from "react-native";
import { useAuth } from "./context/AuthContext";
import getEnvVars from "../config";
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Octicons } from "@expo/vector-icons";
import LoadingIcon from "./components/LoadingIcon";
import Input from "./components/Input";
import CustomPicker from "./components/Picker";
import ProfilePicture from "./components/ProfilePicture";

const GREEN = '#2d6a4f';
const GREEN_LIGHT = '#d8f3dc';
const BG = '#fefce8';
const BORDER = '#e2ece2';
const TEXT = '#1a2e1a';
const TEXT_MID = '#4a7c59';
const TEXT_SOFT = '#8aab8a';

const filterNameCharacters = (t) => t.replace(/[^a-zA-Z\s'-]/g, '');

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

const SectionCard = ({ title, icon, children }) => (
  <View style={s.card}>
    <View style={s.sectionHeader}>
      {icon && <Octicons name={icon} size={18} color={GREEN} style={{ marginRight: 8 }} />}
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
    <View style={s.sectionBody}>{children}</View>
  </View>
);

const InfoRow = ({ label, value }) => (
  <View style={s.infoRow}>
    <Text style={s.infoLabel}>{label}</Text>
    <Text style={s.infoValue}>{value || '—'}</Text>
  </View>
);

export default function ProfileSettings() {
  const { profileId, userType, userId } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { apiUrl } = getEnvVars();

  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);

  const privateQuery = userType === 'chef' ? '?private=true' : '';
  const API_URL = `${apiUrl}/profile/${userType}/${profileId}${privateQuery}`;

  useEffect(() => {
    if (!profileId) return;
    fetch(API_URL)
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error);
        else { setProfile(data.profile); setForm(data.profile); }
      })
      .catch(() => setError("Network error"));
  }, [profileId, API_URL]);

  useEffect(() => {
    if (!userId) return;
    fetch(`${apiUrl}/auth/2fa-settings?user_id=${userId}`)
      .then(res => res.json())
      .then(data => { if (!data.error) setTwoFactorEnabled(!!data.two_factor_enabled); })
      .catch(() => {});
  }, [userId]);

  const handleToggle2FA = async (value) => {
    setTwoFactorLoading(true);
    try {
      const res = await fetch(`${apiUrl}/auth/2fa-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, enabled: value, method: "email" }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to update 2FA setting"); return; }
      setTwoFactorEnabled(data.two_factor_enabled);
    } catch (e) {
      alert("Network error updating 2FA setting");
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleChange = (field, value) => setForm({ ...form, [field]: value });
  const handleAddressChange = (field, value) => setForm({ ...form, full_address: { ...form.full_address, [field]: value } });

  const handleSave = () => {
    const payload = {
      ...form,
      address_line1: form.full_address?.address_line1 || "",
      address_line2: form.full_address?.address_line2 || "",
      city: form.full_address?.city || "",
      state: form.full_address?.state || "",
      zip_code: form.full_address?.zip_code || "",
    };
    delete payload.full_address;
    delete payload.email;

    fetch(API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error);
        else { setProfile({ ...profile, ...form }); setEditing(false); }
      })
      .catch(() => setError("Network error"));
  };

  const handleAccountDelete = async () => {
    try {
      const res = await fetch(`${apiUrl}/deletion_request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: profileId, user_type: userType, user_email: profile.email, delete_type: 'hard_delete', reason: "User requested account deletion" }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to start deletion request."); return; }
      const { request_id, confirmation_code } = data;
      const confirmRes = await fetch(`${apiUrl}/confirm_deletion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id, confirmation_code }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) { alert(confirmData.error || "Failed to confirm deletion."); return; }
      alert("Account deleted. You will be logged out.");
    } catch (e) { alert("Network error during account deletion."); }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { alert('Permission denied'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.3,    // compress heavily
        base64: true,    // get base64 directly from picker, no upload needed
    });
    if (!result.canceled && result.assets?.length > 0) {
        setUploading(true);
        const asset = result.assets[0];
        const base64 = `data:image/jpeg;base64,${asset.base64}`;
        try {
            const response = await fetch(`${apiUrl}/profile/${userType}/${profileId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ photo_url: base64 }),
            });
            const data = await response.json();
            if (data.error) alert(data.error);
            else {
                setProfile({ ...profile, photo_url: base64 });
                setForm({ ...form, photo_url: base64 });
            }
        } catch (e) { alert('Error uploading image'); }
        setUploading(false);
    }
  };

  if (!profile || !form) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[s.screen, { justifyContent: 'center', alignItems: 'center', paddingTop: insets.top }]}>
          <LoadingIcon message="Loading Profile Settings..." />
        </View>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[s.screen, { justifyContent: 'center', alignItems: 'center', padding: 24, paddingTop: insets.top }]}>
          <Text style={{ color: '#ef4444', fontSize: 15, textAlign: 'center' }}>{error}</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: BG } }} />
      <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top, padding: 20, paddingBottom: 40 }}>

        {/* Header */}
        <View style={s.pageHeader}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Octicons name="chevron-left" size={22} color={GREEN} />
          </TouchableOpacity>
          <Text style={s.pageTitle}>Profile Settings</Text>
          <View style={{ width: 38 }} />
        </View>

        {/* Avatar */}
        <SectionCard title="Profile Photo" icon="person">
          <TouchableOpacity onPress={editing ? pickImage : undefined} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <ProfilePicture photoUrl={profile.photo_url} firstName={profile?.first_name} lastName={profile?.last_name} />
            {editing && (
              <Text style={s.changePhotoText}>{uploading ? "Uploading..." : "Tap to change profile picture"}</Text>
            )}
          </TouchableOpacity>
        </SectionCard>

        {/* Security */}
        <SectionCard title="Security" icon="shield">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={s.securityLabel}>Two-Factor Authentication</Text>
              <Text style={s.helperText}>
                {twoFactorEnabled
                  ? "We'll email you a code each time you sign in."
                  : "Add an extra layer of security to your account."}
              </Text>
            </View>
            <Switch
              value={twoFactorEnabled}
              onValueChange={handleToggle2FA}
              disabled={twoFactorLoading}
              trackColor={{ false: BORDER, true: GREEN_LIGHT }}
              thumbColor={twoFactorEnabled ? GREEN : '#fff'}
            />
          </View>
        </SectionCard>

        {editing ? (
          <>
            <SectionCard title="Personal Information" icon="person">
              <Text style={s.fieldLabel}>Name</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
                <View style={{ flex: 1 }}>
                  <Input placeholder="First Name" value={form.first_name}
                    onChangeText={v => handleChange("first_name", filterNameCharacters(v))}
                    containerClasses="mb-2 mt-0" />
                </View>
                <View style={{ flex: 1 }}>
                  <Input placeholder="Last Name" value={form.last_name}
                    onChangeText={v => handleChange("last_name", filterNameCharacters(v))}
                    containerClasses="mb-2 mt-0" />
                </View>
              </View>

              <Text style={s.fieldLabel}>Email Address</Text>
              <View style={s.disabledField}>
                <Text style={s.disabledFieldText}>{profile.email}</Text>
              </View>

              <Input label="Phone Number" value={form.phone}
                onChangeText={v => handleChange("phone", v)}
                keyboardType="phone-pad" placeholder="(555) 123-4567" maxLength={10} />
            </SectionCard>

            <SectionCard title="Your Address" icon="location">
              <Input label="Street Address" placeholder="123 Main Street"
                value={form.full_address?.address_line1 || ""}
                onChangeText={v => handleAddressChange("address_line1", v)} />
              <Input label="Apartment, Suite, etc. (Optional)" placeholder="Apt 4B"
                value={form.full_address?.address_line2 || ""}
                onChangeText={v => handleAddressChange("address_line2", v)} />
              <Input label="City" placeholder="City"
                value={form.full_address?.city || ""}
                onChangeText={v => handleAddressChange("city", v)} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <CustomPicker label="State" prompt="Select a State"
                    selectedValue={form.full_address?.state}
                    onValueChange={v => handleAddressChange("state", v)}
                    items={US_STATES} />
                </View>
                <View style={{ flex: 1 }}>
                  <Input label="Zip Code" placeholder="12345"
                    value={form.full_address?.zip_code || ""}
                    onChangeText={v => handleAddressChange("zip_code", v)}
                    keyboardType="numeric" maxLength={5} />
                </View>
              </View>
            </SectionCard>

            <SectionCard title="Other" icon="three-bars">
              {userType === 'customer' ? (
                <Input value={form.allergy_notes} onChangeText={v => handleChange("allergy_notes", v)}
                  label="Allergy Notes" placeholder="Any allergies..." isTextArea multiline />
              ) : (
                <Input value={form.description} onChangeText={v => handleChange("description", v)}
                  label="About / Bio" placeholder="Tell customers about yourself..."
                  isTextArea maxLength={500} multiline />
              )}
              <Text style={s.fieldLabel}>Member Since</Text>
              <View style={s.disabledField}>
                <Text style={s.disabledFieldText}>{profile.member_since}</Text>
              </View>
            </SectionCard>

            {/* Action buttons */}
            <TouchableOpacity style={s.primaryBtn} onPress={handleSave} activeOpacity={0.85}>
              <Text style={s.primaryBtnText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.deleteBtn} onPress={() => setDeleteConfirm(true)} activeOpacity={0.85}>
              <Text style={s.deleteBtnText}>Delete Account</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.outlineBtn} onPress={() => { setEditing(false); setForm(profile); }} activeOpacity={0.85}>
              <Text style={s.outlineBtnText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <SectionCard title="Personal Information" icon="person">
              <InfoRow label="Name" value={`${profile.first_name} ${profile.last_name}`} />
              <InfoRow label="Email" value={profile.email} />
              <InfoRow label="Phone" value={profile.phone} />
            </SectionCard>

            <SectionCard title="Your Address" icon="location">
              <InfoRow label="Address" value={profile.full_address?.address_line1} />
              {profile.full_address?.address_line2 && (
                <InfoRow label="Address 2" value={profile.full_address.address_line2} />
              )}
              <InfoRow label="City" value={profile.full_address?.city} />
              <InfoRow label="State" value={US_STATES.find(s => s.value === profile.full_address?.state)?.label} />
              <InfoRow label="Zip Code" value={profile.full_address?.zip_code} />
            </SectionCard>

            <SectionCard title="Other" icon="three-bars">
              {userType === 'customer' ? (
                <InfoRow label="Allergy Notes" value={profile.allergy_notes || "None"} />
              ) : (
                <InfoRow label="About / Bio" value={profile.description || "No description yet"} />
              )}
              <InfoRow label="Member Since" value={profile.member_since} />
            </SectionCard>

            <TouchableOpacity style={s.primaryBtn} onPress={() => setEditing(true)} activeOpacity={0.85}>
              <Text style={s.primaryBtnText}>Edit Information</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.outlineBtn} onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={s.outlineBtnText}>← Return</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Delete confirm modal */}
      <Modal visible={deleteConfirm} transparent animationType="fade" onRequestClose={() => setDeleteConfirm(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Delete your account?</Text>
            <Text style={s.modalBody}>This action cannot be undone.</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <TouchableOpacity style={[s.outlineBtn, { flex: 1 }]} onPress={() => setDeleteConfirm(false)}>
                <Text style={s.outlineBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.deleteBtn, { flex: 1, marginTop: 0 }]} onPress={() => { setDeleteConfirm(false); handleAccountDelete(); }}>
                <Text style={s.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  pageHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: GREEN_LIGHT, alignItems: 'center', justifyContent: 'center',
  },
  pageTitle: { fontSize: 20, fontWeight: '800', color: TEXT },
  card: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    marginBottom: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: TEXT },
  sectionBody: { padding: 16 },
  fieldLabel: {
    fontSize: 12, fontWeight: '700', color: TEXT_MID,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, marginTop: 8,
  },
  securityLabel: { fontSize: 14, fontWeight: '700', color: TEXT, marginBottom: 4 },
  helperText: { fontSize: 13, color: TEXT_SOFT, lineHeight: 18 },
  disabledField: {
    backgroundColor: '#f0f5f0', borderRadius: 12, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 16, paddingVertical: 12, marginBottom: 8,
  },
  disabledFieldText: { fontSize: 15, color: TEXT_SOFT },
  infoRow: {
    flexDirection: 'row', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f0',
  },
  infoLabel: { fontSize: 14, fontWeight: '700', color: TEXT, width: 100 },
  infoValue: { fontSize: 14, color: TEXT_MID, flex: 1 },
  changePhotoText: {
    fontSize: 13, color: TEXT_MID, marginTop: 8,
    textDecorationLine: 'underline',
  },
  primaryBtn: {
    backgroundColor: GREEN, paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', marginBottom: 10,
    shadowColor: GREEN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  outlineBtn: {
    paddingVertical: 15, borderRadius: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: BORDER, backgroundColor: '#fff', marginBottom: 10,
  },
  outlineBtnText: { color: TEXT_MID, fontWeight: '600', fontSize: 15 },
  deleteBtn: {
    backgroundColor: '#ef4444', paddingVertical: 15, borderRadius: 14,
    alignItems: 'center', marginBottom: 10,
  },
  deleteBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '85%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 8 },
  modalBody: { fontSize: 14, color: TEXT_SOFT },
});