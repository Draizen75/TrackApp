import { useDbQueries, cleanErrorMessage, Debtor } from '@/hooks/useDbQueries';
import { useToast } from '@/components/toast';
import { GoldButton } from '@/components/gold-button';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { History, Pencil, RotateCcw, Search } from 'lucide-react-native';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as z from 'zod';
import { ledgerColors as C } from '@/theme/ledger';
import { calculateSuggestedEntryFee, getEntryPreviewRows } from '@/utils/entry-preview';
import { useScreenFocus } from '@/hooks/useScreenFocus';
import { isValidMoneyInput } from '@/utils/strict-money';

// ─── Obsidian & Gold Design ────────────────────────────────────────────────────
const clearZeroIfNeeded = (value: string, setter: (value: string) => void) => {
  if (/^0(\.0+)?$/.test(value.trim())) {
    setter('');
  }
};

const entrySchema = z.object({
  type: z.enum(['CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD']),
  amount: z.string().refine((val) => isValidMoneyInput(val, false), {
    message: 'Base amount must be greater than 0',
  }),
  fee: z.string().refine((val) => isValidMoneyInput(val, true), {
    message: 'Fee must be a valid number',
  }),
  channel: z.string().min(1, 'Please select a channel'),
  is_debt: z.boolean(),
  deduct_fee: z.boolean(),
  customerName: z.string().optional(),
});

type EntryFormValues = z.infer<typeof entrySchema>;

