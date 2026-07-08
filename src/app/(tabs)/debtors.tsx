import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDbQueries, Debtor, cleanErrorMessage } from '@/hooks/useDbQueries';
import { useToast } from '@/components/toast';
import { 
  MessageSquare, 
  Check, 
  Search, 
  Coins, 
  X, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react-native';
import * as SMS from 'expo-sms';
import * as Haptics from 'expo-haptics';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';

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

export default function DebtorsScreen() {
  const { showToast } = useToast();
  const { useDebtors, useSettleDebt, useTransactions, useWallets, useDeleteCustomer } = useDbQueries();
  const { data: debtors = [], isLoading, refetch } = useDebtors();
  const { data: transactions = [] } = useTransactions();
  const { data: wallets = [] } = useWallets();
  const settleMutation = useSettleDebt();
  const deleteCustomerMutation = useDeleteCustomer();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDebtor, setSelectedDebtor] = useState<Debtor | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleChannel, setSettleChannel] = useState<string>('PHYSICAL_CASH');
  const [modalVisible, setModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [showSettledList, setShowSettledList] = useState(false);

  const handleSendSMS = async (debtor: Debtor) => {
    if (process.env.EXPO_OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const message = `Hi ${debtor.name}, this is a friendly reminder from our store regarding your outstanding balance of ₱${debtor.balance.toFixed(2)}. Please settle at your earliest convenience. Thank you!`;
    const cleanPhone = debtor.phone ? debtor.phone.replace(/[^0-9+]/g, '') : '';
    
    try {
      const isAvailable = await SMS.isAvailableAsync();
      if (isAvailable) {
        await SMS.sendSMSAsync([cleanPhone], message);
      } else {
        Alert.alert("SMS Not Available", "SMS capability is not supported on this device. Copy reminder text instead?", [
          { text: "Cancel" },
          { text: "Copy Message", onPress: () => Alert.alert("Copied!", "Message copied to clipboard.") }
        ]);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to trigger SMS interface.");
    }
  };

  const openSettleModal = (debtor: Debtor) => {
    setSelectedDebtor(debtor);
    setSettleAmount(debtor.balance.toString());
    setModalVisible(true);
  };

  const handleQuickFullSettle = async (debtor: Debtor) => {
    if (settleMutation.isPending) return; // Prevent double trigger
    
    if (process.env.EXPO_OS !== 'web') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    
    try {
      await settleMutation.mutateAsync({
        customer_id: debtor.id,
        amount: debtor.balance,
        channel: 'PHYSICAL_CASH',
      });
      refetch();
      showToast(`Fully settled ₱${debtor.balance.toFixed(2)} debt for ${debtor.name}.`, 'success');
    } catch (e: any) {
      Alert.alert("Error", cleanErrorMessage(e));
    }
  };

  const handleDeleteCustomer = (debtor: Debtor) => {
    Alert.alert(
      "Delete Customer Profile",
      `Are you sure you want to permanently delete the profile of "${debtor.name}"? Past transactions will remain in reports as anonymous, but this customer profile will be removed.`,
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
              await deleteCustomerMutation.mutateAsync(debtor.id);
              refetch();
              showToast(`Customer "${debtor.name}" deleted successfully.`, 'info');
            } catch (err: any) {
              Alert.alert("Error", cleanErrorMessage(err));
            }
          }
        }
      ]
    );
  };

  const submitSettlement = async () => {
    if (!selectedDebtor || settleMutation.isPending) return; // Prevent double trigger
    const amount = parseFloat(settleAmount);

    if (isNaN(amount) || amount <= 0 || amount > selectedDebtor.balance) {
      Alert.alert("Invalid Amount", "Please enter a valid amount between 0 and " + selectedDebtor.balance);
      return;
    }

    try {
      if (process.env.EXPO_OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      await settleMutation.mutateAsync({
        customer_id: selectedDebtor.id,
        amount,
        channel: settleChannel,
      });

      setModalVisible(false);
      setDetailModalVisible(false);
      const name = selectedDebtor.name;
      setSelectedDebtor(null);
      refetch();
      showToast(`Settled ₱${amount.toFixed(2)} for ${name}.`, 'success');
    } catch (e: any) {
      Alert.alert("Error", cleanErrorMessage(e));
    }
  };

  const getDebtAge = (dateStr: string | null) => {
    if (!dateStr) return 0;
    const diffTime = Math.abs(new Date().getTime() - new Date(dateStr).getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  const getAgeWarning = (age: number) => {
    if (age >= 14) {
      return {
        level: 'alert',
        bg: C.dangerDim,
        borderColor: C.danger,
        text: C.danger,
        fontWeight: '800' as const,
        label: `${age} Days Overdue (Critical Alert)`
      };
    } else if (age >= 7) {
      return {
        level: 'warning',
        bg: C.accentDim,
        borderColor: C.accent,
        text: C.accent,
        fontWeight: '700' as const,
        label: `${age} Days Outstanding`
      };
    }
    return {
      level: 'normal',
      bg: C.surface,
      borderColor: C.border,
      text: C.text3,
      fontWeight: '500' as const,
      label: `${age} Days`
    };
  };

  const filteredDebtors = debtors.filter(d => 
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeDebtors = useMemo(() => filteredDebtors.filter(d => d.balance > 0), [filteredDebtors]);
  const settledDebtors = useMemo(() => filteredDebtors.filter(d => d.balance === 0), [filteredDebtors]);

  const totalOutstanding = debtors.reduce((sum, d) => sum + d.balance, 0);

  // Filter transactions for selected debtor
  const debtorLedgerHistory = useMemo(() => {
    if (!selectedDebtor) return [];
    return transactions.filter(t => t.customer_id === selectedDebtor.id && (t.is_debt === 1 || t.type === 'DEBT_PAYMENT'));
  }, [transactions, selectedDebtor]);

  const renderRightActions = (debtor: Debtor) => {
    if (debtor.balance <= 0) return null; // No swipe full settle if already paid
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', height: '100%' }}>
        <TouchableOpacity
          onPress={() => handleQuickFullSettle(debtor)}
          disabled={settleMutation.isPending}
          style={{
            backgroundColor: C.success,
            paddingHorizontal: 20,
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            borderTopRightRadius: 16,
            borderBottomRightRadius: 16,
            opacity: settleMutation.isPending ? 0.6 : 1,
          }}
        >
          <Check size={18} color={C.bg} />
          <Text style={{ color: C.bg, fontWeight: '900', fontSize: 9, textTransform: 'uppercase', marginTop: 4 }}>Full Pay</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const getTxTypeLabel = (type: string) => {
    switch (type) {
      case 'CASH_IN': return 'Cash In (Remit)';
      case 'CASH_OUT': return 'Cash Out (Withdraw)';
      case 'E_LOAD': return 'E-Load';
      case 'TV_LOAD': return 'TV Load';
      case 'DEBT_PAYMENT': return 'Debt Payment';
      default: return type;
    }
  };

  const getWalletLabel = (channel: string) => {
    const upper = channel.toUpperCase();
    const defaultNames: Record<string, string> = {
      PHYSICAL_CASH: 'Cash Box',
      GCASH: 'GCash',
      MAYA: 'Maya',
      MAYA_BUSINESS: 'Maya Biz',
      MARIBANK: 'MariBank',
    };
    if (defaultNames[upper]) return defaultNames[upper];
    return channel.length <= 4 ? channel.toUpperCase() : (channel.charAt(0).toUpperCase() + channel.slice(1));
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
        <ScrollView 
          style={{ flex: 1, paddingHorizontal: 16 }} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 110 }}
        >
          {/* Header */}
          <View style={{ marginVertical: 20 }}>
            <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>Utang Ledger</Text>
            <Text style={{ color: C.text1, fontSize: 24, fontWeight: '800', marginTop: 2 }}>Debtors List</Text>
          </View>

          {/* Outstanding Summary */}
          <View
            style={{
              backgroundColor: C.surface,
              borderRadius: 22,
              padding: 20,
              borderWidth: 1,
              borderColor: C.border,
              marginBottom: 16,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <View>
              <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Total Outstanding Debt</Text>
              <Text style={{ fontSize: 28, fontWeight: '900', color: C.accent, letterSpacing: -0.5 }}>
                ₱{totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={{ backgroundColor: C.accentDim, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(230,168,23,0.2)' }}>
              <AlertTriangle size={24} color={C.accent} />
            </View>
          </View>

          {/* Search Bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 20 }}>
            <Search size={18} color={C.text3} style={{ marginRight: 8 }} />
            <TextInput
              style={{ flex: 1, color: C.text1, fontSize: 14 }}
              placeholder="Search debtors by name..."
              placeholderTextColor={C.text3}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {/* ACTIVE OUTSTANDING DEBTORS SECTION */}
          <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', marginBottom: 12 }}>
            Active Outstanding Debts ({activeDebtors.length})
          </Text>

          {isLoading ? (
            <Text style={{ color: C.text3, textAlign: 'center', paddingVertical: 24 }}>Loading ledger records...</Text>
          ) : activeDebtors.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: 'center', backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, marginBottom: 20 }}>
              <Text style={{ color: C.text3, fontSize: 13 }}>No active outstanding debts.</Text>
            </View>
          ) : (
            <View style={{ gap: 12, marginBottom: 24 }}>
              {activeDebtors.map((debtor) => {
                const age = getDebtAge(debtor.oldest_debt_date);
                const alertInfo = getAgeWarning(age);

                return (
                  <Swipeable
                    key={debtor.id}
                    renderRightActions={() => renderRightActions(debtor)}
                    containerStyle={{ borderRadius: 16 }}
                  >
                    <TouchableOpacity
                      onPress={async () => {
                        if (process.env.EXPO_OS !== 'web') {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }
                        setSelectedDebtor(debtor);
                        setDetailModalVisible(true);
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={{
                        padding: 16,
                        borderRadius: 16,
                        backgroundColor: alertInfo.bg,
                        borderWidth: 1,
                        borderColor: alertInfo.borderColor,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={{ color: C.text1, fontSize: 15, fontWeight: '800' }}>{debtor.name}</Text>
                            {alertInfo.level !== 'normal' && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(230,168,23,0.1)', borderWidth: 1, borderColor: 'rgba(230,168,23,0.2)' }}>
                                <AlertTriangle size={8} color={C.accent} />
                                <Text style={{ color: C.accent, fontSize: 8, fontWeight: '900' }}>OVERDUE</Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ fontSize: 9, fontWeight: alertInfo.fontWeight, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1, color: alertInfo.text }}>
                            {alertInfo.label}
                          </Text>
                          {debtor.phone && (
                            <Text style={{ color: C.text3, fontSize: 10, marginTop: 2 }}>Phone: {debtor.phone}</Text>
                          )}
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <View style={{ alignItems: 'flex-end', marginRight: 4 }}>
                            <Text style={{ color: C.text1, fontSize: 16, fontWeight: '900' }}>
                              ₱{debtor.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </Text>
                            <Text style={{ color: C.text3, fontSize: 9, textAlign: 'right' }}>outstanding</Text>
                          </View>

                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            <TouchableOpacity
                              onPress={() => openSettleModal(debtor)}
                              style={{ backgroundColor: C.surface2, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border }}
                            >
                              <Coins size={14} color={C.accent} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleSendSMS(debtor)}
                              style={{ backgroundColor: C.surface2, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border }}
                            >
                              <MessageSquare size={14} color="#6fa3d8" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </Swipeable>
                );
              })}
            </View>
          )}

          {/* SETTLED / PAID ACCOUNTS SECTION */}
          {settledDebtors.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <TouchableOpacity 
                onPress={() => setShowSettledList(!showSettledList)}
                style={{ 
                  flexDirection: 'row', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  paddingVertical: 12, 
                  borderTopWidth: 1, 
                  borderColor: C.border, 
                  marginBottom: 12 
                }}
              >
                <Text style={{ color: C.text3, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }}>
                  Settled Accounts & History ({settledDebtors.length})
                </Text>
                {showSettledList ? <ChevronUp size={16} color={C.text3} /> : <ChevronDown size={16} color={C.text3} />}
              </TouchableOpacity>

              {showSettledList && (
                <View style={{ gap: 12 }}>
                  {settledDebtors.map((debtor) => (
                    <TouchableOpacity
                      key={debtor.id}
                      onPress={async () => {
                        if (process.env.EXPO_OS !== 'web') {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }
                        setSelectedDebtor(debtor);
                        setDetailModalVisible(true);
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={{
                        padding: 16,
                        borderRadius: 16,
                        backgroundColor: C.surface,
                        borderWidth: 1,
                        borderColor: C.border,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={{ color: C.text2, fontSize: 14, fontWeight: '700' }}>{debtor.name}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.success }} />
                            <Text style={{ color: C.success, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              Settled / Paid Off
                            </Text>
                          </View>
                          {debtor.phone && (
                            <Text style={{ color: C.text3, fontSize: 10, marginTop: 2 }}>Phone: {debtor.phone}</Text>
                          )}
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={{ color: C.text3, fontSize: 14, fontWeight: '700' }}>
                              ₱0.00
                            </Text>
                            <Text style={{ color: C.text3, fontSize: 9, textTransform: 'uppercase', marginTop: 2 }}>View Ledger</Text>
                          </View>
                          
                          <TouchableOpacity
                            onPress={async (e) => {
                              e.stopPropagation();
                              handleDeleteCustomer(debtor);
                            }}
                            disabled={deleteCustomerMutation.isPending}
                            style={{
                              padding: 8,
                              backgroundColor: C.dangerDim,
                              borderRadius: 10,
                              borderWidth: 1,
                              borderColor: 'rgba(220,107,90,0.15)',
                            }}
                          >
                            <Trash2 size={13} color={C.danger} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

        </ScrollView>

        {/* Debtor Profile Detail Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={detailModalVisible}
          onRequestClose={() => setDetailModalVisible(false)}
        >
          <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18, 16, 14, 0.85)' }}>
            <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.border, borderTopLeftRadius: 36, borderTopRightRadius: 36, padding: 24, height: '75%', paddingBottom: 48 }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <View>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Debtor Statement</Text>
                  <Text style={{ color: C.text1, fontSize: 20, fontWeight: '800', marginTop: 2 }}>{selectedDebtor?.name}</Text>
                </View>
                <TouchableOpacity 
                  onPress={() => setDetailModalVisible(false)} 
                  style={{ padding: 8, backgroundColor: C.surface2, borderRadius: 20, borderWidth: 1, borderColor: C.border }}
                >
                  <X size={18} color={C.text2} />
                </TouchableOpacity>
              </View>

              {/* Total Balance Card */}
              <View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 20, padding: 16, marginBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>Current Balance</Text>
                  <Text style={{ color: selectedDebtor && selectedDebtor.balance > 0 ? C.accent : C.success, fontSize: 24, fontWeight: '900', marginTop: 4 }}>
                    ₱{selectedDebtor?.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {selectedDebtor && selectedDebtor.balance > 0 ? (
                    <>
                      <TouchableOpacity
                        onPress={() => openSettleModal(selectedDebtor)}
                        style={{ backgroundColor: C.surface2, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                      >
                        <Coins size={14} color={C.accent} />
                        <Text style={{ color: C.text2, fontSize: 11, fontWeight: '700' }}>Settle</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleSendSMS(selectedDebtor)}
                        style={{ backgroundColor: C.surface2, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border }}
                      >
                        <MessageSquare size={14} color="#6fa3d8" />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <View style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.successDim, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(90,155,110,0.2)' }}>
                      <Text style={{ color: C.success, fontWeight: '700', fontSize: 11 }}>ALL PAID</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Itemized Ledger */}
              <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>Ledger History</Text>
              
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                {debtorLedgerHistory.length === 0 ? (
                  <Text style={{ color: C.text3, fontSize: 12, textAlign: 'center', paddingVertical: 20 }}>No transaction history for this customer.</Text>
                ) : (
                  <View style={{ gap: 10 }}>
                    {debtorLedgerHistory.map((tx) => {
                      const isPayment = tx.type === 'DEBT_PAYMENT';
                      const txTotal = isPayment ? tx.amount : (tx.amount + (tx.deduct_fee === 1 ? 0 : tx.fee));
                      const formattedDate = tx.created_at
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
                            backgroundColor: C.surface2,
                            borderWidth: 1,
                            borderColor: C.border,
                            borderRadius: 14,
                            padding: 12,
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <View style={{ flex: 1, marginRight: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                              <View style={{
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 4,
                                backgroundColor: isPayment ? C.successDim : C.dangerDim,
                                borderWidth: 1,
                                borderColor: isPayment ? 'rgba(90,155,110,0.15)' : 'rgba(220,107,90,0.15)'
                              }}>
                                <Text style={{ color: isPayment ? C.success : C.danger, fontSize: 7, fontWeight: '900', textTransform: 'uppercase' }}>
                                  {isPayment ? 'Payment' : 'Debt'}
                                </Text>
                              </View>
                              <Text style={{ color: C.text1, fontSize: 12, fontWeight: '700' }}>
                                {getTxTypeLabel(tx.type)}
                              </Text>
                            </View>
                            <Text style={{ color: C.text3, fontSize: 9 }}>{formattedDate} • via {getWalletLabel(tx.channel)}</Text>
                          </View>

                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={{ color: isPayment ? C.success : C.danger, fontSize: 13, fontWeight: '800' }}>
                              {isPayment ? '-' : '+'}₱{txTotal.toFixed(2)}
                            </Text>
                            {!isPayment && tx.fee > 0 && (
                              <Text style={{ color: C.text3, fontSize: 8 }}>
                                {tx.deduct_fee === 1 ? `Deducted ₱${tx.fee.toFixed(2)} fee` : `Inc. ₱${tx.fee.toFixed(2)} fee`}
                              </Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Custom Settle Debt Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={modalVisible}
          onRequestClose={() => setModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18, 16, 14, 0.85)' }}
          >
            <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.border, borderTopLeftRadius: 36, borderTopRightRadius: 36, padding: 24, paddingBottom: 48 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <View>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Settle Ledger</Text>
                  <Text style={{ color: C.text1, fontSize: 18, fontWeight: '800', marginTop: 2 }}>Pay Debt: {selectedDebtor?.name}</Text>
                </View>
                <TouchableOpacity 
                  onPress={() => setModalVisible(false)} 
                  disabled={settleMutation.isPending}
                  style={{ padding: 8, backgroundColor: C.surface2, borderRadius: 20, borderWidth: 1, borderColor: C.border, opacity: settleMutation.isPending ? 0.5 : 1 }}
                >
                  <X size={18} color={C.text2} />
                </TouchableOpacity>
              </View>

              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Payment Received (₱)</Text>
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
                  marginBottom: 16,
                }}
                keyboardType="decimal-pad"
                value={settleAmount}
                onChangeText={setSettleAmount}
                editable={!settleMutation.isPending}
              />

              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Destination Channel (Add Float)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                {wallets.map((w: any) => {
                  const channel = w.channel;
                  const isActive = settleChannel === channel;
                  return (
                    <TouchableOpacity
                      key={channel}
                      onPress={() => setSettleChannel(channel)}
                      disabled={settleMutation.isPending}
                      style={{
                        minWidth: '30%',
                        flexGrow: 1,
                        paddingVertical: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        alignItems: 'center',
                        backgroundColor: isActive ? C.accentDim : C.bg,
                        borderColor: isActive ? C.accent : C.border,
                        opacity: settleMutation.isPending ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ fontWeight: '700', fontSize: 11, color: isActive ? C.accent : C.text2 }}>
                        {getWalletLabel(channel)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                onPress={submitSettlement}
                disabled={settleMutation.isPending}
                style={{
                  width: '100%',
                  paddingVertical: 16,
                  backgroundColor: C.success,
                  borderRadius: 16,
                  justifyContent: 'center',
                  alignItems: 'center',
                  opacity: settleMutation.isPending ? 0.6 : 1,
                }}
              >
                <Text style={{ color: C.bg, fontWeight: '800', fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                  {settleMutation.isPending ? 'Confirming Payment...' : 'Confirm Payment'}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
