import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

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
        alignItems: 'flex-start',
        backgroundColor: 'rgba(8,9,15,0.42)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
        padding: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        {icon}
        <Text style={{ color: '#999ba3', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '700' }}>
          {label}
        </Text>
      </View>
      <Text style={{ color, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
        ₱{value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
      </Text>
    </View>
  );
}
