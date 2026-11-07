import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { ledgerColors as C } from '@/theme/ledger';

type LedgerMetricCardProps = {
  icon: ReactNode;
  label: string;
  value: number;
  color: string;
};

export function LedgerMetricCard({ icon, label, value, color }: LedgerMetricCardProps) {
  return (
    <View
      style={{
        width: '47%',
        flexGrow: 0,
        flexShrink: 0,
        minHeight: 78,
        alignItems: 'flex-start',
        backgroundColor: 'rgba(8,9,15,0.42)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
        paddingHorizontal: 12,
        paddingVertical: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 7, width: '100%' }}>
        {icon}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ flexShrink: 1, color: C.text3, fontSize: 9, letterSpacing: 1.25, textTransform: 'uppercase', fontWeight: '700' }}>
          {label}
        </Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
        ₱{value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
      </Text>
    </View>
  );
}
