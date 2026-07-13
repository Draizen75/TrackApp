import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDbQueries, Expense, cleanErrorMessage } from '@/hooks/useDbQueries';
import { TrendingDown, Trash2, PlusCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

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

const clearZeroIfNeeded = (value: string, setter: (value: string) => void) => {
  if (/^0(\.0+)?$/.test(value.trim())) {
    setter('');
  }
};

export default function ExpensesScreen() {
  const { useExpenses, useAddExpense, useDeleteExpense, useWallets } = useDbQueries();
  const { data: expenses = [], isLoading, refetch } = useExpenses();
  const { data: wallets = [] } = useWallets();
  const addExpenseMutation = useAddExpense();
  const deleteExpenseMutation = useDeleteExpense();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<string>('PHYSICAL_CASH');
  const [category, setCategory] = useState('OTHER');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const categories = ['OTHER', 'ELECTRICITY', 'RENT', 'SUPPLIES', 'TRANSPORT', 'FOOD'];

  const handleSubmitExpense = async () => {
    if (isSubmitting) return;
    const parsedAmount = parseFloat(amount);
    if (!description.trim()) {
      Alert.alert("Input Error", "Please enter a description for the expense.");
      return;
    }
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Input Error", "Please enter a valid expense amount.");
      return;
    }

    try {
      setIsSubmitting(true);
      if (process.env.EXPO_OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      await addExpenseMutation.mutateAsync({
        description,
        category,
        amount: parsedAmount,
        channel,
      });

      setDescription('');
      setAmount('');
      setChannel('PHYSICAL_CASH');
      setCategory('OTHER');
      refetch();
    } catch (e: any) {
      Alert.alert("Error", cleanErrorMessage(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteExpense = (exp: Expense) => {
    Alert.alert(
      "Revert Expense",
      `Are you sure you want to delete this expense of ₱${exp.amount.toFixed(2)}? This will refund the ${exp.channel} wallet.`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: async () => {
            if (process.env.EXPO_OS !== 'web') {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            try {
              await deleteExpenseMutation.mutateAsync(exp.id);
              refetch();
            } catch (err: any) {
              Alert.alert("Error", cleanErrorMessage(err));
            }
          }
        }
      ]
    );
  };

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const categorySummary = categories
    .map((item) => ({
      category: item,
      total: expenses.filter((exp) => (exp.category || 'OTHER') === item).reduce((sum, exp) => sum + exp.amount, 0),
    }))
    .filter((item) => item.total > 0);

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

  const CARD_STYLE = {
    backgroundColor: C.surface,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView 
        style={{ flex: 1, paddingHorizontal: 16 }} 
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 110 }}
      >
        {/* Header */}
        <View style={{ marginVertical: 20 }}>
          <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>Shop Ledger</Text>
          <Text style={{ color: C.text1, fontSize: 24, fontWeight: '800', marginTop: 2 }}>Operational Expenses</Text>
        </View>

        {/* Total Expenses Card */}
        <View
          style={{
            ...CARD_STYLE,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View>
            <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Total Expenses Logged</Text>
            <Text style={{ fontSize: 28, fontWeight: '900', color: C.danger, letterSpacing: -0.5 }}>
              ₱{totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          <View style={{ backgroundColor: C.dangerDim, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(220,107,90,0.2)' }}>
            <TrendingDown size={24} color={C.danger} />
          </View>
        </View>

        {/* Fast Expense Entry Form */}
        <View style={CARD_STYLE}>
          <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', marginBottom: 16 }}>
            Log New Store Expense
          </Text>

          {/* Description */}
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Description</Text>
            <TextInput
              style={{
                backgroundColor: C.bg,
                borderWidth: 1,
                borderColor: C.border,
                color: C.text1,
                borderRadius: 16,
                paddingHorizontal: 16,
                paddingVertical: 12,
                fontSize: 14,
              }}
              placeholder="e.g. Electricity bill, Shop rent, Reload SIM data"
              placeholderTextColor={C.text3}
              value={description}
              onChangeText={setDescription}
            />
          </View>

          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {categories.map((item) => {
                const isActive = category === item;
                return (
                  <TouchableOpacity
                    key={item}
                    onPress={() => setCategory(item)}
                    style={{ backgroundColor: isActive ? C.accentDim : C.bg, borderWidth: 1, borderColor: isActive ? C.accent : C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <Text style={{ color: isActive ? C.accent : C.text2, fontSize: 11, fontWeight: '700' }}>{item.replace('_', ' ')}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Amount & Paid via */}
          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 20 }}>
            <View style={{ width: '50%' }}>
              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Amount (₱)</Text>
              <TextInput
                style={{
                  backgroundColor: C.bg,
                  borderWidth: 1,
                  borderColor: C.border,
                  color: C.text1,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  fontSize: 14,
                  fontWeight: '700',
                }}
                keyboardType="decimal-pad"
                placeholder="₱ 0.00"
                placeholderTextColor={C.text3}
                value={amount}
                onFocus={() => clearZeroIfNeeded(amount, setAmount)}
                onChangeText={setAmount}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Paid Via Channel</Text>
              <View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 8, paddingVertical: 4, height: 46, justifyContent: 'center' }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                  {wallets.map((w: any) => {
                    const ch = w.channel;
                    const isActive = channel === ch;
                    return (
                      <TouchableOpacity
                        key={ch}
                        onPress={() => setChannel(ch)}
                        style={{
                          paddingHorizontal: 10,
                          marginHorizontal: 2,
                          justifyContent: 'center',
                          alignItems: 'center',
                          borderRadius: 8,
                          backgroundColor: isActive ? C.surface2 : 'transparent',
                        }}
                      >
                        <Text style={{ fontWeight: '700', fontSize: 10, color: isActive ? C.accent : C.text3 }}>
                          {getWalletLabel(ch)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          </View>

          {/* Log Expense Button */}
          <TouchableOpacity
            onPress={handleSubmitExpense}
            disabled={isSubmitting}
            style={{
              width: '100%',
              paddingVertical: 14,
              backgroundColor: C.accent,
              borderRadius: 16,
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            <PlusCircle size={16} color={C.bg} style={{ marginRight: 6 }} />
            <Text style={{ color: C.bg, fontWeight: '800', fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              {isSubmitting ? 'Saving...' : 'Add Expense'}
            </Text>
          </TouchableOpacity>
        </View>

        {categorySummary.length > 0 && (
          <View style={CARD_STYLE}>
            <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', marginBottom: 16 }}>
              Category Summary
            </Text>
            <View style={{ gap: 10 }}>
              {categorySummary.map((item) => (
                <View key={item.category} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: C.text2, fontSize: 12, fontWeight: '700' }}>{item.category.replace('_', ' ')}</Text>
                  <Text style={{ color: C.danger, fontSize: 13, fontWeight: '800' }}>PHP {item.total.toFixed(2)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Expenses List */}
        <View style={CARD_STYLE}>
          <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', marginBottom: 16 }}>
            Recent Expense Ledger
          </Text>

          {isLoading ? (
            <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 24 }}>Loading expense records...</Text>
          ) : expenses.length === 0 ? (
            <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 24 }}>No expenses logged yet.</Text>
          ) : (
            <View style={{}}>
              {expenses.map((exp, idx) => (
                <View 
                  key={exp.id} 
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: 12,
                    borderTopWidth: idx > 0 ? 1 : 0,
                    borderColor: C.border,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ color: C.text1, fontSize: 14, fontWeight: '700' }}>{exp.description}</Text>
                    <Text style={{ color: C.text3, fontSize: 10, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {(exp.category || 'OTHER').replace('_', ' ')} • Paid via {getWalletLabel(exp.channel)} • {new Date(exp.created_at).toLocaleDateString()}
                    </Text>
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Text style={{ color: C.danger, fontSize: 14, fontWeight: '800' }}>
                      -₱{exp.amount.toFixed(2)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleDeleteExpense(exp)}
                      style={{ padding: 8 }}
                    >
                      <Trash2 size={14} color={C.text3} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
