import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Modal, KeyboardAvoidingView, FlatList, SectionList } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateDebtPaymentAllocation, getDebtOutstandingById, getDebtorBalanceStatus, isSettlementBreakdownBalanced, splitSettlementReceived, useDbQueries, Debtor, Transaction, cleanErrorMessage } from '@/hooks/useDbQueries';
import { ToastNotice, useToast, type ToastType } from '@/components/toast';
import { GoldButton } from '@/components/gold-button';
import { useRouter, useLocalSearchParams } from 'expo-router';
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
  PlusCircle,
  Pencil,
} from 'lucide-react-native';
import * as SMS from 'expo-sms';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { ledgerColors as C, ledgerRadius, ledgerSpacing } from '@/theme/ledger';
import { LedgerEmptyState, LedgerErrorState, LedgerLoadingState } from '@/components/ledger-state';
import { getDebtorPaymentLabel, isPaymentWithinDays } from '@/utils/debtor-payment-label';
import { useScreenFocus } from '@/hooks/useScreenFocus';
import { isValidMoneyInput } from '@/utils/strict-money';

// ─── Obsidian & Gold Design ────────────────────────────────────────────────────
export default function DebtorsScreen() {
  const { showToast } = useToast();
  const isScreenFocused = useScreenFocus();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { settleDebtId } = useLocalSearchParams<{ settleDebtId?: string }>();
  const { useDebtors, useDebtLedgerSummary, useDebtTransactionsForCustomer, useDebtTransactionById, useSettleDebt, useWallets, useDeleteCustomer, useDeleteTransaction, useUpdateCustomerMeta } = useDbQueries();
  const { data: debtors = [], isLoading, isError, refetch } = useDebtors(isScreenFocused);
  const parsedSettleDebtId = Number(settleDebtId);
  const settleDebtRecordId = Number.isSafeInteger(parsedSettleDebtId) && parsedSettleDebtId > 0 ? parsedSettleDebtId : null;
  const { data: linkedDebt, isLoading: isLinkedDebtLoading, isError: isLinkedDebtError } = useDebtTransactionById(
    settleDebtRecordId,
    isScreenFocused && settleDebtRecordId != null,
  );
  const { data: debtAllocation } = useDebtLedgerSummary(isScreenFocused);
  const { data: wallets = [] } = useWallets(isScreenFocused);
  const settleMutation = useSettleDebt();
  const deleteCustomerMutation = useDeleteCustomer();
  const deleteTransactionMutation = useDeleteTransaction();
  const updateCustomerMetaMutation = useUpdateCustomerMeta();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDebtor, setSelectedDebtor] = useState<Debtor | null>(null);
  const [selectedDebtEntry, setSelectedDebtEntry] = useState<Transaction | null>(null);
  const [selectedDebtIds, setSelectedDebtIds] = useState<number[]>([]);
  const [isDebtSelectionMode, setIsDebtSelectionMode] = useState(false);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleProfit, setSettleProfit] = useState('');
  const [settleChannel, setSettleChannel] = useState<string>('PHYSICAL_CASH');
  const [modalVisible, setModalVisible] = useState(false);
  const [settlementNotice, setSettlementNotice] = useState<{ message: string; type: ToastType } | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [showSettledList, setShowSettledList] = useState(false);
  const [sortMode, setSortMode] = useState<'overdue' | 'recent_activity' | 'largest' | 'recent_payment'>('recent_activity');
  const [activeQuickFilter, setActiveQuickFilter] = useState<'all' | 'overdue' | 'paid_recently' | 'no_payment'>('all');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const ledgerCustomerId = detailModalVisible
    ? selectedDebtor?.id ?? null
    : linkedDebt?.customer_id ?? null;
  const shouldLoadLedgerHistory = detailModalVisible || linkedDebt != null;
  const {
    data: debtorLedgerHistory = [],
    isLoading: isDebtorLedgerLoading,
    isError: isDebtorLedgerError,
    refetch: refetchDebtorLedger,
  } = useDebtTransactionsForCustomer(
    ledgerCustomerId,
    isScreenFocused && shouldLoadLedgerHistory,
  );
  const outstandingByDebtId = useMemo(
    () => getDebtOutstandingById(debtorLedgerHistory),
    [debtorLedgerHistory],
  );
  const activeSelectedDebtIds = useMemo(
    () => selectedDebtIds.filter((debtId) => (outstandingByDebtId.get(debtId) || 0) > 0.01),
    [outstandingByDebtId, selectedDebtIds],
  );
  const selectableDebtEntries = useMemo(
    () => debtorLedgerHistory.filter((transaction) => transaction.is_debt === 1 && (outstandingByDebtId.get(transaction.id) || 0) > 0.01),
    [debtorLedgerHistory, outstandingByDebtId],
  );
  const sortModeLabel = {
    overdue: 'Oldest overdue',
    recent_activity: 'Recent activity',
    largest: 'Largest balance',
    recent_payment: 'Recent payment',
  }[sortMode];

  const getSettlementPrincipalCap = () => {
    if (!selectedDebtor) return 0;
    if (activeSelectedDebtIds.length > 0) {
      return activeSelectedDebtIds.reduce((total, debtId) => total + (outstandingByDebtId.get(debtId) || 0), 0);
    }
    return selectedDebtEntry
      ? outstandingByDebtId.get(selectedDebtEntry.id) || 0
      : selectedDebtor.balance;
  };

  const handleSendSMS = async (debtor: Debtor) => {
    if (process.env.EXPO_OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const message = `Hi ${debtor.name}, this is a friendly reminder from our store regarding your outstanding balance of ₱${debtor.balance.toFixed(2)}. Please settle at your earliest convenience. Thank you!`;
    const cleanPhone = debtor.phone ? debtor.phone.replace(/[^0-9+]/g, '') : '';
    const copyReminder = async () => {
      try {
        await Clipboard.setStringAsync(message);
        showToast('Reminder copied to clipboard.', 'success');
      } catch (error) {
        Alert.alert('Copy Failed', cleanErrorMessage(error));
      }
    };
    
    try {
      if (!cleanPhone) {
        if (process.env.EXPO_OS === 'web') {
          await copyReminder();
        } else {
          Alert.alert('Phone Number Needed', 'Add a phone number to send an SMS. You can copy the reminder text instead.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Copy Message', onPress: () => { void copyReminder(); } },
          ]);
        }
        return;
      }
      const isAvailable = await SMS.isAvailableAsync();
      if (isAvailable) {
        const result = await SMS.sendSMSAsync([cleanPhone], message);
        if (result.result === 'sent') {
          await updateCustomerMetaMutation.mutateAsync({
            id: debtor.id,
            last_reminded_at: new Date().toISOString(),
          });
          refetch();
          showToast('SMS sent.', 'success');
        } else if (result.result === 'cancelled') {
          showToast('SMS was cancelled; no reminder was recorded.', 'info');
        } else {
          showToast('SMS status is unknown; no reminder was recorded.', 'info');
        }
      } else {
        if (process.env.EXPO_OS === 'web') {
          await copyReminder();
        } else {
          Alert.alert('SMS Not Available', 'SMS is not supported on this device. Copy reminder text instead?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Copy Message', onPress: () => { void copyReminder(); } },
          ]);
        }
      }
    } catch (error) {
      Alert.alert('Error', cleanErrorMessage(error));
    }
  };

  const openSettleModal = (debtor: Debtor) => {
    setSettlementNotice(null);
    setSelectedDebtor(debtor);
    setSelectedDebtEntry(null);
    setSelectedDebtIds([]);
    setSettleAmount(debtor.balance.toString());
    setSettleProfit('');
    setModalVisible(true);
  };

  const handleSettlementAmountChange = (value: string) => {
    setSettleAmount(value);
    const received = parseFloat(value);
    if (!selectedDebtor || !Number.isFinite(received) || received <= 0) return;

    const { suggestedProfit } = splitSettlementReceived(received, getSettlementPrincipalCap());
    setSettleProfit(suggestedProfit > 0 ? suggestedProfit.toFixed(2) : '');
  };

  const handleQuickFullSettle = async (debtor: Debtor) => {
    if (settleMutation.isPending) return;
    const confirmSettlement = () => {
      if (process.env.EXPO_OS === 'web') {
        if (window.confirm(`Record a full payment of ₱${debtor.balance.toFixed(2)} for ${debtor.name} via Cash Box?`)) {
          void performQuickSettlement(debtor);
        }
        return;
      }
      Alert.alert(
        'Confirm Full Payment',
        `Record ₱${debtor.balance.toFixed(2)} received via Cash Box for ${debtor.name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm Payment', onPress: () => { void performQuickSettlement(debtor); } },
        ]
      );
    };
    confirmSettlement();
  };

  const performQuickSettlement = async (debtor: Debtor) => {
    if (settleMutation.isPending) return;
    showToast('Recording debt payment…', 'info');
    try {
      await settleMutation.mutateAsync({
        customer_id: debtor.id,
        amount: debtor.balance,
        channel: 'PHYSICAL_CASH',
      });
      showToast(`Fully settled ₱${debtor.balance.toFixed(2)} debt for ${debtor.name}.`, 'success');
    } catch (e: any) {
      showToast(`Payment could not be recorded: ${cleanErrorMessage(e)}`, 'error');
    }
  };

  const handleDeleteCustomer = (debtor: Debtor) => {
    if (Math.abs(debtor.balance) > 0.01) {
      Alert.alert(
        "Cannot Delete Customer",
        debtor.balance > 0
          ? `This customer owes ₱${debtor.balance.toFixed(2)}. Please settle the balance first before deleting their profile.`
          : `This customer has ₱${Math.abs(debtor.balance).toFixed(2)} in credit. Resolve the credit before deleting their profile.`,
        [{ text: "OK" }]
      );
      return;
    }

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

  const openTransactionEditor = (transactionId: number) => {
    setDetailModalVisible(false);
    router.push({ pathname: '/history', params: { editTxId: transactionId.toString() } });
  };

  const handleDeleteLedgerTransaction = (transactionId: number) => {
    const revert = () => deleteTransactionMutation.mutate(transactionId, {
      onSuccess: () => {
        setDetailModalVisible(false);
        refetch();
        showToast('Transaction reverted successfully.', 'info');
      },
      onError: (error: unknown) => {
        Alert.alert('Error', cleanErrorMessage(error));
      },
    });

    if (process.env.EXPO_OS === 'web') {
      if (window.confirm('Are you sure you want to revert this transaction? This will automatically restore the original wallet balances.')) {
        revert();
      }
      return;
    }

    Alert.alert(
      'Revert Transaction',
      'Are you sure you want to delete this record? This will automatically reverse the transaction and restore the original wallet floats.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revert', style: 'destructive', onPress: revert },
      ]
    );
  };

  const openDebtEntry = async (debtor: Debtor) => {
    if (process.env.EXPO_OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    closeDebtorStatement();
    router.push({
      pathname: '/entry',
      params: {
        debtorId: debtor.id.toString(),
        debtorName: debtor.name,
      },
    });
  };

  const closeDebtorStatement = () => {
    setDetailModalVisible(false);
    // A statement is a fresh session each time it opens. Never carry a prior
    // batch selection into another visit or another debtor.
    setIsDebtSelectionMode(false);
    setSelectedDebtIds([]);
    setSelectedDebtEntry(null);
  };

  const submitSettlement = async () => {
    if (!selectedDebtor || settleMutation.isPending) return; // Prevent double trigger
    if (!isValidMoneyInput(settleAmount, true) || (settleProfit.trim() !== '' && !isValidMoneyInput(settleProfit, true))) {
      setSettlementNotice({ message: 'Enter a valid amount with no more than two decimal places.', type: 'error' });
      return;
    }
    const received = Number(settleAmount);
    const enteredProfit = parseFloat(settleProfit);
    const principalCap = getSettlementPrincipalCap();
    const settlementSplit = splitSettlementReceived(received, principalCap);
    const profit = Number.isFinite(enteredProfit)
      ? enteredProfit
      : settlementSplit.suggestedProfit;
    const amount = settlementSplit.principal;

    if (received < 0 || profit < 0) {
      setSettlementNotice({ message: 'Please enter non-negative amounts.', type: 'error' });
      return;
    }
    // The entered amount is the total collected. It must be fully accounted
    // for as principal plus extra profit; otherwise wallet float and ledger
    // totals silently diverge. A zero-principal profit-only entry remains valid.
    if (!isSettlementBreakdownBalanced(received, amount, profit)) {
      setSettlementNotice({
        message: `Total received (₱${received.toFixed(2)}) must equal principal (₱${amount.toFixed(2)}) plus extra profit (₱${profit.toFixed(2)}). Keep the suggested profit or adjust the received amount.`,
        type: 'error',
      });
      return;
    }
    if (amount === 0 && profit <= 0) {
      setSettlementNotice({ message: 'Enter a principal payment or extra profit/interest payment.', type: 'error' });
      return;
    }
    setSettlementNotice({ message: 'Recording debt payment…', type: 'info' });
    if (process.env.EXPO_OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch((error: unknown) => {
        console.warn('Settlement haptic feedback failed.', error);
      });
    }
    try {
      await settleMutation.mutateAsync({
        customer_id: selectedDebtor.id,
        amount,
        profit,
        channel: settleChannel,
        target_debt_id: selectedDebtEntry?.id,
        target_debt_ids: activeSelectedDebtIds.length > 0 ? activeSelectedDebtIds : undefined,
      });

      setModalVisible(false);
      setDetailModalVisible(false);
      setSettlementNotice(null);
      const name = selectedDebtor.name;
      setSelectedDebtor(null);
      setSelectedDebtEntry(null);
      setSelectedDebtIds([]);
      setIsDebtSelectionMode(false);
      if (amount === 0) {
        showToast(`Recorded PHP ${profit.toFixed(2)} interest for ${name}. Debt principal unchanged.`, 'success');
        return;
      }
      showToast(
        profit > 0
          ? `Recorded ₱${amount.toFixed(2)} debt payment and ₱${profit.toFixed(2)} extra profit for ${name}.`
          : `Settled ₱${amount.toFixed(2)} for ${name}.`,
        'success'
      );
    } catch (e: any) {
      setSettlementNotice({ message: `Payment could not be recorded: ${cleanErrorMessage(e)}`, type: 'error' });
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
        label: `Oldest balance: ${age} days`
      };
    } else if (age >= 7) {
      return {
        level: 'warning',
        bg: C.accentDim,
        borderColor: C.accent,
        text: C.accent,
        fontWeight: '700' as const,
        label: `Oldest balance: ${age} days`
      };
    }
    return {
      level: 'normal',
      bg: C.surface,
      borderColor: C.border,
      text: C.text3,
      fontWeight: '500' as const,
      label: `Oldest balance: ${age} days`
    };
  };

  const filteredDebtors = debtors.filter(d => 
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeDebtors = useMemo(() => {
    const active = filteredDebtors.filter(d => getDebtorBalanceStatus(d.balance) === 'active');
    const base = active.filter((debtor) => {
      if (activeQuickFilter === 'overdue') return getDebtAge(debtor.oldest_debt_date) >= 7;
      if (activeQuickFilter === 'paid_recently') return isPaymentWithinDays(debtor.last_payment_date, 7);
      if (activeQuickFilter === 'no_payment') return !debtor.last_payment_date;
      return true;
    });
    return [...base].sort((a, b) => {
      if (sortMode === 'largest') return b.balance - a.balance;
      if (sortMode === 'recent_activity') {
        const timeA = a.latest_tx_date ? new Date(a.latest_tx_date).getTime() : 0;
        const timeB = b.latest_tx_date ? new Date(b.latest_tx_date).getTime() : 0;
        return timeB - timeA;
      }
      if (sortMode === 'recent_payment') {
        return new Date(b.last_payment_date || 0).getTime() - new Date(a.last_payment_date || 0).getTime();
      }
      return getDebtAge(b.oldest_debt_date) - getDebtAge(a.oldest_debt_date);
    });
  }, [activeQuickFilter, filteredDebtors, sortMode]);
  const creditDebtors = useMemo(() => filteredDebtors.filter(d => getDebtorBalanceStatus(d.balance) === 'credit'), [filteredDebtors]);
  const settledDebtors = useMemo(() => filteredDebtors.filter(d => getDebtorBalanceStatus(d.balance) === 'settled'), [filteredDebtors]);

  const debtPortfolioSummary = useMemo(() => {
    const allocation = debtAllocation || {
      contractualEarningsPaid: 0,
      extraProfitPaid: 0,
      pendingEarnings: 0,
      principalPaid: 0,
      pendingPrincipal: 0,
    };
    return {
      earningsPaid: allocation.contractualEarningsPaid + allocation.extraProfitPaid,
      pendingEarnings: allocation.pendingEarnings,
      principalPaid: allocation.principalPaid,
      pendingPrincipal: allocation.pendingPrincipal,
      outstanding: allocation.pendingPrincipal + allocation.pendingEarnings,
    };
  }, [debtAllocation]);

  useEffect(() => {
    if (!isScreenFocused || settleDebtRecordId == null) return;
    if (isLinkedDebtError) {
      showToast('Could not load the selected debt.', 'error');
      router.setParams({ settleDebtId: undefined });
      return;
    }
    if (isLinkedDebtLoading || isLoading) return;
    if (isError) {
      showToast('Could not load debtor records.', 'error');
      router.setParams({ settleDebtId: undefined });
      return;
    }
    const debt = linkedDebt;
    const debtor = debt?.customer_id == null ? undefined : debtors.find(item => item.id === debt.customer_id);
    if (!debt || !debtor) {
      router.setParams({ settleDebtId: undefined });
      return;
    }
    if (isDebtorLedgerLoading) return;
    if (isDebtorLedgerError) {
      showToast('Could not load this debtor’s ledger.', 'error');
      router.setParams({ settleDebtId: undefined });
      return;
    }
    const outstanding = outstandingByDebtId.get(debt.id) || 0;
    router.setParams({ settleDebtId: undefined });
    if (outstanding <= 0.01) return;
    const openPayment = setTimeout(() => {
      setSelectedDebtor(debtor);
      setSelectedDebtEntry(debt);
      setSettleAmount(outstanding.toFixed(2));
      setSettleProfit('');
      setDetailModalVisible(false);
      setModalVisible(true);
    }, 0);
    return () => clearTimeout(openPayment);
  }, [
    debtors,
    isDebtorLedgerError,
    isDebtorLedgerLoading,
    isError,
    isLoading,
    isScreenFocused,
    isLinkedDebtError,
    isLinkedDebtLoading,
    linkedDebt,
    outstandingByDebtId,
    router,
    settleDebtRecordId,
    setModalVisible,
    showToast,
  ]);

  const openSelectedDebtPayment = (debt: Transaction) => {
    const outstanding = outstandingByDebtId.get(debt.id) || 0;
    if (outstanding <= 0.01) return;
    setSelectedDebtEntry(debt);
    setSelectedDebtIds([]);
    setSettleAmount(outstanding.toFixed(2));
    setSettleProfit('');
    setModalVisible(true);
  };

  const toggleDebtSelection = (debt: Transaction) => {
    const outstanding = outstandingByDebtId.get(debt.id) || 0;
    if (outstanding <= 0.01) return;
    setSelectedDebtIds((current) => {
      const active = current.filter((id) => (outstandingByDebtId.get(id) || 0) > 0.01);
      return active.includes(debt.id) ? active.filter((id) => id !== debt.id) : [...active, debt.id];
    });
  };

  const openBatchDebtPayment = () => {
    const selectedTotal = getSettlementPrincipalCap();
    if (!selectedDebtor || activeSelectedDebtIds.length === 0 || selectedTotal <= 0.01) return;
    setSettlementNotice(null);
    setSelectedDebtEntry(null);
    setSettleAmount(selectedTotal.toFixed(2));
    setSettleProfit('');
    setModalVisible(true);
  };

  const debtorStatementSummary = useMemo(() => {
    const allocation = calculateDebtPaymentAllocation(debtorLedgerHistory);
    return {
      principalPaid: allocation.principalPaid,
      earningsPaid: allocation.contractualEarningsPaid + allocation.extraProfitPaid,
      pendingPrincipal: allocation.pendingPrincipal,
      pendingEarnings: allocation.pendingEarnings,
      pending: allocation.pendingPrincipal + allocation.pendingEarnings,
    };
  }, [debtorLedgerHistory]);

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

  const openDebtorDetails = async (debtor: Debtor) => {
    if (process.env.EXPO_OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedDebtor(debtor);
    setDetailModalVisible(true);
  };

  const renderActiveDebtor = ({ item: debtor }: { item: Debtor }) => {
    const age = getDebtAge(debtor.oldest_debt_date);
    const alertInfo = getAgeWarning(age);
    const paymentActivity = debtor.last_payment_date
      ? getDebtorPaymentLabel(debtor.last_payment_date)
      : null;

    return (
      <Swipeable
        renderRightActions={() => renderRightActions(debtor)}
        containerStyle={{ borderRadius: 16 }}
      >
        <TouchableOpacity onPress={() => openDebtorDetails(debtor)} activeOpacity={0.85}>
          <View style={{
            padding: 16,
            borderRadius: 16,
            backgroundColor: alertInfo.bg,
            borderWidth: 1,
            borderColor: alertInfo.borderColor,
            paddingBottom: 14,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={{ color: C.text1, fontSize: 15, fontWeight: '800' }}>{debtor.name}</Text>
                  {alertInfo.level !== 'normal' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: C.accentDim, borderWidth: 1, borderColor: 'rgba(255,209,102,0.2)' }}>
                      <AlertTriangle size={8} color={C.accent} />
                      <Text style={{ color: C.accent, fontSize: 10, fontWeight: '900' }}>OVERDUE</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 10, fontWeight: alertInfo.fontWeight, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1, color: alertInfo.text }}>
                  {alertInfo.label}
                </Text>
                {debtor.phone && (
                  <Text style={{ color: C.text3, fontSize: 10, marginTop: 2 }}>Phone: {debtor.phone}</Text>
                )}
                {paymentActivity && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                    {paymentActivity.isRecent && <Check size={10} color={C.success} />}
                    <Text style={{ color: paymentActivity.isRecent ? C.success : C.text3, fontSize: 10, fontWeight: paymentActivity.isRecent ? '700' : '400' }}>
                      {paymentActivity.label}
                    </Text>
                  </View>
                )}
              </View>

              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.text1, fontSize: 16, fontWeight: '900' }}>
                  ₱{debtor.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </Text>
                <Text style={{ color: C.text3, fontSize: 10, textAlign: 'right' }}>outstanding</Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 5, marginTop: 12 }}>
              <TouchableOpacity
                onPress={() => openDebtEntry(debtor)}
                style={{ backgroundColor: C.surface2, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <PlusCircle size={14} color={C.success} />
                <Text style={{ color: C.text2, fontSize: 10, fontWeight: '700' }}>Add</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openSettleModal(debtor)}
                style={{ backgroundColor: C.surface2, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Coins size={14} color={C.accent} />
                <Text style={{ color: C.text2, fontSize: 10, fontWeight: '700' }}>Settle</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSendSMS(debtor)}
                accessibilityRole="button"
                accessibilityLabel={`Send payment reminder to ${debtor.name}`}
                hitSlop={10}
                style={{ backgroundColor: C.surface2, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border }}
              >
                <MessageSquare size={14} color="#6fa3d8" />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  const renderSettledDebtor = ({ item: debtor }: { item: Debtor }) => (
    <TouchableOpacity onPress={() => openDebtorDetails(debtor)} activeOpacity={0.85}>
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
            <Text style={{ color: getDebtorBalanceStatus(debtor.balance) === 'credit' ? C.accent : C.success, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {getDebtorBalanceStatus(debtor.balance) === 'credit' ? 'Customer Credit' : 'Settled / Paid Off'}
            </Text>
          </View>
          {debtor.phone && (
            <Text style={{ color: C.text3, fontSize: 10, marginTop: 2 }}>Phone: {debtor.phone}</Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: debtor.balance < -0.01 ? C.accent : C.text3, fontSize: 14, fontWeight: '700' }}>
              {getDebtorBalanceStatus(debtor.balance) === 'credit' ? `₱${Math.abs(debtor.balance).toFixed(2)} credit` : '₱0.00'}
            </Text>
            <Text style={{ color: C.text3, fontSize: 9, textTransform: 'uppercase', marginTop: 2 }}>View Ledger</Text>
          </View>
          <TouchableOpacity
            onPress={async (event) => {
              event.stopPropagation();
              handleDeleteCustomer(debtor);
            }}
            disabled={deleteCustomerMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${debtor.name}`}
            hitSlop={10}
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
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
        <SectionList<Debtor, { key: string; kind: 'active' | 'credit' | 'settled'; data: Debtor[] }>
          style={{ flex: 1, paddingHorizontal: 16 }}
          contentContainerStyle={{ paddingBottom: 88 }}
          sections={[
            { key: 'active', kind: 'active', data: activeDebtors },
            ...(creditDebtors.length > 0
              ? [{ key: 'credit', kind: 'credit' as const, data: creditDebtors }]
              : []),
            ...(settledDebtors.length > 0
              ? [{ key: 'settled', kind: 'settled' as const, data: showSettledList ? settledDebtors : [] }]
              : []),
          ]}
          keyExtractor={(debtor) => debtor.id.toString()}
          renderItem={({ item, section }) => section.kind === 'active'
            ? renderActiveDebtor({ item })
            : renderSettledDebtor({ item })}
          renderSectionHeader={({ section }) => section.kind === 'active' ? (
            <View style={{ backgroundColor: C.bg, paddingBottom: 12, position: 'relative', zIndex: sortMenuOpen ? 10 : 0, elevation: sortMenuOpen ? 10 : 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ flex: 1, color: C.text2, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '700' }}>
                  Active Debts ({activeDebtors.length}{activeQuickFilter !== 'all' ? ` of ${filteredDebtors.filter(d => getDebtorBalanceStatus(d.balance) === 'active').length}` : ''})
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Sort debtors: ${sortModeLabel}`}
                  accessibilityState={{ expanded: sortMenuOpen }}
                  onPress={() => setSortMenuOpen((open) => !open)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }}
                >
                  <Text style={{ color: C.text2, fontSize: 10, fontWeight: '700' }}>Sort: {sortModeLabel}</Text>
                  <ChevronDown size={12} color={C.accent} />
                </TouchableOpacity>
              </View>
              {sortMenuOpen && (
                <View style={{ position: 'absolute', top: 42, right: 0, width: 220, padding: 5, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, zIndex: 20, elevation: 20 }}>
                  {[
                    { key: 'recent_activity', label: 'Recent activity' },
                    { key: 'overdue', label: 'Oldest overdue' },
                    { key: 'largest', label: 'Largest balance' },
                    { key: 'recent_payment', label: 'Recent payment' },
                  ].map((option) => {
                    const isActive = sortMode === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isActive }}
                        onPress={() => {
                          setSortMode(option.key as typeof sortMode);
                          setSortMenuOpen(false);
                        }}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42, paddingHorizontal: 10, borderRadius: 9, backgroundColor: isActive ? C.accentDim : 'transparent' }}
                      >
                        <Text style={{ color: isActive ? C.accent : C.text1, fontSize: 12, fontWeight: '700' }}>{option.label}</Text>
                        {isActive && <Check size={15} color={C.accent} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 10, paddingRight: 8 }}>
                {[
                  { key: 'all', label: 'All active' },
                  { key: 'overdue', label: 'Overdue' },
                  { key: 'paid_recently', label: 'Paid in 7 days' },
                  { key: 'no_payment', label: 'No payment yet' },
                ].map((option) => {
                  const isActive = activeQuickFilter === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter active debts: ${option.label}`}
                      accessibilityState={{ selected: isActive }}
                      onPress={() => setActiveQuickFilter(option.key as typeof activeQuickFilter)}
                      style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: isActive ? C.accent : C.border, backgroundColor: isActive ? C.accentDim : C.surface }}
                    >
                      <Text style={{ color: isActive ? C.accent : C.text3, fontSize: 10, fontWeight: '700' }}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {isError ? (
                <LedgerErrorState compact title="Debtor records unavailable" description="Your debtor list could not be loaded." onRetry={() => { void refetch(); }} />
              ) : isLoading ? (
                <LedgerLoadingState label="Loading debtor records…" />
              ) : activeDebtors.length === 0 ? (
                <LedgerEmptyState
                  title={activeQuickFilter === 'all' && !searchQuery.trim() ? 'No active debts yet' : 'No matching debtors'}
                  description={activeQuickFilter === 'all' && !searchQuery.trim() ? 'New customers with an outstanding balance will appear here.' : 'Try another name or filter to find a debtor.'}
                  tone="accent"
                />
              ) : null}
            </View>
          ) : section.kind === 'credit' ? (
            <View style={{ backgroundColor: C.bg, paddingVertical: 12 }}>
              <Text style={{ color: C.accent, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }}>
                Customer Credit / Overpaid ({creditDebtors.length})
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setShowSettledList(!showSettledList)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderColor: C.border, marginTop: 8, marginBottom: 12, backgroundColor: C.bg }}
            >
              <Text style={{ color: C.text3, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }}>
                Settled Accounts & History ({settledDebtors.length})
              </Text>
              {showSettledList ? <ChevronUp size={16} color={C.text3} /> : <ChevronDown size={16} color={C.text3} />}
            </TouchableOpacity>
          )}
          ListHeaderComponent={(
            <>
              <View style={{ backgroundColor: C.surface, borderRadius: ledgerRadius.sheet, padding: ledgerSpacing.lg, borderWidth: 1, borderColor: C.border, marginTop: 12, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Total Outstanding Debt</Text>
                    <Text style={{ fontSize: 28, fontWeight: '900', color: C.accent, letterSpacing: -0.5 }}>
                      ₱{debtPortfolioSummary.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: C.accentDim, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,209,102,0.2)' }}>
                    <AlertTriangle size={24} color={C.accent} />
                  </View>
                </View>
                <View style={{ height: 1, backgroundColor: C.border, marginVertical: 16 }} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {[
                    { label: 'Earnings Paid', value: debtPortfolioSummary.earningsPaid, color: C.success },
                    { label: 'Pending Earnings', value: debtPortfolioSummary.pendingEarnings, color: C.warning },
                    { label: 'Principal Paid', value: debtPortfolioSummary.principalPaid, color: C.text1 },
                    { label: 'Principal Pending', value: debtPortfolioSummary.pendingPrincipal, color: C.accent },
                  ].map((metric) => (
                    <View key={metric.label} style={{ width: '47%' }}>
                      <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{metric.label}</Text>
                      <Text style={{ color: metric.color, fontSize: 14, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] }}>
                        ₱{metric.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 20 }}>
                <Search size={18} color={C.text3} style={{ marginRight: 8 }} />
                <TextInput
                  style={{ flex: 1, color: C.text1, fontSize: 14, minHeight: 24 }}
                  accessibilityLabel="Search debtors by name"
                  returnKeyType="search"
                  placeholder="Search debtors by name..."
                  placeholderTextColor={C.text3}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>
            </>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />

        {/* Debtor Profile Detail Modal */}
        <Modal
          animationType="slide"
          transparent={false}
          visible={detailModalVisible}
          onRequestClose={closeDebtorStatement}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: C.surface }} edges={['top', 'bottom']}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}>
            <View style={{ flex: 1, padding: 20, paddingBottom: 16 }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <View>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Debtor Statement</Text>
                  <Text style={{ color: C.text1, fontSize: 20, fontWeight: '800', marginTop: 2 }}>{selectedDebtor?.name}</Text>
                </View>
                <TouchableOpacity 
                  onPress={closeDebtorStatement} 
                accessibilityRole="button"
                accessibilityLabel="Close debtor statement"
                hitSlop={10}
                  style={{ padding: 8, backgroundColor: C.surface2, borderRadius: 20, borderWidth: 1, borderColor: C.border }}
                >
                  <X size={18} color={C.text2} />
                </TouchableOpacity>
              </View>

              {/* Total Balance Card */}
              {isDebtSelectionMode ? (
                <View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 12, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>Current Balance</Text>
                    <Text style={{ color: C.accent, fontSize: 20, fontWeight: '900', marginTop: 2, fontVariant: ['tabular-nums'] }}>
                      ₱{Math.abs(selectedDebtor?.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>Available</Text>
                    <Text style={{ color: C.text1, fontSize: 15, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] }}>
                      {selectableDebtEntries.length} unpaid debts
                    </Text>
                  </View>
                </View>
              ) : (
              <View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 20, padding: 16, marginBottom: 20 }}>
                <View>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>Current Balance</Text>
                  <Text style={{ color: selectedDebtor && getDebtorBalanceStatus(selectedDebtor.balance) !== 'settled' ? C.accent : C.success, fontSize: 24, fontWeight: '900', marginTop: 4 }}>
                    {selectedDebtor && getDebtorBalanceStatus(selectedDebtor.balance) === 'credit' ? 'Credit ' : ''}
                    ₱{Math.abs(selectedDebtor?.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                  <Text style={{ color: C.text3, fontSize: 10, marginTop: 6 }}>
                    Last payment: {selectedDebtor?.last_payment_date ? new Date(selectedDebtor.last_payment_date).toLocaleDateString() : 'No payment yet'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                  <View style={{ flexGrow: 1, minWidth: '46%', backgroundColor: C.successDim, borderWidth: 1, borderColor: 'rgba(90,155,110,0.2)', borderRadius: 12, padding: 10 }}>
                    <Text style={{ color: C.text3, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' }}>Earnings Paid</Text>
                    <Text style={{ color: C.success, fontSize: 13, fontWeight: '800', marginTop: 3 }}>₱{debtorStatementSummary.earningsPaid.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexGrow: 1, minWidth: '46%', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10 }}>
                    <Text style={{ color: C.text3, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' }}>Principal Paid</Text>
                    <Text style={{ color: C.text1, fontSize: 13, fontWeight: '800', marginTop: 3 }}>₱{debtorStatementSummary.principalPaid.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexGrow: 1, minWidth: '46%', backgroundColor: C.accentDim, borderWidth: 1, borderColor: 'rgba(255,209,102,0.2)', borderRadius: 12, padding: 10 }}>
                    <Text style={{ color: C.text3, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' }}>Pending Earnings</Text>
                    <Text style={{ color: C.accent, fontSize: 13, fontWeight: '800', marginTop: 3 }}>₱{debtorStatementSummary.pendingEarnings.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexGrow: 1, minWidth: '46%', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 10 }}>
                    <Text style={{ color: C.text3, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' }}>Pending Principal</Text>
                    <Text style={{ color: C.text1, fontSize: 13, fontWeight: '800', marginTop: 3 }}>₱{debtorStatementSummary.pendingPrincipal.toFixed(2)}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                  {selectedDebtor && selectedDebtor.balance > 0 ? (
                    <>
                      <TouchableOpacity
                        onPress={() => openDebtEntry(selectedDebtor)}
                        style={{ flex: 1, backgroundColor: C.surface2, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      >
                        <PlusCircle size={14} color={C.success} />
                        <Text style={{ color: C.text2, fontSize: 11, fontWeight: '700' }}>Add Debt</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => openSettleModal(selectedDebtor)}
                        style={{ flex: 1, backgroundColor: C.surface2, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      >
                        <Coins size={14} color={C.accent} />
                        <Text style={{ color: C.text2, fontSize: 11, fontWeight: '700' }}>Settle</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <View style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: selectedDebtor && getDebtorBalanceStatus(selectedDebtor.balance) === 'credit' ? C.accentDim : C.successDim, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(90,155,110,0.2)' }}>
                      <Text style={{ color: selectedDebtor && getDebtorBalanceStatus(selectedDebtor.balance) === 'credit' ? C.accent : C.success, fontWeight: '700', fontSize: 11 }}>
                        {selectedDebtor && getDebtorBalanceStatus(selectedDebtor.balance) === 'credit' ? 'CUSTOMER CREDIT' : 'ALL PAID'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              )}

              {/* Itemized Ledger */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Ledger History</Text>
                <TouchableOpacity
                  onPress={() => {
                    setIsDebtSelectionMode((enabled) => !enabled);
                    setSelectedDebtIds([]);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={isDebtSelectionMode ? 'Cancel debt selection' : 'Select debts to pay'}
                  style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: isDebtSelectionMode ? C.accent : C.border, backgroundColor: isDebtSelectionMode ? C.accentDim : C.surface2 }}
                >
                  <Text style={{ color: isDebtSelectionMode ? C.accent : C.text2, fontSize: 11, fontWeight: '800' }}>
                    {isDebtSelectionMode ? 'Cancel' : 'Select debts'}
                  </Text>
                </TouchableOpacity>
              </View>
              {isDebtSelectionMode && (
                <View style={{ borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, padding: 10, marginBottom: 12, gap: 8 }}>
                  <Text style={{ color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' }}>
                    Unpaid debts only
                  </Text>
                  <Text style={{ color: C.text3, fontSize: 11 }}>
                    Choose entries to settle. A partial payment is applied to the oldest selected debt first.
                  </Text>
                  {activeSelectedDebtIds.length > 0 && (
                    <TouchableOpacity
                      onPress={openBatchDebtPayment}
                      accessibilityRole="button"
                      accessibilityLabel={`Pay ${activeSelectedDebtIds.length} selected debts`}
                      style={{ minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.successDim, borderWidth: 1, borderColor: C.success }}
                    >
                      <Text style={{ color: C.success, fontSize: 12, fontWeight: '900' }}>
                        Pay {activeSelectedDebtIds.length} selected · ₱{getSettlementPrincipalCap().toFixed(2)}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              
              <FlatList
                data={isDebtSelectionMode ? selectableDebtEntries : debtorLedgerHistory}
                keyExtractor={(transaction) => transaction.id.toString()}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 20 }}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={isDebtorLedgerError ? (
                  <TouchableOpacity onPress={() => refetchDebtorLedger()} accessibilityRole="button" style={{ paddingVertical: 20 }}>
                    <Text style={{ color: C.danger, fontSize: 12, textAlign: 'center' }}>Could not load this ledger. Tap to retry.</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={{ color: C.text3, fontSize: 12, textAlign: 'center', paddingVertical: 20 }}>
                    {isDebtorLedgerLoading
                      ? 'Loading ledger history...'
                      : isDebtSelectionMode
                        ? 'No unpaid debt entries are available to select.'
                        : 'No transaction history for this customer.'}
                  </Text>
                )}
                renderItem={({ item: tx }) => {
                  const isPayment = tx.type === 'DEBT_PAYMENT';
                  const isSelectableDebt = tx.is_debt === 1 && (outstandingByDebtId.get(tx.id) || 0) > 0.01;
                  const isSelectedDebt = activeSelectedDebtIds.includes(tx.id);
                  const txTotal = isPayment ? tx.amount : (tx.amount + (tx.deduct_fee === 1 ? 0 : tx.fee));
                  const remainingDebtBalance = tx.is_debt === 1
                    ? outstandingByDebtId.get(tx.id) || 0
                    : null;
                  const isInterestOnlyPayment = isPayment && tx.amount === 0 && tx.fee > 0;
                  const formattedDate = tx.created_at
                    ? new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'N/A';

                  return (
                    <TouchableOpacity
                      disabled={!isDebtSelectionMode}
                      onPress={() => toggleDebtSelection(tx)}
                      accessibilityRole={isDebtSelectionMode ? 'checkbox' : undefined}
                      accessibilityState={isDebtSelectionMode ? { checked: isSelectedDebt } : undefined}
                      accessibilityLabel={isDebtSelectionMode
                        ? `${isSelectedDebt ? 'Deselect' : 'Select'} debt of ₱${(outstandingByDebtId.get(tx.id) || 0).toFixed(2)}`
                        : undefined}
                      activeOpacity={0.72}
                      style={{ backgroundColor: C.surface2, borderWidth: 1, borderColor: isSelectedDebt ? C.accent : C.border, borderRadius: 14, padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      {isDebtSelectionMode && isSelectableDebt && (
                        <View
                          style={{ width: 44, height: 44, marginRight: 4, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: isSelectedDebt ? C.accent : C.text3, backgroundColor: isSelectedDebt ? C.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                            {isSelectedDebt && <Check size={14} color={C.bg} strokeWidth={3} />}
                          </View>
                        </View>
                      )}
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: isPayment ? C.successDim : C.dangerDim, borderWidth: 1, borderColor: isPayment ? 'rgba(90,155,110,0.15)' : 'rgba(220,107,90,0.15)' }}>
                            <Text style={{ color: isPayment ? C.success : C.danger, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }}>{isInterestOnlyPayment ? 'Interest' : isPayment ? 'Payment' : 'Debt'}</Text>
                          </View>
                          <Text style={{ color: C.text1, fontSize: 12, fontWeight: '700' }}>{getTxTypeLabel(tx.type)}</Text>
                        </View>
                        <Text style={{ color: C.text3, fontSize: 9 }}>{formattedDate} • via {getWalletLabel(tx.channel)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: isPayment ? C.success : C.danger, fontSize: 13, fontWeight: '800' }}>{isPayment ? '-' : '+'}₱{txTotal.toFixed(2)}</Text>
                        {remainingDebtBalance !== null && (
                          <Text style={{ color: remainingDebtBalance > 0.01 ? C.accent : C.success, fontSize: 10, fontWeight: '700' }}>
                            {remainingDebtBalance > 0.01 ? `Remaining ₱${remainingDebtBalance.toFixed(2)}` : 'Fully paid'}
                          </Text>
                        )}
                        {isPayment && tx.fee > 0 && <Text style={{ color: C.accent, fontSize: 10 }}>Profit paid PHP {tx.fee.toFixed(2)}</Text>}
                        {!isPayment && tx.fee > 0 && <Text style={{ color: C.text3, fontSize: 10 }}>{tx.deduct_fee === 1 ? `Deducted ₱${tx.fee.toFixed(2)} fee` : `Inc. ₱${tx.fee.toFixed(2)} fee`}</Text>}
                        {!isDebtSelectionMode && (
                          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                            {tx.is_debt === 1 && (outstandingByDebtId.get(tx.id) || 0) > 0.01 && (
                              <TouchableOpacity
                                onPress={() => openSelectedDebtPayment(tx)}
                                accessibilityRole="button"
                                accessibilityLabel="Settle selected debt"
                                hitSlop={8}
                                style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}
                              >
                                <Coins size={14} color={C.success} />
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              onPress={() => openTransactionEditor(tx.id)}
                              accessibilityRole="button"
                              accessibilityLabel="Edit ledger transaction"
                              hitSlop={10}
                              style={{ padding: 6, backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border }}
                            >
                              <Pencil size={13} color={C.accent} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => handleDeleteLedgerTransaction(tx.id)}
                              disabled={deleteTransactionMutation.isPending}
                              accessibilityRole="button"
                              accessibilityLabel="Delete ledger transaction"
                              hitSlop={10}
                              style={{ padding: 6, backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border, opacity: deleteTransactionMutation.isPending ? 0.5 : 1 }}
                            >
                              <Trash2 size={13} color={C.text3} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
              {/* Previous eager ledger mapping retained only as a disabled reference while FlatList owns rendering. */}
              {/*
                  <View style={{ gap: 10 }}>
                    {debtorLedgerHistory.map((tx) => {
                      const isPayment = tx.type === 'DEBT_PAYMENT';
                      const txTotal = isPayment ? tx.amount : (tx.amount + (tx.deduct_fee === 1 ? 0 : tx.fee));
                      const isInterestOnlyPayment = isPayment && tx.amount === 0 && tx.fee > 0;
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
                                  {isInterestOnlyPayment ? 'Interest' : isPayment ? 'Payment' : 'Debt'}
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
                            {isPayment && tx.fee > 0 && (
                              <Text style={{ color: C.accent, fontSize: 8 }}>
                                Profit paid PHP {tx.fee.toFixed(2)}
                              </Text>
                            )}
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
              */}
            </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>

        {/* Custom Settle Debt Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={modalVisible}
          onRequestClose={() => setModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(8, 9, 15, 0.88)' }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 16 }}
            >
            <View style={{ backgroundColor: C.surface, borderRadius: 28, borderWidth: 1, borderColor: C.border, padding: 24, paddingBottom: 28 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <View>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Settle Ledger</Text>
                  <Text style={{ color: C.text1, fontSize: 18, fontWeight: '800', marginTop: 2 }}>
                    {activeSelectedDebtIds.length > 0
                      ? `Pay ${activeSelectedDebtIds.length} selected debts: ₱${getSettlementPrincipalCap().toFixed(2)}`
                      : selectedDebtEntry
                        ? `Pay selected debt: ₱${(outstandingByDebtId.get(selectedDebtEntry.id) || 0).toFixed(2)}`
                        : `Pay Debt: ${selectedDebtor?.name}`}
                  </Text>
                </View>
                <TouchableOpacity 
                  onPress={() => setModalVisible(false)} 
                  disabled={settleMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Close settlement form"
                  hitSlop={10}
                  style={{ padding: 8, backgroundColor: C.surface2, borderRadius: 20, borderWidth: 1, borderColor: C.border, opacity: settleMutation.isPending ? 0.5 : 1 }}
                >
                  <X size={18} color={C.text2} />
                </TouchableOpacity>
              </View>

              <Text style={{ color: C.text3, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Total received</Text>
              <TextInput
                accessibilityLabel="Settlement total received"
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
                  marginBottom: 10,
                }}
                keyboardType="decimal-pad"
                value={settleAmount}
                onChangeText={handleSettlementAmountChange}
                placeholder="0.00"
                placeholderTextColor={C.text3}
                editable={!settleMutation.isPending}
              />

              <Text style={{ color: C.text3, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Extra profit / interest</Text>
              <TextInput
                accessibilityLabel="Settlement extra profit"
                style={{
                  backgroundColor: C.bg,
                  borderWidth: 1,
                  borderColor: C.border,
                  color: C.accent,
                  borderRadius: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  fontWeight: '700',
                  fontSize: 16,
                  marginBottom: 16,
                }}
                keyboardType="decimal-pad"
                value={settleProfit}
                onChangeText={setSettleProfit}
                placeholder="0.00"
                placeholderTextColor={C.text3}
                editable={!settleMutation.isPending}
              />
              <Text style={{ color: C.text3, fontSize: 11, lineHeight: 17, marginTop: -8, marginBottom: 14 }}>
                Suggested automatically when the amount exceeds the selected outstanding principal. You can edit it or record profit only. Extra profit never reduces principal.
              </Text>

              <View style={{ backgroundColor: C.bg, borderRadius: ledgerRadius.card, borderWidth: 1, borderColor: C.border, padding: ledgerSpacing.md, marginBottom: ledgerSpacing.lg }}>
                <Text style={{ color: C.text2, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Payment breakdown preview</Text>
                {(() => {
                  const preview = splitSettlementReceived(Number(settleAmount) || 0, getSettlementPrincipalCap());
                  const profit = settleProfit.trim() === '' ? preview.suggestedProfit : Number(settleProfit);
                  return <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 }}>
                      <Text style={{ color: C.text3, fontSize: 12 }}>Principal applied</Text>
                      <Text style={{ color: C.text1, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>₱{preview.principal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 9 }}>
                      <Text style={{ color: C.text3, fontSize: 12 }}>Extra profit</Text>
                      <Text style={{ color: C.accent, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>₱{(Number.isFinite(profit) ? profit : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    </View>
                    <View style={{ height: 1, backgroundColor: C.border, marginBottom: 9 }} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: C.text2, fontSize: 12, fontWeight: '700' }}>Total received</Text>
                      <Text style={{ color: C.success, fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] }}>₱{(Number(settleAmount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    </View>
                  </>;
                })()}
              </View>
              <Text style={{ color: C.text3, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Deposit into wallet</Text>
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

              <GoldButton
                onPress={submitSettlement}
                disabled={settleMutation.isPending}
                loading={settleMutation.isPending}
                label={settleMutation.isPending ? 'Recording payment...' : 'Confirm Payment'}
                style={{ width: '100%' }}
              />
            </View>
            </ScrollView>
            {settlementNotice && (
              <View
                pointerEvents="box-none"
                style={{
                  position: 'absolute',
                  top: insets.top + 12,
                  left: 20,
                  right: 20,
                  zIndex: 10,
                  elevation: 10,
                }}
              >
                <ToastNotice
                  message={settlementNotice.message}
                  type={settlementNotice.type}
                  onDismiss={settlementNotice.type === 'error' ? () => setSettlementNotice(null) : undefined}
                />
              </View>
            )}
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
