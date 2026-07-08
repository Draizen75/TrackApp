import { useDbQueries, cleanErrorMessage } from '@/hooks/useDbQueries';
import { useToast } from '@/components/toast';
import { zodResolver } from '@hookform/resolvers/zod';
import * as Haptics from 'expo-haptics';
import { PlusCircle, Search, UserPlus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as z from 'zod';

// ─── Warm Architectural Design Tokens ─────────────────────────────────────────
const C = {
  bg: '#12100e',
  surface: '#1c1916',
  surface2: '#221e1b',
  border: '#2d2920',
  borderLight: '#3a342e',
  accent: '#e6a817',
  accentDim: 'rgba(230,168,23,0.12)',
  success: '#5a9b6e',
  successDim: 'rgba(90,155,110,0.12)',
  danger: '#dc6b5a',
  dangerDim: 'rgba(220,107,90,0.12)',
  warning: '#c97b2e',
  text1: '#f0ece5',
  text2: '#a89f95',
  text3: '#6b6158',
};

const entrySchema = z.object({
  type: z.enum(['CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD']),
  amount: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, {
    message: "Base amount must be greater than 0",
  }),
  fee: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, {
    message: "Fee must be a valid number",
  }),
  channel: z.string().min(1, "Please select a channel"),
  is_debt: z.boolean(),
  deduct_fee: z.boolean(),
  customerName: z.string().optional(),
});

type EntryFormValues = z.infer<typeof entrySchema>;

