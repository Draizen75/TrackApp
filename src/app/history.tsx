import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, Modal, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useDbQueries, Transaction, cleanErrorMessage } from '@/hooks/useDbQueries';
import { useToast } from '@/components/toast';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Search, X, Trash2, Pencil, Check } from 'lucide-react-native';

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

type FilterType = 'ALL' | 'CASH_IN' | 'CASH_OUT' | 'E_LOAD' | 'TV_LOAD' | 'DEBT_PAYMENT';

export default function HistoryScreen() {
  const { showToast } = useToast();
  const router = useRouter();
  const { editTxId } = useLocalSearchParams<{ editTxId?: string }>();
  const { 
    useTransactions, 
    useDeleteTransaction, 
    useUpdateTransaction,
    useCustomers,
    useAddCustomer,
    useWallets
  } = useDbQueries();
  
  const { data: transactions = [], isLoading, refetch: refetchTransactions } = useTransactions();
  const { data: customers = [], refetch: refetchCustomers } = useCustomers();
  const { data: wallets = [] } = useWallets();
  
  const deleteTransactionMutation = useDeleteTransaction();
  const updateTransactionMutation = useUpdateTransaction();
  const addCustomerMutation = useAddCustomer();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<FilterType>('ALL');

  // Edit modal states
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editFee, setEditFee] = useState('');
  const [editChannel, setEditChannel] = useState<string>('GCASH');
  const [editIsDebt, setEditIsDebt] = useState(false);
  const [editDeductFee, setEditDeductFee] = useState(false);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleBack = async () => {
    if (process.env.EXPO_OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.back();
  };

  const handleDelete = (id: number) => {
    if (process.env.EXPO_OS === 'web') {
      const confirmDelete = window.confirm("Are you sure you want to revert this transaction? This will automatically restore the original wallet balances.");
      if (confirmDelete) {
        deleteTransactionMutation.mutate(id, {
          onSuccess: () => {
            showToast("Transaction reverted successfully.", "info");
          },
          onError: (err: any) => {
            alert(cleanErrorMessage(err));
          }
        });
      }
      return;
    }

    Alert.alert(
      "Revert Transaction",
      "Are you sure you want to delete this record? This will automatically reverse the transaction and restore the original wallet floats.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Revert", 
          style: "destructive",
          onPress: () => deleteTransactionMutation.mutate(id, {
            onSuccess: () => {
              showToast("Transaction reverted successfully.", "info");
            },
            onError: (err: any) => {
              Alert.alert("Error", cleanErrorMessage(err));
            }
          })
        }
      ]
    );
  };

  const handleOpenEditModal = (tx: Transaction) => {
    setSelectedTx(tx);
    setEditAmount(tx.amount.toString());
    setEditFee(tx.fee.toString());
    setEditChannel(tx.channel as any || 'GCASH');
    setEditIsDebt(tx.is_debt === 1);
    setEditDeductFee(tx.deduct_fee === 1);
    setEditCustomerName(tx.customer_name || '');
    setSelectedCustomerId(tx.customer_id);
    setCustomerSearchQuery(tx.customer_name || '');
    setShowCustomerDropdown(false);
    setEditModalVisible(true);
  };

  useEffect(() => {
    if (editTxId && transactions.length > 0) {
      const tx = transactions.find(t => t.id === parseInt(editTxId));
      if (tx) {
        setTimeout(() => {
          handleOpenEditModal(tx);
        }, 0);
        // Clear params to avoid multiple triggers on updates
        router.setParams({ editTxId: undefined });
      }
    }
  }, [editTxId, transactions, router]);

  const selectCustomer = (id: number, name: string) => {
    setSelectedCustomerId(id);
    setEditCustomerName(name);
    setCustomerSearchQuery(name);
    setShowCustomerDropdown(false);
  };

  const filteredCustomers = customers.filter((c: any) => 
    c.name.toLowerCase().includes(customerSearchQuery.toLowerCase())
  );

  const handleSaveChanges = async () => {
    if (!selectedTx || isSaving) return;
    const parsedAmount = parseFloat(editAmount);
    const parsedFee = parseFloat(editFee);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert("Input Error", "Please enter a valid amount greater than 0.");
      return;
    }
    if (isNaN(parsedFee) || parsedFee < 0) {
      Alert.alert("Input Error", "Please enter a valid non-negative fee.");
      return;
    }

    try {
      setIsSaving(true);
      if (process.env.EXPO_OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      let finalCustomerId = selectedCustomerId;

      if (editIsDebt) {
        const trimmedName = editCustomerName.trim();
        if (!trimmedName) {
          Alert.alert("Input Error", "Debtor name is required for credit transactions.");
          setIsSaving(false);
          return;
        }

        const exactMatch = customers.find((c: any) => c.name.toLowerCase() === trimmedName.toLowerCase());
        if (exactMatch) {
          finalCustomerId = exactMatch.id;
        } else {
          finalCustomerId = await addCustomerMutation.mutateAsync({ name: trimmedName });
          await refetchCustomers();
        }
      } else {
        finalCustomerId = null;
      }

      await updateTransactionMutation.mutateAsync({
        id: selectedTx.id,
        type: selectedTx.type,
        amount: parsedAmount,
        fee: parsedFee,
        channel: editChannel,
        customer_id: finalCustomerId,
        is_debt: editIsDebt,
        deduct_fee: editDeductFee,
      });

      setEditModalVisible(false);
      setSelectedTx(null);
      refetchTransactions();
      showToast("Transaction updated successfully.", "success");
    } catch (e: any) {
      Alert.alert("Error", cleanErrorMessage(e));
    } finally {
      setIsSaving(false);
    }
  };

  // Filter and search logic
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx: any) => {
      if (selectedFilter !== 'ALL' && tx.type !== selectedFilter) {
        return false;
      }
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.toLowerCase();
        const custName = (tx.customer_name || 'anonymous transaction').toLowerCase();
        const channel = (tx.channel || '').toLowerCase();
        const amtStr = (tx.amount || '').toString();
        
        return custName.includes(query) || channel.includes(query) || amtStr.includes(query);
      }
      return true;
    });
  }, [transactions, searchQuery, selectedFilter]);

  const getTxTypeDetails = (type: string) => {
    switch (type) {
      case 'CASH_IN':
        return { label: 'Cash In', text: '#6fa3d8', bg: 'rgba(111,163,216,0.12)', border: 'rgba(111,163,216,0.2)' };
      case 'CASH_OUT':
        return { label: 'Cash Out', text: C.success, bg: C.successDim, border: 'rgba(90,155,110,0.2)' };
      case 'E_LOAD':
        return { label: 'E-Load', text: '#8b7cf8', bg: 'rgba(139,124,248,0.12)', border: 'rgba(139,124,248,0.2)' };
      case 'TV_LOAD':
        return { label: 'TV Load', text: '#ab70d8', bg: 'rgba(171,112,216,0.12)', border: 'rgba(171,112,216,0.2)' };
      case 'DEBT_PAYMENT':
        return { label: 'Debt Pay', text: C.warning, bg: 'rgba(201,123,46,0.12)', border: 'rgba(201,123,46,0.2)' };
      default:
        return { label: 'Transaction', text: C.text2, bg: C.surface2, border: C.border };
    }
  };

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderColor: C.border }}>
        <TouchableOpacity onPress={handleBack} style={{ padding: 10, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
          <ArrowLeft size={18} color={C.text2} />
        </TouchableOpacity>
        <Text style={{ flex: 1, textAlign: 'center', color: C.text1, fontSize: 16, fontWeight: '800', marginRight: 40 }}>Transaction History</Text>
      </View>

      {/* Filters and List */}
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
        
        {/* Search Box */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 }}>
          <Search size={18} color={C.text3} />
          <TextInput
            style={{ flex: 1, color: C.text1, marginLeft: 8, fontSize: 14 }}
            placeholder="Search by customer, wallet, amount..."
            placeholderTextColor={C.text3}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={16} color={C.text3} />
            </TouchableOpacity>
          )}
        </View>

        {/* Category Filter Scroll */}
        <View style={{ marginBottom: 16 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
            {([
              { key: 'ALL', label: 'All' },
              { key: 'CASH_IN', label: 'Cash In' },
              { key: 'CASH_OUT', label: 'Cash Out' },
              { key: 'E_LOAD', label: 'E-Load' },
              { key: 'TV_LOAD', label: 'TV Load' },
              { key: 'DEBT_PAYMENT', label: 'Debt Pay' }
            ] as const).map((filter) => {
              const isActive = selectedFilter === filter.key;
              return (
                <TouchableOpacity
                  key={filter.key}
                  onPress={async () => {
                    if (process.env.EXPO_OS !== 'web') {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                    setSelectedFilter(filter.key);
                  }}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 12,
                    marginRight: 8,
                    borderWidth: 1,
                    backgroundColor: isActive ? C.accentDim : C.surface,
                    borderColor: isActive ? C.accent : C.border,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isActive ? C.accent : C.text2 }}>
                    {filter.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* List Content */}
        {isLoading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: C.text3, fontSize: 13 }}>Loading transaction records...</Text>
          </View>
        ) : filteredTransactions.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ color: C.text2, fontSize: 14, fontWeight: '700', marginBottom: 4 }}>No transaction records found</Text>
            <Text style={{ color: C.text3, fontSize: 12, textAlign: 'center', paddingHorizontal: 32 }}>Try adjusting your filters or search terms</Text>
          </View>
        ) : (
          <ScrollView 
            style={{ flex: 1 }} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 60 }}
          >
            {filteredTransactions.map((tx: any) => {
              const typeDetails = getTxTypeDetails(tx.type);
              const isUtang = tx.is_debt === 1;
              const formattedTime = tx.created_at 
                ? new Date(tx.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'N/A';

              return (
                <View 
                  key={tx.id}
                  style={{
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: C.border,
                    backgroundColor: C.surface,
                    marginBottom: 12,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <View style={{ flex: 1, marginRight: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: typeDetails.bg, borderWidth: 1, borderColor: typeDetails.border }}>
                        <Text style={{ fontSize: 8, fontWeight: '900', textTransform: 'uppercase', color: typeDetails.text }}>
                          {typeDetails.label}
                        </Text>
                      </View>
                      {isUtang && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: C.dangerDim, borderWidth: 1, borderColor: 'rgba(220,107,90,0.2)' }}>
                          <Text style={{ fontSize: 8, fontWeight: '900', textTransform: 'uppercase', color: C.danger }}>
                            UTANG
                          </Text>
                        </View>
                      )}
                      <Text style={{ color: C.text3, fontSize: 9 }}>{formattedTime}</Text>
                    </View>

                    <Text style={{ color: C.text1, fontSize: 14, fontWeight: '700', marginBottom: 4 }} numberOfLines={1}>
                      {tx.customer_name || 'Sari-Sari Anonymous'}
                    </Text>
                    
                    <Text style={{ color: C.text3, fontSize: 11 }}>
                      Wallet: <Text style={{ color: C.text2, fontWeight: '600' }}>{getWalletLabel(tx.channel)}</Text>
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: C.text1, fontSize: 14, fontWeight: '900', marginBottom: 2 }}>
                      ₱{tx.amount.toFixed(2)}
                    </Text>
                    {tx.fee > 0 && (
                      <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700', marginBottom: 8 }}>
                        Fee: +₱{tx.fee.toFixed(2)}
                      </Text>
                    )}
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity 
                        onPress={() => handleOpenEditModal(tx)}
                        style={{ padding: 6, backgroundColor: C.surface2, borderRadius: 8, borderWidth: 1, borderColor: C.border }}
                      >
                        <Pencil size={13} color={C.accent} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => handleDelete(tx.id)}
                        style={{ padding: 6, backgroundColor: C.surface2, borderRadius: 8, borderWidth: 1, borderColor: C.border }}
                      >
                        <Trash2 size={13} color={C.text3} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={editModalVisible}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18, 16, 14, 0.85)' }}
        >
          <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.border, borderTopLeftRadius: 36, borderTopRightRadius: 36, padding: 24, paddingBottom: 48 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <View>
                <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Log Correction</Text>
                <Text style={{ color: C.text1, fontSize: 18, fontWeight: '800', marginTop: 2 }}>Edit Record #{selectedTx?.id}</Text>
              </View>
              <TouchableOpacity 
                onPress={() => setEditModalVisible(false)} 
                style={{ padding: 8, backgroundColor: C.surface2, borderRadius: 20, borderWidth: 1, borderColor: C.border }}
              >
                <X size={18} color={C.text2} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ gap: 16 }}>
              {/* Amount and Fee Row */}
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <View style={{ flex: 1 }}>
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
                    value={editAmount}
                    onChangeText={setEditAmount}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Fee (₱)</Text>
                  <TextInput
                    style={{
                      backgroundColor: C.bg,
                      borderWidth: 1,
                      borderColor: C.border,
                      color: C.accent,
                      borderRadius: 16,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      fontSize: 14,
                      fontWeight: '700',
                      textAlign: 'center',
                    }}
                    keyboardType="decimal-pad"
                    value={editFee}
                    onChangeText={setEditFee}
                  />
                </View>
              </View>

              {/* Destination Channel Selector */}
              {selectedTx?.type !== 'DEBT_PAYMENT' && (
                <View>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Wallet Channel</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {wallets.filter((w: any) => w.channel !== 'PHYSICAL_CASH').map((w: any) => {
                      const channel = w.channel;
                      const isActive = editChannel === channel;
                      return (
                        <TouchableOpacity
                          key={channel}
                          onPress={() => setEditChannel(channel)}
                          style={{
                            minWidth: '22%',
                            flexGrow: 1,
                            paddingVertical: 10,
                            borderRadius: 12,
                            borderWidth: 1,
                            alignItems: 'center',
                            backgroundColor: isActive ? C.accentDim : C.bg,
                            borderColor: isActive ? C.accent : C.border,
                          }}
                        >
                          <Text style={{ fontWeight: '700', fontSize: 10, color: isActive ? C.accent : C.text2 }}>
                            {getWalletLabel(channel)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Conditional Deduct Fee Toggle */}
              {(selectedTx?.type === 'CASH_IN' || selectedTx?.type === 'CASH_OUT') && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, padding: 12, borderRadius: 16 }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ color: C.text1, fontSize: 12, fontWeight: '700' }}>Deduct fee from principal?</Text>
                    <Text style={{ color: C.text3, fontSize: 10, marginTop: 2 }}>Deducts the fee from digital transfer principal instead of separate cash payment.</Text>
                  </View>
                  <Switch
                    trackColor={{ false: C.border, true: C.accent }}
                    thumbColor={editDeductFee ? C.text1 : C.text3}
                    onValueChange={(val) => setEditDeductFee(val)}
                    value={editDeductFee}
                  />
                </View>
              )}

              {/* Conditional Debt Toggle */}
              {selectedTx?.type !== 'DEBT_PAYMENT' && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, padding: 12, borderRadius: 16 }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ color: C.text1, fontSize: 12, fontWeight: '700' }}>Is this an Utang / Credit item?</Text>
                    <Text style={{ color: C.text3, fontSize: 10, marginTop: 2 }}>Assign this transaction cost to debtor balance.</Text>
                  </View>
                  <Switch
                    trackColor={{ false: C.border, true: C.success }}
                    thumbColor={editIsDebt ? C.text1 : C.text3}
                    onValueChange={(val) => {
                      setEditIsDebt(val);
                      if (!val) {
                        setEditCustomerName('');
                        setSelectedCustomerId(null);
                        setCustomerSearchQuery('');
                      }
                    }}
                    value={editIsDebt}
                  />
                </View>
              )}

              {/* Conditional Debtor Name Selector */}
              {editIsDebt && (
                <View style={{ position: 'relative' }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Debtor Name</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 }}>
                    <Search size={14} color={C.text3} style={{ marginRight: 8 }} />
                    <TextInput
                      style={{ flex: 1, color: C.text1, fontSize: 13, fontWeight: '600', height: 36 }}
                      placeholder="Enter customer name..."
                      placeholderTextColor={C.text3}
                      value={editCustomerName}
                      onChangeText={(txt) => {
                        setEditCustomerName(txt);
                        setCustomerSearchQuery(txt);
                        setShowCustomerDropdown(true);
                        setSelectedCustomerId(null);
                      }}
                      onFocus={() => setShowCustomerDropdown(true)}
                    />
                  </View>

                  {showCustomerDropdown && customerSearchQuery.trim().length > 0 && (
                    <View style={{ position: 'absolute', bottom: 52, left: 0, right: 0, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 16, maxHeight: 120, overflow: 'hidden', zIndex: 100 }}>
                      <ScrollView keyboardShouldPersistTaps="always" style={{ flex: 1 }}>
                        {filteredCustomers.map((item: any) => (
                          <TouchableOpacity
                            key={item.id}
                            onPress={() => selectCustomer(item.id, item.name)}
                            style={{ padding: 10, borderBottomWidth: 1, borderColor: C.border }}
                          >
                            <Text style={{ color: C.text2, fontSize: 12, fontWeight: '600' }}>{item.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}

              {/* Save changes button */}
              <TouchableOpacity
                onPress={handleSaveChanges}
                disabled={isSaving}
                style={{
                  width: '100%',
                  paddingVertical: 14,
                  backgroundColor: C.accent,
                  borderRadius: 16,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginTop: 10,
                  opacity: isSaving ? 0.6 : 1
                }}
              >
                <Check size={18} color={C.bg} style={{ marginRight: 6 }} />
                <Text style={{ color: C.bg, fontWeight: '800', fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                  {isSaving ? 'Saving...' : 'Save Log Corrections'}
                </Text>
              </TouchableOpacity>

            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
