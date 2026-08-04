import { Platform } from 'react-native';

const getEnvVars = () => ({
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://chefasap-backend.onrender.com',
});

export default getEnvVars;