export default function EntryScreen() {
  const { showToast } = useToast();
  const { useCustomers, useAddCustomer, useAddTransaction, useSettings, useWallets } = useDbQueries();
  const { data: customers = [], refetch: refetchCustomers } = useCustomers();
  const { data: settings } = useSettings();
  const { data: wallets = [] } = useWallets();
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

  const { control, handleSubmit, watch, setValue, formState: { errors, isSubmitting }, reset } = useForm<EntryFormValues>({
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

  const txType = watch('type');
  const amountStr = watch('amount');
  const feeStr = watch('fee');
  const isDebt = watch('is_debt');
  const deductFee = watch('deduct_fee');
  const watchCustomerName = watch('customerName');

  const amount = parseFloat(amountStr) || 0;
  const fee = parseFloat(feeStr) || 0;

  useEffect(() => {
    if (amount <= 0) {
      setValue('fee', '');
      return;
    }

    const cashStep = parseFloat(settings?.cash_step_amount || '500');
    const cashFee = parseFloat(settings?.cash_fee_per_step || '10');
    const eloadThreshold = parseFloat(settings?.eload_threshold || '99');
    const eloadFeeLow = parseFloat(settings?.eload_fee_low || '5');
    const eloadFeeHigh = parseFloat(settings?.eload_fee_high || '10');
    const tvloadFee = parseFloat(settings?.tvload_fee || '15');

    let calculatedFee = 0;
    if (txType === 'CASH_IN' || txType === 'CASH_OUT') {
      calculatedFee = Math.ceil(amount / cashStep) * cashFee;
    } else if (txType === 'E_LOAD') {
      calculatedFee = amount < eloadThreshold ? eloadFeeLow : eloadFeeHigh;
    } else if (txType === 'TV_LOAD') {
      calculatedFee = tvloadFee;
    }

    setValue('fee', calculatedFee.toString());
  }, [amount, txType, setValue, settings]);

  useEffect(() => {
    // Keep GCASH as the default channel universally to avoid confusing auto-switches
    setValue('channel', 'GCASH');
  }, [txType, setValue]);

  const filteredCustomers = customers.filter((c: any) =>
    c.name.toLowerCase().includes(customerSearchQuery.toLowerCase())
  );

  const selectCustomer = (id: number, name: string) => {
    setSelectedCustomerId(id);
    setValue('customerName', name);
    setCustomerSearchQuery(name);
    setShowCustomerDropdown(false);
  };

  const getGhostPreview = () => {
    if (amount <= 0) return 'Enter transaction amount...';

    const total = amount + fee;
    const remains = amount - fee;
    const isUtangText = isDebt ? ' [CREDIT/UTANG]' : '';

    switch (txType) {
      case 'CASH_IN':
        if (deductFee) {
          if (isDebt) {
            return `💸 ${watchCustomerName || 'Customer'} owes ₱${amount.toFixed(2)} principal (Send them ₱${remains.toFixed(2)} GCash/digital)`;
          }
          return `📥 Collect exactly ₱${amount.toFixed(2)} Cash from customer (Send them ₱${remains.toFixed(2)} digital, Float -₱${remains.toFixed(2)})`;
        } else {
          if (isDebt) {
            return `💸 ${watchCustomerName || 'Customer'} will owe ₱${total.toFixed(2)} total${isUtangText}`;
          }
          return `📥 Collect ₱${total.toFixed(2)} Cash from customer (Send them ₱${amount.toFixed(2)} digital, Float -₱${amount.toFixed(2)})`;
        }
      case 'CASH_OUT':
        if (deductFee) {
          if (isDebt) {
            return `💸 Hand customer ₱${remains.toFixed(2)} Cash. Customer owes ₱${amount.toFixed(2)} transfer`;
          }
          return `📤 Hand customer ₱${remains.toFixed(2)} Cash. Verify inbound transfer of exactly ₱${amount.toFixed(2)} GCash/digital`;
        } else {
          if (isDebt) {
            return `💸 Hand customer ₱${amount.toFixed(2)} Cash. Customer owes ₱${total.toFixed(2)} transfer${isUtangText}`;
          }
          return `📤 Hand customer ₱${amount.toFixed(2)} Cash. Verify inbound transfer of ₱${total.toFixed(2)} digital`;
        }
      case 'E_LOAD':
      case 'TV_LOAD':
        if (isDebt) {
          return `💸 ${watchCustomerName || 'Customer'} will owe ₱${total.toFixed(2)} load debt${isUtangText}`;
        }
        return `⚡ Collect ₱${total.toFixed(2)} Cash from customer`;
    }
  };

  const onSubmit = async (data: EntryFormValues) => {
    if (isSubmitting) return; // Prevent double submission
    try {
      if (process.env.EXPO_OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

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
        } else {
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
    setSelectedCustomerId(null);
    setCustomerSearchQuery('');
    setShowCustomerDropdown(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 120 }}
        >
          {/* Header */}
          <View style={{ height: 110, justifyContent: 'center', paddingHorizontal: 24, marginTop: 10 }}>
            <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>
              Counter Desk
            </Text>
            <Text style={{ color: C.text1, fontSize: 24, fontWeight: '800', marginTop: 2 }}>
              Fast Ledger Entry
            </Text>
            <Text style={{ color: C.text3, fontSize: 12, marginTop: 4 }}>Submit records with instant fee calculations</Text>
          </View>

          {/* Form Content */}
          <View
            style={{
              flex: 1,
              borderTopLeftRadius: 36,
              borderTopRightRadius: 36,
              paddingHorizontal: 24,
              paddingTop: 32,
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.surface,
              marginTop: 10,
            }}
          >

            {/* 1. Transaction Type Toggle */}
            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
                Transaction Type
              </Text>
              <Controller
                control={control}
                name="type"
                render={({ field: { onChange, value } }) => (
                  <View style={{ flexDirection: 'row', backgroundColor: C.bg, padding: 6, borderRadius: 16, borderWidth: 1, borderColor: C.border, gap: 4 }}>
                    {(['CASH_IN', 'CASH_OUT', 'E_LOAD', 'TV_LOAD'] as const).map((t) => {
                      const isActive = value === t;
                      const labels = { CASH_IN: 'Cash In', CASH_OUT: 'Cash Out', E_LOAD: 'E-Load', TV_LOAD: 'TV Load' };
                      return (
                        <TouchableOpacity
                          key={t}
                          onPress={async () => {
                            if (process.env.EXPO_OS !== 'web') {
                              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            }
                            onChange(t);
                          }}
                          style={{
                            flex: 1,
                            paddingVertical: 10,
                            borderRadius: 12,
                            justifyContent: 'center',
                            alignItems: 'center',
                            backgroundColor: isActive ? C.surface2 : 'transparent',
                            borderWidth: 1,
                            borderColor: isActive ? C.border : 'transparent',
                          }}
                        >
                          <Text style={{ textAlign: 'center', fontWeight: '700', fontSize: 11, color: isActive ? C.accent : C.text2 }}>
                            {labels[t]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              />
            </View>

            {/* 2. Amount Input & Fee Input */}
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 20 }}>
              <View style={{ flex: 3 }}>
                <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
                  Base Amount (₱)
                </Text>
                <Controller
                  control={control}
                  name="amount"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
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
                      value={value}
                    />
                  )}
                />
                {errors.amount && <Text style={{ color: C.danger, fontSize: 11, marginTop: 4, fontWeight: '600' }}>{errors.amount.message}</Text>}
              </View>

              <View style={{ flex: 2 }}>
                <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
                  Service Fee (₱)
                </Text>
                <Controller
                  control={control}
                  name="fee"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      style={{
                        backgroundColor: C.bg,
                        borderWidth: 1,
                        borderColor: C.border,
                        color: C.accent,
                        borderRadius: 16,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        fontWeight: '700',
                        fontSize: 18,
                        textAlign: 'center',
                      }}
                      keyboardType="decimal-pad"
                      placeholder="Fee"
                      placeholderTextColor={C.text3}
                      onBlur={onBlur}
                      onChangeText={onChange}
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
              <Text style={{ color: C.text3, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '700', marginBottom: 4 }}>
                Instant Math Preview
              </Text>
              <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }}>
                {getGhostPreview()}
              </Text>
            </View>

            {/* 5. Deduct Fee from Payout Toggle (conditional on Cash In/Cash Out) */}
            {(txType === 'CASH_IN' || txType === 'CASH_OUT') && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, padding: 16, borderRadius: 16, marginBottom: 16 }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={{ color: C.text1, fontSize: 13, fontWeight: '700' }}>Deduct fee from principal?</Text>
                  {txType === 'CASH_IN' ? (
                    <Text style={{ color: C.text3, fontSize: 11, marginTop: 2 }}>
                      Customer pays exactly the principal (e.g. ₱1,000 cash). You send ₱{(amount - fee) > 0 ? (amount - fee).toFixed(2) : '0.00'} GCash/Maya.
                    </Text>
                  ) : (
                    <Text style={{ color: C.text3, fontSize: 11, marginTop: 2 }}>
                      Customer transfers exactly the principal (e.g. ₱1,000 GCash). You hand them ₱{(amount - fee) > 0 ? (amount - fee).toFixed(2) : '0.00'} cash.
                    </Text>
                  )}
                </View>
                <Controller
                  control={control}
                  name="deduct_fee"
                  render={({ field: { onChange, value } }) => (
                    <Switch
                      trackColor={{ false: C.border, true: C.accent }}
                      thumbColor={value ? C.text1 : C.text3}
                      onValueChange={async (val) => {
                        if (process.env.EXPO_OS !== 'web') {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        }
                        onChange(val);
                      }}
                      value={value}
                    />
                  )}
                />
              </View>
            )}

            {/* 6. Utang / Debt Toggle */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, padding: 16, borderRadius: 16, marginBottom: 20 }}>
              <View>
                <Text style={{ color: C.text1, fontSize: 13, fontWeight: '700' }}>Is this an Utang / Lend item?</Text>
                <Text style={{ color: C.text3, fontSize: 11, marginTop: 2 }}>Add this transaction to customer debt balance</Text>
              </View>
              <Controller
                control={control}
                name="is_debt"
                render={({ field: { onChange, value } }) => (
                  <Switch
                    trackColor={{ false: C.border, true: C.success }}
                    thumbColor={value ? C.text1 : C.text3}
                    onValueChange={async (val) => {
                      if (process.env.EXPO_OS !== 'web') {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      }
                      onChange(val);
                      if (!val) {
                        setValue('customerName', '');
                        setSelectedCustomerId(null);
                        setCustomerSearchQuery('');
                        setShowCustomerDropdown(false);
                      }
                    }}
                    value={value}
                  />
                )}
              />
            </View>

            {/* 6. Debtor Selector (conditional on is_debt) */}
            {isDebt && (
              <View style={{ marginBottom: 20, position: 'relative' }}>
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
                        style={{ flex: 1, color: C.text1, fontSize: 14, fontWeight: '600', height: 40 }}
                        placeholder="Search or enter debtor name..."
                        placeholderTextColor={C.text3}
                        onChangeText={(txt) => {
                          onChange(txt);
                          setCustomerSearchQuery(txt);
                          setShowCustomerDropdown(true);
                          setSelectedCustomerId(null);
                        }}
                        value={value}
                        onFocus={() => setShowCustomerDropdown(true)}
                      />
                    )}
                  />
                </View>

                {showCustomerDropdown && customerSearchQuery.trim().length > 0 && (
                  <View style={{ position: 'absolute', bottom: 64, left: 0, right: 0, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 16, maxHeight: 160, overflow: 'hidden', zIndex: 50 }}>
                    <ScrollView keyboardShouldPersistTaps="always" style={{ flex: 1 }}>
                      {filteredCustomers.map((item: any) => (
                        <TouchableOpacity
                          key={item.id}
                          onPress={() => selectCustomer(item.id, item.name)}
                          style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: C.border }}
                        >
                          <Text style={{ color: C.text2, fontSize: 13, fontWeight: '600' }}>{item.name}</Text>
                        </TouchableOpacity>
                      ))}
                      {!customers.some((c: any) => c.name.toLowerCase() === customerSearchQuery.toLowerCase()) ? (
                        <TouchableOpacity
                          onPress={() => {
                            setShowCustomerDropdown(false);
                          }}
                          style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                        >
                          <UserPlus size={14} color={C.success} />
                          <Text style={{ color: C.success, fontSize: 12, fontWeight: '700' }}>
                            Create New Debtor &quot;{customerSearchQuery}&quot;
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}

            {/* 7. Action Submission Button */}
            <TouchableOpacity
              onPress={handleSubmit(onSubmit)}
              disabled={isSubmitting}
              style={{
                width: '100%',
                paddingVertical: 16,
                borderRadius: 16,
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 32,
                backgroundColor: C.accent,
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              <PlusCircle size={18} color={C.bg} style={{ marginRight: 8 }} />
              <Text style={{ color: C.bg, fontWeight: '800', fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                {isSubmitting ? 'Logging...' : 'Log Transaction'}
              </Text>
            </TouchableOpacity>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
