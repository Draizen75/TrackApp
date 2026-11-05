import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleProp, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { ledgerColors as C, ledgerRadius, ledgerTypography } from '@/theme/ledger';

type GoldButtonProps = {
  label: string;
  onPress: () => void | Promise<void>;
  accessibilityLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function GoldButton({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
  loading = false,
  leadingIcon,
  style,
}: GoldButtonProps) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => { void onPress(); }}
      activeOpacity={0.82}
      style={[{ borderRadius: ledgerRadius.control, overflow: 'hidden', opacity: disabled ? 0.55 : 1 }, style]}
    >
      <LinearGradient
        colors={['#fff2bb', C.accent, C.accentHot]}
        locations={[0, 0.48, 1]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={{
          minHeight: 48,
          paddingHorizontal: 16,
          paddingVertical: 13,
          borderRadius: ledgerRadius.control,
          borderWidth: 1,
          borderColor: 'rgba(255,247,228,0.78)',
          boxShadow: '0 4px 16px rgba(255,176,32,0.2)',
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {loading ? <ActivityIndicator size="small" color="#17140d" /> : leadingIcon}
        <Text style={{ color: '#17140d', fontSize: ledgerTypography.body, fontWeight: '800', letterSpacing: 0.35 }}>
          {label}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}