export default function EntryScreen() {
  const router = useRouter();
  const isScreenFocused = useScreenFocus();
  const { width: viewportWidth } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && viewportWidth >= 1024;
  const { showToast } = useToast();
  const { debtorId, debtorName } = useLocalSearchParams<{ debtorId?: string; debtorName?: string }>();
  const { useCustomers, useAddCustomer, useAddTransaction, useSettings, useWallets, useDebtors, useLatestRepeatableTransaction } = useDbQueries();
  const { data: customers = [], isError: isCustomersError, refetch: refetchCustomers } = useCustomers(isScreenFocused);
  const { data: settings, isError: isSettingsError, refetch: refetchSettings } = useSettings(isScreenFocused);
  const { data: wallets = [], isError: isWalletsError, refetch: refetchWallets } = useWallets(isScreenFocused);
  const { data: lastRepeatableTransaction } = useLatestRepeatableTransaction(isScreenFocused);
  const addCustomerMutation = useAddCustomer();
  const addTransactionMutation = useAddTransaction();

  const getWalletLabel = (channel: string) => {
    const upper = channel.toUpperCase();
    const defaultNames: Record<string, string> = {
      GCASH: 'GCash',
      MAYA: 'Maya',
      MAYA_BUSINESS: 'Maya Biz',
      MARIBANK: 'MariBank',
      PHYSICAL_CASH: 'Cash Box',
    };
    if (defaultNames[upper]) return defaultNames[upper];
    return channel.length <= 4 ? channel.toUpperCase() : (channel.charAt(0).toUpperCase() + channel.slice(1));
  };

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [isFeeOverride, setIsFeeOverride] = useState(false);
  useFocusEffect(
    useCallback(() => () => {
      Keyboard.dismiss();
    }, [])
  );

  const { control, handleSubmit, setValue, formState: { errors, isSubmitting }, reset } = useForm<EntryFormValues>({
    resolver: zodResolver(entrySchema),
    defaultValues: {
      type: 'CASH_IN',
      amount: '',
      fee: '',
      channel: 'GCASH',
      is_debt: false,
      deduct_fee: false,
      customerName: '',
    },
  });

  const [txType, amountStr, feeStr, isDebt, deductFee, watchCustomerName, selectedChannel] = useWatch({
    control,
    name: ['type', 'amount', 'fee', 'is_debt', 'deduct_fee', 'customerName', 'channel'],
  });
  const { data: debtors = [] } = useDebtors(isScreenFocused && isDebt);

  const amount = parseFloat(amountStr) || 0;
  const fee = parseFloat(feeStr) || 0;

  useEffect(() => {
    if (isFeeOverride) return;
    if (amount <= 0) {
      setValue('fee', '');
      return;
    }

    setValue('fee', calculateSuggestedEntryFee(txType, amount, settings).toString());
  }, [amount, isFeeOverride, setValue, settings, txType]);

  // Screen Focus Effect: Auto-select debtor when navigated from Debtors screen
  useFocusEffect(
    useCallback(() => {
      if (debtorId || debtorName) {
        const parsedDebtorId = debtorId ? parseInt(debtorId, 10) : NaN;
        const matchedCustomer = !isNaN(parsedDebtorId)
          ? customers.find((c: any) => c.id === parsedDebtorId)
          : customers.find((c: any) => c.name.toLowerCase() === (debtorName || '').toLowerCase());

        setValue('is_debt', true);
        setShowCustomerDropdown(false);

        if (matchedCustomer) {
          setSelectedCustomerId(matchedCustomer.id);
          setValue('customerName', matchedCustomer.name);
          setCustomerSearchQuery(matchedCustomer.name);
        } else if (debtorName) {
          setSelectedCustomerId(!isNaN(parsedDebtorId) ? parsedDebtorId : null);
          setValue('customerName', debtorName);
          setCustomerSearchQuery(debtorName);
        }

        // Consume route parameters so repeated navigation or tab switches reliably auto-select debtor
        router.setParams({ debtorId: undefined, debtorName: undefined });
      }
    }, [debtorId, debtorName, customers, setValue, router])
  );

  const filteredCustomers = customers.filter((c: any) =>
    c.name.toLowerCase().includes(customerSearchQuery.toLowerCase())
  );

  const realRecentDebtors = useMemo(() => {
    return [...debtors].sort((a, b) => {
      const timeA = a.latest_tx_date ? new Date(a.latest_tx_date).getTime() : 0;
      const timeB = b.latest_tx_date ? new Date(b.latest_tx_date).getTime() : 0;
      return timeB - timeA;
    });
  }, [debtors]);

  const repeatLastTransaction = useCallback(async () => {
    if (!lastRepeatableTransaction) return;

    const customer = lastRepeatableTransaction.customer_id
      ? customers.find((item: any) => item.id === lastRepeatableTransaction.customer_id)
      : undefined;

    setIsFeeOverride(true);
    setValue('type', lastRepeatableTransaction.type as EntryFormValues['type']);
    setValue('amount', lastRepeatableTransaction.amount.toString());
    setValue('fee', lastRepeatableTransaction.fee.toString());
    setValue('channel', lastRepeatableTransaction.channel);
    setValue('is_debt', lastRepeatableTransaction.is_debt === 1);
    setValue('deduct_fee', lastRepeatableTransaction.deduct_fee === 1);
    setValue('customerName', customer?.name || '');
    setSelectedCustomerId(customer?.id ?? null);
    setCustomerSearchQuery(customer?.name || '');
    setShowCustomerDropdown(false);

    if (process.env.EXPO_OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    showToast('Last transaction copied. Review and log when ready.', 'info');
  }, [customers, lastRepeatableTransaction, setValue, showToast]);

  const selectCustomer = (id: number, name: string) => {
    setSelectedCustomerId(id);
    setValue('customerName', name);
    setCustomerSearchQuery(name);
    setShowCustomerDropdown(false);
  };

  const previewRows = getEntryPreviewRows({
    type: txType,
    amount,
    fee,
    channelLabel: getWalletLabel(selectedChannel),
    isDebt,
    deductFee,
  });

  const setDebtMode = (enabled: boolean) => {
    setValue('is_debt', enabled);
    if (!enabled) {
      setValue('customerName', '');
      setSelectedCustomerId(null);
      setCustomerSearchQuery('');
      setShowCustomerDropdown(false);
    }
  };

  const onSubmit = async (data: EntryFormValues) => {
    if (isSubmitting) return; // Prevent double submission
    try {
      let finalCustomerId = selectedCustomerId;

      if (data.is_debt) {
        const trimmedName = data.customerName?.trim() || '';
        if (!trimmedName) {
          alert('Debtor name is required for credit transactions.');
          return;
        }

        const exactMatch = customers.find((c: any) => c.name.toLowerCase() === trimmedName.toLowerCase());
        if (exactMatch) {
          finalCustomerId = exactMatch.id;
        } else if (finalCustomerId === null) {
          if (process.env.EXPO_OS !== 'web') {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
          finalCustomerId = await addCustomerMutation.mutateAsync({ name: trimmedName });
          await refetchCustomers();
        }
      }

      await addTransactionMutation.mutateAsync({
        type: data.type,
        amount: parseFloat(data.amount),
        fee: parseFloat(data.fee),
        channel: data.channel,
        customer_id: finalCustomerId,
        is_debt: data.is_debt,
        deduct_fee: data.deduct_fee,
      });

      if (process.env.EXPO_OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch((error: unknown) => {
          console.warn('Transaction success haptic feedback failed.', error);
        });
      }
      resetForm();
      showToast('Transaction logged successfully!', 'success');

    } catch (e: any) {
      alert(cleanErrorMessage(e));
    }
  };

  const resetForm = () => {
    reset({
      type: 'CASH_IN',
      amount: '',
      fee: '',
      channel: 'GCASH',
      is_debt: false,
      deduct_fee: false,
      customerName: '',
    });
    setIsFeeOverride(false);
    setSelectedCustomerId(null);
    setCustomerSearchQuery('');
    setShowCustomerDropdown(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <KeyboardAvoidingView
        // Android's native `resize` mode owns the IME layout. Applying a second
        // JavaScript offset leaves stale whitespace after the keyboard closes.
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingTop: isDesktopWeb ? 28 : 16, paddingBottom: 16, alignItems: isDesktopWeb ? 'center' : undefined }}
        >
          {(isCustomersError || isSettingsError || isWalletsError) && (
            <View style={{ marginHorizontal: 24, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: C.dangerDim, gap: 8 }}>
              <Text style={{ color: C.danger, fontSize: 12, fontWeight: '700' }}>Some entry data could not be refreshed.</Text>
              {isCustomersError && <TouchableOpacity onPress={() => refetchCustomers()} accessibilityRole="button"><Text style={{ color: C.danger, fontSize: 12 }}>Retry customer list</Text></TouchableOpacity>}
              {isSettingsError && <TouchableOpacity onPress={() => refetchSettings()} accessibilityRole="button"><Text style={{ color: C.danger, fontSize: 12 }}>Retry fee settings</Text></TouchableOpacity>}
              {isWalletsError && <TouchableOpacity onPress={() => refetchWallets()} accessibilityRole="button"><Text style={{ color: C.danger, fontSize: 12 }}>Retry wallet list</Text></TouchableOpacity>}
            </View>
          )}

          {/* Form Content */}
          <View
            style={{
              flex: 1,
              width: '100%',
              maxWidth: isDesktopWeb ? 1120 : undefined,
              alignSelf: 'center',
              borderTopLeftRadius: isDesktopWeb ? 20 : 24,
              borderTopRightRadius: 24,
              paddingHorizontal: isDesktopWeb ? 32 : 20,
              paddingTop: isDesktopWeb ? 32 : 24,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.surface,
              marginTop: 10,
            }}
          >

            {/* 1. Transaction Type Toggle */}
            <View style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                  Transaction Type
                </Text>
                {lastRepeatableTransaction && (
                  <TouchableOpacity
                    onPress={repeatLastTransaction}
                    accessibilityRole="button"
                    accessibilityLabel="Repeat last transaction"
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 }}
                  >
                    <History size={13} color={C.accent} />
                    <Text style={{ color: C.accent, fontSize: 10, fontWeight: '800' }}>Repeat last</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Controller
                control={control}
                name="type"
                render={({ field: { onChange, value } }) => (
                  <View style={{ flexDirection: 'row', backgroundColor: C.bg, padding: 6, borderRadius: 16, borderWidth: 1, borderColor: C.border, gap: 4 }}>
                    {(['CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD'] as const).map((t) => {
                      const isActive = value === t;
                      return (
                        <TouchableOpacity
                          key={t}
                          accessibilityRole="button"
                          accessibilityLabel={`Transaction type: ${t === 'CASH_IN' ? 'Cash In' : t === 'CASH_OUT' ? 'Cash Out' : t === 'E_LOAD' ? 'E-Load' : 'TV Load'}`}
                          accessibilityState={{ selected: isActive }}
                          onPress={async () => {
                            if (process.env.EXPO_OS !== 'web') {
                              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            }
                            setIsFeeOverride(false);
                            onChange(t);
                            if (t === 'E_LOAD' || t === 'TV_LOAD') {
                              setValue('deduct_fee', false);
                            }
                          }}
                          style={{
                            flex: 1,
                            paddingVertical: 10,
                            borderRadius: 12,
                            alignItems: 'center',
                            backgroundColor: isActive ? C.accent : 'transparent',
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '800', color: isActive ? C.bg : C.text2 }}>
                            {t === 'CASH_IN' ? 'Cash In' : t === 'CASH_OUT' ? 'Cash Out' : t === 'E_LOAD' ? 'E-Load' : 'TV Load'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              />
            </View>

            {/* 2. Amount Input & Fee Input */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              <View style={{ flex: 3 }}>
                <View style={{ height: 32, justifyContent: 'center', marginBottom: 8 }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                    Base Amount (₱)
                  </Text>
                </View>
                <Controller
                  control={control}
                  name="amount"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      testID="base-transaction-amount"
                      accessibilityLabel="Base transaction amount"
                      style={{
                        backgroundColor: C.bg,
                        borderWidth: 1,
                        borderColor: C.border,
                        color: C.text1,
                        borderRadius: 16,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        fontWeight: '700',
                        fontSize: 18,
                      }}
                      keyboardType="decimal-pad"
                      placeholder="₱ 0.00"
                      placeholderTextColor={C.text3}
                      onBlur={onBlur}
                      onChangeText={onChange}
                      onFocus={() => clearZeroIfNeeded(value, onChange)}
                      value={value}
                    />
                  )}
                />
                {errors.amount && <Text style={{ color: C.danger, fontSize: 11, marginTop: 4, fontWeight: '600' }}>{errors.amount.message}</Text>}
              </View>

              <View style={{ flex: 2 }}>
                <View style={{ height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 4 }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
                    Fee · {isFeeOverride ? 'Custom' : 'Suggested'}
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    testID="edit-service-fee"
                    accessibilityLabel={isFeeOverride ? 'Use suggested service fee' : 'Edit service fee'}
                    onPress={() => setIsFeeOverride(value => !value)}
                    hitSlop={8}
                    style={{ minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}
                  >
                    {isFeeOverride
                      ? <RotateCcw size={15} color={C.accent} />
                      : <Pencil size={15} color={C.accent} />}
                  </TouchableOpacity>
                </View>
                <Controller
                  control={control}
                  name="fee"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      testID="service-fee"
                      accessibilityLabel="Service fee"
                      style={{
                        backgroundColor: C.bg,
                        borderWidth: 1,
                        borderColor: isFeeOverride ? C.accent : C.border,
                        color: C.accent,
                        borderRadius: 16,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        fontWeight: '700',
                        fontSize: 18,
                        textAlign: 'center',
                      }}
                      keyboardType="decimal-pad"
                      editable={isFeeOverride}
                      placeholder="Auto"
                      placeholderTextColor={C.text3}
                      onBlur={onBlur}
                      onChangeText={(value) => {
                        setIsFeeOverride(true);
                        onChange(value);
                      }}
                      onFocus={() => clearZeroIfNeeded(value, onChange)}
                      value={value}
                    />
                  )}
                />
                {errors.fee && <Text style={{ color: C.danger, fontSize: 11, marginTop: 4, fontWeight: '600' }}>{errors.fee.message}</Text>}
              </View>
            </View>

            {/* 3. Channel Selector */}
            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
                Channel / Wallet
              </Text>
              <Controller
                control={control}
                name="channel"
                render={({ field: { onChange, value } }) => {
                  // Only digital e-wallets are source channels for entry logs
                  const availableChannels = wallets
                    .map((w: any) => w.channel)
                    .filter((ch: string) => ch !== 'PHYSICAL_CASH');

                  return (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 }}>
                      {availableChannels.map((ch) => {
                        const isActive = value === ch;
                        return (
                          <TouchableOpacity
                            key={ch}
                            onPress={async () => {
                              if (process.env.EXPO_OS !== 'web') {
                                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              }
                              onChange(ch);
                            }}
                            style={{
                              minWidth: '30%',
                              flexGrow: 1,
                              paddingVertical: 12,
                              paddingHorizontal: 8,
                              borderRadius: 12,
                              borderWidth: 1,
                              alignItems: 'center',
                              backgroundColor: isActive ? C.accentDim : C.bg,
                              borderColor: isActive ? C.accent : C.border,
                            }}
                          >
                            <Text style={{ fontWeight: '700', fontSize: 11, color: isActive ? C.accent : C.text2 }}>
                              {getWalletLabel(ch)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                }}
              />
              {errors.channel && <Text style={{ color: C.danger, fontSize: 11, marginTop: 4, fontWeight: '600' }}>{errors.channel.message}</Text>}
            </View>

            {/* 4. Ghost Preview Math Helper */}
            <View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, marginBottom: 20 }}>
              <Text style={{ color: C.text3, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '700', marginBottom: 8 }}>
                Transaction Preview
              </Text>
              {previewRows.length === 0 ? (
                <Text style={{ color: C.text3, fontSize: 12 }}>Enter an amount to preview the cash flow.</Text>
              ) : previewRows.map((row) => (
                <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
                  <Text style={{ color: C.text2, fontSize: 12, flex: 1 }}>{row.label}</Text>
                  <Text style={{ color: C.accent, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{row.value}</Text>
                </View>
              ))}
            </View>

            {/* 5. Deduct Fee from Payout Toggle (conditional on Cash In/Cash Out) */}
            {(txType === 'CASH_IN' || txType === 'CASH_OUT') && (
              <View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, padding: 14, borderRadius: 16, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Toggle deduct fee from payout"
                    onPress={() => setValue('deduct_fee', !deductFee)}
                    style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
                  >
                    <Text style={{ color: C.text1, fontSize: 13, fontWeight: '700' }}>Deduct fee from payout</Text>
                  </TouchableOpacity>
                  <Controller
                    control={control}
                    name="deduct_fee"
                    render={({ field: { onChange, value } }) => (
                      <Switch
                        accessibilityLabel="Deduct fee from payout"
                        trackColor={{ false: C.border, true: C.accent }}
                        thumbColor={value ? C.text1 : C.text3}
                        onValueChange={async (enabled) => {
                          if (process.env.EXPO_OS !== 'web') {
                            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          }
                          onChange(enabled);
                        }}
                        value={value}
                      />
                    )}
                  />
                </View>
                {txType === 'CASH_IN' ? (
                  <Text style={{ color: C.text3, fontSize: 11, marginTop: 4 }}>
                    Customer pays exactly the principal (e.g. ₱1,000 cash). You send ₱{(amount - fee) > 0 ? (amount - fee).toFixed(2) : '0.00'} GCash/Maya.
                  </Text>
                ) : (
                  <Text style={{ color: C.text3, fontSize: 11, marginTop: 4 }}>
                    Customer transfers exactly the principal (e.g. ₱1,000 GCash). You hand them ₱{(amount - fee) > 0 ? (amount - fee).toFixed(2) : '0.00'} cash.
                  </Text>
                )}
              </View>
            )}

            {/* 6. Utang / Debt Toggle */}
            <View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, padding: 14, borderRadius: 16, marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Toggle record as customer debt"
                  onPress={() => setDebtMode(!isDebt)}
                  style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={{ color: C.text1, fontSize: 13, fontWeight: '700' }}>Record as customer debt</Text>
                  <Text style={{ color: C.text3, fontSize: 11, marginTop: 2 }}>Adds this amount and any applicable fee to their balance.</Text>
                </TouchableOpacity>
                <Controller
                  control={control}
                  name="is_debt"
                  render={({ field: { value } }) => (
                    <Switch
                      testID="record-as-customer-debt"
                      accessibilityLabel="Record as customer debt"
                      trackColor={{ false: C.border, true: C.success }}
                      thumbColor={value ? C.text1 : C.text3}
                      onValueChange={async (enabled) => {
                        if (process.env.EXPO_OS !== 'web') {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        }
                        setDebtMode(enabled);
                      }}
                      value={value}
                    />
                  )}
                />
              </View>
            </View>

            {/* 6. Debtor Selector (conditional on is_debt) */}
            {isDebt && (
              <View style={{ marginBottom: 20, position: 'relative' }}>
                {realRecentDebtors.length > 0 && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
                      Recent Debtors (Last Active)
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {realRecentDebtors.slice(0, 8).map((debtor: Debtor) => {
                        const isSelected = selectedCustomerId === debtor.id || (watchCustomerName || '').toLowerCase() === debtor.name.toLowerCase();
                        return (
                          <TouchableOpacity
                            key={debtor.id}
                            onPress={() => selectCustomer(debtor.id, debtor.name)}
                            style={{
                              backgroundColor: isSelected ? C.accentDim : C.bg,
                              borderWidth: 1,
                              borderColor: isSelected ? C.accent : C.border,
                              borderRadius: 12,
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Text style={{ color: isSelected ? C.accent : C.text2, fontSize: 11, fontWeight: '700' }}>
                              {debtor.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
                <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
                  Debtor Customer Name
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
                  <Search size={16} color={C.text3} style={{ marginRight: 8 }} />
                  <Controller
                    control={control}
                    name="customerName"
                    render={({ field: { onChange, value } }) => (
                      <TextInput
                        testID="debtor-customer-name"
                        accessibilityLabel="Debtor customer name"
                        style={{ flex: 1, color: C.text1, fontSize: 14, fontWeight: '600', height: 40 }}
                        placeholder="Search or enter debtor name..."
                        placeholderTextColor={C.text3}
                        autoCapitalize="words"
                        autoCorrect={false}
                        returnKeyType="done"
                        onChangeText={(txt) => {
                          onChange(txt);
                          setCustomerSearchQuery(txt);
                          setShowCustomerDropdown(true);
                          setSelectedCustomerId(null);
                        }}
                        value={value}
                        onFocus={() => {
                          setCustomerSearchQuery(value || '');
                          setShowCustomerDropdown(true);
                        }}
                      />
                    )}
                  />
                </View>
                {showCustomerDropdown && customerSearchQuery.trim().length > 0 && (
                  <View
                    accessibilityLabel="Customer search results"
                    style={{
                      marginTop: 8,
                      backgroundColor: C.surface2,
                      borderWidth: 1,
                      borderColor: C.border,
                      borderRadius: 14,
                      maxHeight: 180,
                      overflow: 'hidden',
                    }}
                  >
                    <ScrollView
                      keyboardShouldPersistTaps="always"
                      nestedScrollEnabled
                      style={{ flexGrow: 0 }}
                    >
                      {filteredCustomers.map((item: any) => (
                        <TouchableOpacity
                          key={item.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Select customer ${item.name}`}
                          onPress={() => selectCustomer(item.id, item.name)}
                          style={{ paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border }}
                        >
                          <Text style={{ color: C.text2, fontSize: 14, fontWeight: '600' }}>{item.name}</Text>
                        </TouchableOpacity>
                      ))}
                      {filteredCustomers.length === 0 && (
                        <Text style={{ color: C.text3, fontSize: 12, lineHeight: 18, padding: 12 }}>
                          No matching customer. A new customer will be created when you log this debt.
                        </Text>
                      )}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}

          </View>
        </ScrollView>
        <View style={{
          paddingHorizontal: 20,
          paddingTop: 10,
          paddingBottom: 8,
          borderTopWidth: 1,
          borderTopColor: C.border,
          backgroundColor: C.bg,
        }}>
          <GoldButton
            testID="log-transaction"
            onPress={handleSubmit(onSubmit)}
            disabled={isSubmitting || addCustomerMutation.isPending || addTransactionMutation.isPending}
            loading={isSubmitting || addCustomerMutation.isPending || addTransactionMutation.isPending}
            label={isSubmitting || addCustomerMutation.isPending || addTransactionMutation.isPending ? 'SAVING TRANSACTION...' : 'LOG TRANSACTION'}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
