import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, Modal, Switch, KeyboardAvoidingView, FlatList, ListRenderItem, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { getDebtOutstandingById, useDbQueries, Transaction, cleanErrorMessage } from '@/hooks/useDbQueries';
import { useToast } from '@/components/toast';
import { GoldButton } from '@/components/gold-button';
import * as Haptics from 'expo-haptics';
import { Search, X, Trash2, Pencil, Check, Coins, ChevronRight, ChevronDown, SlidersHorizontal } from 'lucide-react-native';
import { ledgerColors as C, ledgerRadius } from '@/theme/ledger';
import { getHistoryDateBounds, type HistoryDateRange } from '@/utils/history-date-range';
import { useScreenFocus } from '@/hooks/useScreenFocus';
import { getReceiptPaymentBreakdown } from '@/utils/transaction-receipt';
import { calculateDebtPaymentBreakdowns } from '@/utils/debt-payment-preview';

// ─── Obsidian & Gold Design ────────────────────────────────────────────────────
const clearZeroIfNeeded = (value: string, setter: (value: string) => void) => {
  if (/^0(\.0+)?$/.test(value.trim())) {
    setter('');
  }
};

type FilterType = 'ALL' | 'CASH_IN' | 'CASH_OUT' | 'E_LOAD' | 'TV_LOAD' | 'DEBT_PAYMENT';

const useDebouncedValue = (value: string, delay = 300) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);

  return debouncedValue;
};

const transactionDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const getTxTypeDetails = (type: Transaction['type']) => {
  switch (type) {
    case 'CASH_IN':
      return { label: 'Cash In', text: C.info, bg: C.infoDim, border: 'rgba(96,165,250,0.2)' };
    case 'CASH_OUT':
      return { label: 'Cash Out', text: C.success, bg: C.successDim, border: 'rgba(32,200,117,0.2)' };
    case 'E_LOAD':
      return { label: 'E-Load', text: C.accent, bg: C.accentDim, border: 'rgba(255,209,102,0.2)' };
    case 'TV_LOAD':
      return { label: 'TV Load', text: '#73b8c5', bg: C.infoDim, border: 'rgba(96,165,250,0.2)' };
    case 'DEBT_PAYMENT':
      return { label: 'Debt Pay', text: C.warning, bg: 'rgba(255,176,32,0.14)', border: 'rgba(255,176,32,0.2)' };
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

const TransactionCard = React.memo(function TransactionCard({
  transaction,
  compact,
  onViewDetails,
  onEdit,
  onDelete,
  onSettleDebt,
}: {
  transaction: Transaction;
  compact: boolean;
  onViewDetails: (transaction: Transaction) => void;
  onEdit: (transaction: Transaction) => void;
  onDelete: (id: number) => void;
  onSettleDebt: (transaction: Transaction) => void;
}) {
  const typeDetails = getTxTypeDetails(transaction.type);
  const formattedTime = transaction.created_at
    ? transactionDateFormatter.format(new Date(transaction.created_at))
    : 'N/A';

  return (
    <View
      style={{
        borderRadius: ledgerRadius.card,
        padding: compact ? 12 : 14,
        borderWidth: 1,
        borderColor: C.border,
        backgroundColor: C.surface,
        marginBottom: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        minWidth: 0,
      }}
    >
      <TouchableOpacity
        onPress={() => onViewDetails(transaction)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`View details for transaction ${transaction.id}`}
        accessibilityHint="Opens the transaction receipt"
        style={{
          flex: 1,
          minWidth: 0,
          marginRight: compact ? 8 : 12,
          flexDirection: compact ? 'column' : 'row',
          justifyContent: 'space-between',
          alignItems: compact ? 'stretch' : 'center',
        }}
      >
        <View style={{ flex: 1, minWidth: 0, marginRight: compact ? 0 : 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: compact ? 5 : 8, flexWrap: 'wrap' }}>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: typeDetails.bg, borderWidth: 1, borderColor: typeDetails.border }}>
              <Text style={{ fontSize: 10, fontWeight: '900', textTransform: 'uppercase', color: typeDetails.text }}>
                {typeDetails.label}
              </Text>
            </View>
            {transaction.is_debt === 1 && (
              <View style={{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: C.dangerDim, borderWidth: 1, borderColor: 'rgba(220,107,90,0.2)' }}>
                <Text style={{ fontSize: 10, fontWeight: '900', textTransform: 'uppercase', color: C.danger }}>
                  UTANG
                </Text>
              </View>
            )}
          </View>

          <Text style={{ color: C.text3, fontSize: 11, marginBottom: compact ? 5 : 7 }}>{formattedTime}</Text>
          <Text
            style={{ color: C.text1, fontSize: 14, fontWeight: '700', marginBottom: 4, flexShrink: 1 }}
            numberOfLines={compact ? 2 : 1}
          >
            {transaction.customer_name || 'Sari-Sari Anonymous'}
          </Text>

          <Text style={{ color: C.text3, fontSize: 11 }}>
            Wallet: <Text style={{ color: C.text2, fontWeight: '600' }}>{getWalletLabel(transaction.channel)}</Text>
          </Text>
        </View>

        {!compact && (
          <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 }}>
              <Text style={{ color: C.text1, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] }}>
                ₱{transaction.amount.toFixed(2)}
              </Text>
              <ChevronRight size={14} color={C.text3} />
            </View>
            {transaction.fee > 0 && (
              <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700', marginTop: 2, textAlign: 'right' }}>
                {transaction.type === 'DEBT_PAYMENT' ? 'Extra profit: ' : 'Fee: '}+₱{transaction.fee.toFixed(2)}
              </Text>
            )}
          </View>
        )}
      </TouchableOpacity>

      {compact ? (
        <View style={{ width: 118, flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 }}>
            <Text style={{ color: C.text1, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] }}>
              ₱{transaction.amount.toFixed(2)}
            </Text>
            <ChevronRight size={14} color={C.text3} />
          </View>
          {transaction.fee > 0 && (
            <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700', marginTop: 2, textAlign: 'right' }}>
              {transaction.type === 'DEBT_PAYMENT' ? 'Extra profit: ' : 'Fee: '}+₱{transaction.fee.toFixed(2)}
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
            {transaction.is_debt === 1 && transaction.customer_id != null && (
              <TouchableOpacity
                onPress={() => onSettleDebt(transaction)}
                accessibilityRole="button"
                accessibilityLabel="Settle selected debt"
                hitSlop={6}
                style={{ width: 32, height: 30, justifyContent: 'center', alignItems: 'center' }}
              >
                <Coins size={15} color={C.success} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => onEdit(transaction)}
              accessibilityRole="button"
              accessibilityLabel="Edit transaction"
              hitSlop={6}
              style={{ width: 32, height: 30, alignItems: 'center', justifyContent: 'center' }}
            >
              <Pencil size={15} color={C.accent} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onDelete(transaction.id)}
              accessibilityRole="button"
              accessibilityLabel="Delete transaction"
              hitSlop={6}
              style={{ width: 32, height: 30, alignItems: 'center', justifyContent: 'center' }}
            >
              <Trash2 size={15} color={C.text3} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
          {transaction.is_debt === 1 && transaction.customer_id != null && (
            <TouchableOpacity
              onPress={() => onSettleDebt(transaction)}
              accessibilityRole="button"
              accessibilityLabel="Settle selected debt"
              hitSlop={8}
              style={{ width: 44, height: 40, justifyContent: 'center', alignItems: 'center' }}
            >
              <Coins size={16} color={C.success} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => onEdit(transaction)}
            accessibilityRole="button"
            accessibilityLabel="Edit transaction"
            hitSlop={8}
            style={{ width: 44, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Pencil size={16} color={C.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDelete(transaction.id)}
            accessibilityRole="button"
            accessibilityLabel="Delete transaction"
            hitSlop={8}
            style={{ width: 44, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={16} color={C.text3} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});
export default function HistoryScreen() {
  const { showToast } = useToast();
  const isScreenFocused = useScreenFocus();
  const { width: viewportWidth } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && viewportWidth >= 1024;
  const router = useRouter();
  const { editTxId } = useLocalSearchParams<{ editTxId?: string }>();
  const { 
    useTransactionHistory,
    useTransactionById,
    useDebtTransactionsForCustomer,
    useDeleteTransaction, 
    useUpdateTransaction,
    useCustomers,
    useAddCustomer,
    useWallets
  } = useDbQueries();
  
  const { data: customers = [], refetch: refetchCustomers } = useCustomers(isScreenFocused);
  const { data: wallets = [] } = useWallets(isScreenFocused);
  
  const deleteTransactionMutation = useDeleteTransaction();
  const { mutate: deleteTransaction } = deleteTransactionMutation;
  const updateTransactionMutation = useUpdateTransaction();
  const addCustomerMutation = useAddCustomer();

  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery);
  const [selectedFilter, setSelectedFilter] = useState<FilterType>('ALL');
  const [selectedDateRange, setSelectedDateRange] = useState<HistoryDateRange>('ALL');
  const [selectedWallet, setSelectedWallet] = useState('ALL');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [draftFilter, setDraftFilter] = useState<FilterType>('ALL');
  const [draftDateRange, setDraftDateRange] = useState<HistoryDateRange>('ALL');
  const [draftWallet, setDraftWallet] = useState('ALL');
  const activeFilterCount = Number(selectedFilter !== 'ALL') +
    Number(selectedDateRange !== 'ALL') +
    Number(selectedWallet !== 'ALL');
  const dateBounds = getHistoryDateBounds(selectedDateRange);
  const historyQuery = useTransactionHistory({
    type: selectedFilter,
    search: debouncedSearchQuery,
    channel: selectedWallet,
    ...dateBounds,
  }, isScreenFocused);
  const historyTransactions = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.transactions) ?? [],
    [historyQuery.data]
  );
  const totalHistoryTransactions = historyQuery.data?.pages[0]?.total ?? 0;
  const requestedEditTxId = editTxId ? Number(editTxId) : undefined;
  const { data: requestedEditTx } = useTransactionById(requestedEditTxId, isScreenFocused);

  // Edit modal states
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const {
    data: detailDebtTransactions,
    isLoading: isDetailDebtLoading,
    isError: isDetailDebtError,
  } = useDebtTransactionsForCustomer(
    detailTx?.customer_id ?? null,
    isScreenFocused && detailTx?.type === 'DEBT_PAYMENT',
  );
  const detailOutstandingBalance = useMemo(() => {
    if (!detailTx || detailTx.type !== 'DEBT_PAYMENT' || !Array.isArray(detailDebtTransactions)) return null;
    const outstandingByDebtId = getDebtOutstandingById(detailDebtTransactions);
    return Array.from(outstandingByDebtId.values()).reduce((total, amount) => total + amount, 0);
  }, [detailTx, detailDebtTransactions]);
  const detailPaymentBreakdown = useMemo(() => {
    if (!detailTx || detailTx.type !== 'DEBT_PAYMENT' || !Array.isArray(detailDebtTransactions)) return null;
    return calculateDebtPaymentBreakdowns(detailDebtTransactions).get(detailTx.id) || null;
  }, [detailTx, detailDebtTransactions]);
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

  const handleDelete = useCallback((id: number) => {
    if (process.env.EXPO_OS === 'web') {
      const confirmDelete = window.confirm("Are you sure you want to revert this transaction? This will automatically restore the original wallet balances.");
      if (confirmDelete) {
        deleteTransaction(id, {
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
          onPress: () => deleteTransaction(id, {
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
  }, [deleteTransaction, showToast]);

  const handleOpenEditModal = useCallback((tx: Transaction) => {
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
  }, []);

  const handleOpenTransactionDetails = useCallback((tx: Transaction) => {
    setDetailTx(tx);
  }, []);

  const handleEditFromDetails = useCallback(() => {
    if (!detailTx) return;
    setDetailTx(null);
    handleOpenEditModal(detailTx);
  }, [detailTx, handleOpenEditModal]);

  useEffect(() => {
    if (editTxId && requestedEditTx) {
      const tx = requestedEditTx;
      if (tx) {
        setTimeout(() => {
          handleOpenEditModal(tx);
        }, 0);
        // Clear params to avoid multiple triggers on updates
        router.setParams({ editTxId: undefined });
      }
    }
  }, [editTxId, requestedEditTx, router, handleOpenEditModal]);

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

    if (isNaN(parsedFee) || parsedFee < 0) {
      Alert.alert("Input Error", "Please enter a valid non-negative fee.");
      return;
    }
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      Alert.alert("Input Error", "Please enter a valid non-negative amount.");
      return;
    }
    if (selectedTx.type === 'DEBT_PAYMENT') {
      if (parsedAmount === 0 && parsedFee <= 0) {
        Alert.alert("Input Error", "Enter a principal payment or an extra profit/interest payment.");
        return;
      }
    } else if (parsedAmount <= 0) {
      Alert.alert("Input Error", "Please enter a valid amount greater than 0.");
      return;
    }

    try {
      setIsSaving(true);
      if (process.env.EXPO_OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      let finalCustomerId = selectedCustomerId;

      if (selectedTx.type === 'DEBT_PAYMENT') {
        finalCustomerId = selectedTx.customer_id ?? selectedCustomerId;
        if (!finalCustomerId) {
          Alert.alert("Input Error", "This debt payment is missing a debtor record and cannot be edited safely.");
          setIsSaving(false);
          return;
        }
      } else if (editIsDebt) {
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
      showToast("Transaction updated successfully.", "success");
    } catch (e: any) {
      Alert.alert("Error", cleanErrorMessage(e));
    } finally {
      setIsSaving(false);
    }
  };

  const renderTransaction = useCallback<ListRenderItem<Transaction>>(
    ({ item }) => <TransactionCard transaction={item} compact={!isDesktopWeb} onViewDetails={handleOpenTransactionDetails} onEdit={handleOpenEditModal} onDelete={handleDelete} onSettleDebt={(transaction) => router.push({ pathname: '/debtors', params: { settleDebtId: transaction.id.toString() } })} />,
    [handleDelete, handleOpenEditModal, handleOpenTransactionDetails, isDesktopWeb, router]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      {/* Filters and List */}
      <View style={{ flex: 1, width: '100%', maxWidth: isDesktopWeb ? 1320 : undefined, alignSelf: 'center', paddingHorizontal: isDesktopWeb ? 32 : 16, paddingTop: isDesktopWeb ? 28 : 16 }}>
        
        {/* Search Box */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 }}>
          <Search size={18} color={C.text3} />
          <TextInput
            accessibilityLabel="Search transaction history"
            accessibilityHint="Search customer names, wallets, or amounts"
            style={{ flex: 1, color: C.text1, marginLeft: 8, fontSize: 14 }}
            placeholder="Search by customer, wallet, amount..."
            placeholderTextColor={C.text3}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Clear transaction search" hitSlop={10}>
              <X size={16} color={C.text3} />
            </TouchableOpacity>
          )}
        </View>

        <View style={{ position: 'relative', alignItems: 'flex-end', zIndex: filterMenuOpen ? 20 : 0, elevation: filterMenuOpen ? 20 : 0, marginBottom: 12 }}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={activeFilterCount ? `${activeFilterCount} history filters applied` : 'Filter transaction history'}
            accessibilityState={{ expanded: filterMenuOpen }}
            onPress={() => {
              if (!filterMenuOpen) {
                setDraftFilter(selectedFilter);
                setDraftDateRange(selectedDateRange);
                setDraftWallet(selectedWallet);
              }
              setFilterMenuOpen((open) => !open);
            }}
            style={{
              minHeight: 38,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              paddingHorizontal: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: filterMenuOpen || activeFilterCount ? C.accent : C.border,
              backgroundColor: filterMenuOpen || activeFilterCount ? C.accentDim : C.surface,
            }}
          >
            <SlidersHorizontal size={14} color={filterMenuOpen || activeFilterCount ? C.accent : C.text2} />
            <Text style={{ color: filterMenuOpen || activeFilterCount ? C.accent : C.text2, fontSize: 11, fontWeight: '700' }}>
              Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
            </Text>
            <ChevronDown size={13} color={filterMenuOpen || activeFilterCount ? C.accent : C.text2} />
          </TouchableOpacity>
          {filterMenuOpen && (
            <View style={{
              position: 'absolute',
              top: 44,
              right: 0,
              width: 320,
              maxWidth: '100%',
              padding: 12,
              gap: 10,
              borderRadius: 14,
              backgroundColor: C.surface,
              borderWidth: 1,
              borderColor: C.border,
              zIndex: 30,
              elevation: 30,
            }}>
              {([
                {
                  title: 'Type',
                  value: draftFilter,
                  setValue: (value: string) => setDraftFilter(value as FilterType),
                  options: [
                    { key: 'ALL', label: 'All' },
                    { key: 'CASH_IN', label: 'Cash In' },
                    { key: 'CASH_OUT', label: 'Cash Out' },
                    { key: 'E_LOAD', label: 'E-Load' },
                    { key: 'TV_LOAD', label: 'TV Load' },
                    { key: 'DEBT_PAYMENT', label: 'Debt Pay' },
                  ],
                },
                {
                  title: 'Date',
                  value: draftDateRange,
                  setValue: (value: string) => setDraftDateRange(value as HistoryDateRange),
                  options: [
                    { key: 'ALL', label: 'All time' },
                    { key: 'TODAY', label: 'Today' },
                    { key: '7D', label: '7 days' },
                    { key: '30D', label: '30 days' },
                  ],
                },
                {
                  title: 'Wallet',
                  value: draftWallet,
                  setValue: setDraftWallet,
                  options: [
                    { key: 'ALL', label: 'All wallets' },
                    ...wallets.map((wallet: { channel: string }) => ({
                      key: wallet.channel,
                      label: getWalletLabel(wallet.channel),
                    })),
                  ],
                },
              ] as const).map((group) => (
                <View key={group.title} style={{ gap: 6 }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' }}>
                    {group.title}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {group.options.map((option) => {
                      const isActive = group.value === option.key;
                      return (
                        <TouchableOpacity
                          key={option.key}
                          accessibilityRole="button"
                          accessibilityLabel={`${group.title}: ${option.label}`}
                          accessibilityState={{ selected: isActive }}
                          onPress={() => group.setValue(option.key)}
                          style={{
                            minHeight: 32,
                            justifyContent: 'center',
                            paddingHorizontal: 9,
                            borderRadius: 9,
                            borderWidth: 1,
                            borderColor: isActive ? C.accent : C.border,
                            backgroundColor: isActive ? C.accentDim : C.bg,
                          }}
                        >
                          <Text style={{ color: isActive ? C.accent : C.text2, fontSize: 10, fontWeight: '700' }}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 2 }}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Clear history filters"
                  onPress={() => {
                    setDraftFilter('ALL');
                    setDraftDateRange('ALL');
                    setDraftWallet('ALL');
                  }}
                  style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 8 }}
                >
                  <Text style={{ color: C.text3, fontSize: 11, fontWeight: '700' }}>Clear all</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Apply history filters"
                  onPress={() => {
                    setSelectedFilter(draftFilter);
                    setSelectedDateRange(draftDateRange);
                    setSelectedWallet(draftWallet);
                    setFilterMenuOpen(false);
                  }}
                  style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.accent }}
                >
                  <Text style={{ color: C.bg, fontSize: 11, fontWeight: '800' }}>Apply filters</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <Text style={{ color: C.text3, fontSize: 11, fontWeight: '600', marginBottom: 10 }}>
          Showing {historyTransactions.length} of {totalHistoryTransactions} transactions
        </Text>

        {/* List Content */}
        {historyQuery.isLoading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: C.text3, fontSize: 13 }}>Loading transaction records...</Text>
          </View>
        ) : historyQuery.isError && !historyQuery.data ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ color: C.danger, fontSize: 14, fontWeight: '700', textAlign: 'center' }}>Could not load transaction history.</Text>
            <TouchableOpacity onPress={() => historyQuery.refetch()} accessibilityRole="button" accessibilityLabel="Retry loading transaction history" style={{ marginTop: 14, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: C.accent }}>
              <Text style={{ color: C.bg, fontWeight: '800' }}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={historyTransactions}
            renderItem={renderTransaction}
            keyExtractor={(transaction) => transaction.id.toString()}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            onEndReached={() => {
              if (historyQuery.hasNextPage && !historyQuery.isFetchingNextPage) {
                historyQuery.fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.4}
            style={{ flex: 1 }} 
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 88 }}
            ListEmptyComponent={
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ color: C.text2, fontSize: 14, fontWeight: '700', marginBottom: 4 }}>No transaction records found</Text>
                <Text style={{ color: C.text3, fontSize: 12, textAlign: 'center', paddingHorizontal: 32 }}>Try adjusting your filters or search terms</Text>
              </View>
            }
            ListFooterComponent={
              historyQuery.isFetchingNextPage ? (
                <Text style={{ color: C.text3, fontSize: 12, textAlign: 'center', paddingVertical: 16 }}>Loading more transactions...</Text>
              ) : historyQuery.isFetchNextPageError ? (
                <TouchableOpacity onPress={() => historyQuery.fetchNextPage()} accessibilityRole="button" accessibilityLabel="Retry loading more transactions" style={{ paddingVertical: 16 }}>
                  <Text style={{ color: C.danger, fontSize: 12, textAlign: 'center' }}>Could not load more transactions. Tap to retry.</Text>
                </TouchableOpacity>
              ) : historyTransactions.length > 0 && !historyQuery.hasNextPage ? (
                <Text style={{ color: C.text3, fontSize: 11, textAlign: 'center', paddingVertical: 16 }}>All transactions loaded</Text>
              ) : null
            }
          >
            {/* Previous eager mapping retained only as a disabled reference while the FlatList owns rendering. */}
            {/*
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
            */}
          </FlatList>
        )}
      </View>

      <Modal
        animationType="slide"
        transparent={false}
        visible={detailTx !== null}
        onRequestClose={() => setDetailTx(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: C.surface }} edges={['top', 'bottom']}>
          {detailTx && (() => {
            const typeDetails = getTxTypeDetails(detailTx.type);
            const isDebtPayment = detailTx.type === 'DEBT_PAYMENT';
            const formattedDate = detailTx.created_at
              ? new Intl.DateTimeFormat('en-PH', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(detailTx.created_at))
              : 'N/A';
            const { debtApplied, extraProfit, totalReceived } = getReceiptPaymentBreakdown(detailTx);

            const ReceiptRow = ({ label, value, valueColor = C.text1 }: { label: string; value: string; valueColor?: string }) => (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 9 }}>
                <Text style={{ color: C.text3, fontSize: 12, flex: 1 }}>{label}</Text>
                <Text style={{ color: valueColor, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right' }}>{value}</Text>
              </View>
            );

            return (
              <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text3, fontSize: 10, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase' }}>Transaction receipt</Text>
                    <Text style={{ color: C.text1, fontSize: 21, fontWeight: '900', marginTop: 3 }}>Record #{detailTx.id}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setDetailTx(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Close transaction details"
                    hitSlop={10}
                    style={{ width: 44, height: 44, backgroundColor: C.surface2, borderRadius: 22, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={18} color={C.text2} />
                  </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
                  <View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 22, padding: 20, marginBottom: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                      <View style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: typeDetails.bg, borderWidth: 1, borderColor: typeDetails.border }}>
                        <Text style={{ color: typeDetails.text, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.6 }}>{typeDetails.label}</Text>
                      </View>
                      {detailTx.is_debt === 1 && (
                        <Text style={{ color: C.danger, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }}>CREDIT / UTANG</Text>
                      )}
                    </View>
                    <Text style={{ color: C.text3, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                      {isDebtPayment ? 'Total payment received' : 'Transaction amount'}
                    </Text>
                    <Text style={{ color: C.accent, fontSize: 34, fontWeight: '900', marginTop: 5, fontVariant: ['tabular-nums'] }}>
                      ₱{(isDebtPayment ? totalReceived : debtApplied).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                    <Text style={{ color: C.text3, fontSize: 11, marginTop: 8 }}>{formattedDate}</Text>
                    {isDebtPayment && (
                      <View style={{ marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border }}>
                        <Text style={{ color: C.text2, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>Payment breakdown</Text>
                        {detailPaymentBreakdown ? (
                          <>
                            <ReceiptRow label="Initial fee collected first" value={`₱${detailPaymentBreakdown.contractualFeePaid.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} valueColor={C.success} />
                            <ReceiptRow label="Principal repaid" value={`₱${detailPaymentBreakdown.principalPaid.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                            <ReceiptRow label="Extra profit / interest" value={`₱${detailPaymentBreakdown.extraProfitPaid.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} valueColor={C.accent} />
                          </>
                        ) : (
                          <>
                            <ReceiptRow label="Debt amount applied (fee first)" value={`₱${debtApplied.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                            <ReceiptRow label="Extra profit / interest" value={`₱${extraProfit.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} valueColor={C.accent} />
                          </>
                        )}
                        <View style={{ borderTopWidth: 1, borderTopColor: C.border, marginTop: 4, paddingTop: 4 }}>
                          <ReceiptRow label="Total received" value={`₱${totalReceived.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} valueColor={C.text1} />
                        </View>
                      </View>
                    )}
                    {!isDebtPayment && detailTx.fee > 0 && (
                      <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700', marginTop: 8 }}>
                        Service fee: ₱{detailTx.fee.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    )}
                  </View>

                  <View style={{ backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 18, paddingHorizontal: 16, marginBottom: 14 }}>
                    <Text style={{ color: C.text2, fontSize: 11, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase', paddingTop: 15, paddingBottom: 3 }}>Transaction information</Text>
                    <ReceiptRow label="Customer" value={detailTx.customer_name || 'Sari-Sari Anonymous'} />
                    <View style={{ height: 1, backgroundColor: C.border }} />
                    <ReceiptRow label="Wallet" value={getWalletLabel(detailTx.channel)} />
                    <View style={{ height: 1, backgroundColor: C.border }} />
                    <ReceiptRow label="Record ID" value={`#${detailTx.id}`} />
                    {!isDebtPayment && (
                      <>
                        <View style={{ height: 1, backgroundColor: C.border }} />
                        <ReceiptRow label="Fee handling" value={detailTx.deduct_fee === 1 ? 'Deducted from amount' : 'Charged separately'} />
                      </>
                    )}
                    {isDebtPayment && (
                      <>
                        <View style={{ height: 1, backgroundColor: C.border }} />
                        <View style={{ paddingVertical: 10 }}>
                          <Text style={{ color: C.text3, fontSize: 11 }}>Remaining debtor balance</Text>
                          {isDetailDebtLoading ? (
                            <Text style={{ color: C.text2, fontSize: 13, fontWeight: '700', marginTop: 5 }}>Loading balance…</Text>
                          ) : isDetailDebtError || detailOutstandingBalance == null ? (
                            <Text style={{ color: C.text3, fontSize: 13, fontWeight: '700', marginTop: 5 }}>Unavailable</Text>
                          ) : (
                            <Text style={{ color: C.accent, fontSize: 20, fontWeight: '900', marginTop: 4, fontVariant: ['tabular-nums'] }}>
                              ₱{detailOutstandingBalance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Text>
                          )}
                          <Text style={{ color: C.text3, fontSize: 10, marginTop: 4 }}>Current outstanding balance across this debtor’s open debts</Text>
                        </View>
                      </>
                    )}
                  </View>
                </ScrollView>

                <TouchableOpacity
                  onPress={handleEditFromDetails}
                  accessibilityRole="button"
                  accessibilityLabel="Edit this transaction"
                  style={{ minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: C.accent, backgroundColor: C.accentDim, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}
                >
                  <Text style={{ color: C.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.9, textTransform: 'uppercase' }}>Edit transaction</Text>
                </TouchableOpacity>
              </View>
            );
          })()}
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={editModalVisible}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior='padding'
          style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(8, 9, 15, 0.88)' }}
        >
          <View style={{ backgroundColor: C.surface, borderRadius: 28, borderWidth: 1, borderColor: C.border, padding: 24, paddingBottom: 28 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <View>
                <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Log Correction</Text>
                <Text style={{ color: C.text1, fontSize: 18, fontWeight: '800', marginTop: 2 }}>Edit Record #{selectedTx?.id}</Text>
              </View>
              <TouchableOpacity 
                onPress={() => setEditModalVisible(false)} 
                accessibilityRole="button"
                accessibilityLabel="Close transaction editor"
                hitSlop={10}
                style={{ padding: 8, backgroundColor: C.surface2, borderRadius: 20, borderWidth: 1, borderColor: C.border }}
              >
                <X size={18} color={C.text2} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ gap: 16 }}>
              {/* Amount and Fee Row */}
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text3, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>{selectedTx?.type === 'DEBT_PAYMENT' ? 'Debt Amount Applied (PHP)' : 'Amount (PHP)'}</Text>
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
                    onFocus={() => clearZeroIfNeeded(editAmount, setEditAmount)}
                    onChangeText={setEditAmount}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text3, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>{selectedTx?.type === 'DEBT_PAYMENT' ? 'Extra Profit / Interest (PHP)' : 'Fee (PHP)'}</Text>
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
                    onFocus={() => clearZeroIfNeeded(editFee, setEditFee)}
                    onChangeText={setEditFee}
                  />
                </View>
              </View>

              {/* Destination Channel Selector */}
              {selectedTx?.type !== 'DEBT_PAYMENT' && (
                <View>
                  <Text style={{ color: C.text3, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Wallet Channel</Text>
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
                  <Text style={{ color: C.text3, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Debtor Name</Text>
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
              <GoldButton
                onPress={handleSaveChanges}
                disabled={isSaving}
                label={isSaving ? 'Saving...' : 'Save Log Corrections'}
                leadingIcon={<Check size={18} color="#17140d" />}
                style={{ width: '100%', marginTop: 10 }}
              />

            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
