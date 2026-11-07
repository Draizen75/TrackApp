import type { ReactNode } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { AlertCircle, Inbox } from 'lucide-react-native';
import { ledgerColors as C, ledgerRadius, ledgerSpacing } from '@/theme/ledger';

type StateTone = 'neutral' | 'accent';

export function LedgerLoadingState({ label = 'Loading your ledger…' }: { label?: string }) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 180,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: C.bg,
        padding: ledgerSpacing.xl,
      }}
    >
      <ActivityIndicator size="small" color={C.accent} />
      <Text
        accessibilityLabel={label}
        style={{ color: C.text2, fontSize: 13, fontWeight: '600', marginTop: ledgerSpacing.sm }}
      >
        {label}
      </Text>
    </View>
  );
}

export function LedgerEmptyState({
  title,
  description,
  icon,
  action,
  tone = 'neutral',
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: StateTone;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: ledgerSpacing.lg,
        paddingVertical: ledgerSpacing.xl,
        borderRadius: ledgerRadius.card,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.surface,
        gap: ledgerSpacing.xs,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: ledgerRadius.control,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tone === 'accent' ? C.accentDim : C.surface2,
          marginBottom: 4,
        }}
      >
        {icon ?? <Inbox size={20} color={tone === 'accent' ? C.accent : C.text3} />}
      </View>
      <Text style={{ color: C.text1, fontSize: 14, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
      {description ? (
        <Text style={{ color: C.text3, fontSize: 12, lineHeight: 18, textAlign: 'center' }}>{description}</Text>
      ) : null}
      {action}
    </View>
  );
}

export function LedgerErrorState({
  title = 'Something went wrong',
  description = 'Your data could not be loaded. Check your connection and try again.',
  onRetry,
  compact = false,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: compact ? ledgerSpacing.md : ledgerSpacing.xl,
        borderRadius: ledgerRadius.card,
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.32)',
        backgroundColor: C.dangerDim,
        gap: ledgerSpacing.xs,
      }}
    >
      <AlertCircle size={20} color={C.danger} />
      <Text style={{ color: C.text1, fontSize: 14, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
      <Text style={{ color: C.text2, fontSize: 12, lineHeight: 18, textAlign: 'center' }}>{description}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={onRetry}
        style={{
          marginTop: ledgerSpacing.xs,
          paddingHorizontal: 16,
          paddingVertical: 9,
          borderRadius: ledgerRadius.control,
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: 'rgba(239,68,68,0.4)',
        }}
      >
        <Text style={{ color: C.text1, fontSize: 12, fontWeight: '800' }}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}
