import { useToast } from '@/components/toast';
import { cleanErrorMessage, useDbQueries } from '@/hooks/useDbQueries';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import {
  Check,
  ChevronRight,
  Coins,
  Database,
  Settings,
  Share2,
  Trash2,
  TrendingUp,
  X
} from 'lucide-react-native';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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

export default function DataScreen() {
  const { showToast } = useToast();
  const {
    useDashboardData,
    useUpdateWalletBalance,
    useResetDatabase,
    useSettings,
    useUpdateSettings,
    useExportData,
    useAddWallet,
    useDeleteWallet,
  } = useDbQueries();
  const { data: dashboardData, refetch: refetchDashboard } = useDashboardData();
  const { data: settings } = useSettings();
  const { refetch: refetchExportData } = useExportData();
  const updateWalletMutation = useUpdateWalletBalance();
  const addWalletMutation = useAddWallet();
  const deleteWalletMutation = useDeleteWallet();
  const resetDbMutation = useResetDatabase();
  const updateSettingsMutation = useUpdateSettings();

  const handleDeleteWallet = (channel: string) => {
    const label = getWalletLabel(channel);
    Alert.alert(
      "Delete Custom Wallet",
      `Are you sure you want to permanently delete the custom wallet "${label}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Wallet",
          style: "destructive",
          onPress: async () => {
            if (process.env.EXPO_OS !== 'web') {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            try {
              await deleteWalletMutation.mutateAsync(channel);
              refetchDashboard();
              showToast(`Custom wallet "${label}" was successfully removed.`, 'info');
            } catch (err: any) {
              Alert.alert("Error", cleanErrorMessage(err));
            }
          }
        }
      ]
    );
  };

  const [selectedWallet, setSelectedWallet] = useState<{ channel: string; balance: number } | null>(null);
  const [newBalance, setNewBalance] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // New wallet creations states
  const [addWalletModalVisible, setAddWalletModalVisible] = useState(false);
  const [newWalletName, setNewWalletName] = useState('');
  const [newWalletBalance, setNewWalletBalance] = useState('');

  const [cashStep, setCashStep] = useState('500');
  const [cashFee, setCashFee] = useState('10');
  const [eloadThreshold, setEloadThreshold] = useState('99');
  const [eloadFeeLow, setEloadFeeLow] = useState('5');
  const [eloadFeeHigh, setEloadFeeHigh] = useState('10');
  const [tvloadFee, setTvloadFee] = useState('15');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const handleAddWallet = async () => {
    const name = newWalletName.trim();
    const balance = parseFloat(newWalletBalance) || 0;
    if (!name) {
      Alert.alert("Input Error", "Please enter a valid wallet or bank name.");
      return;
    }
    if (isNaN(balance) || balance < 0) {
      Alert.alert("Input Error", "Please enter a valid initial balance.");
      return;
    }

    try {
      if (process.env.EXPO_OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await addWalletMutation.mutateAsync({ channel: name, balance });
      setAddWalletModalVisible(false);
      setNewWalletName('');
      setNewWalletBalance('');
      refetchDashboard();
      showToast(`Wallet "${name}" was successfully registered.`, 'success');
    } catch (e: any) {
      Alert.alert("Error", cleanErrorMessage(e));
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (settings) {
      setCashStep(settings.cash_step_amount || '500');
      setCashFee(settings.cash_fee_per_step || '10');
      setEloadThreshold(settings.eload_threshold || '99');
      setEloadFeeLow(settings.eload_fee_low || '5');
      setEloadFeeHigh(settings.eload_fee_high || '10');
      setTvloadFee(settings.tvload_fee || '15');
    }
  }, [settings]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSaveSettings = async () => {
    if (isSavingSettings) return;
    const cStep = parseFloat(cashStep);
    const cFee = parseFloat(cashFee);
    const eThresh = parseFloat(eloadThreshold);
    const eLow = parseFloat(eloadFeeLow);
    const eHigh = parseFloat(eloadFeeHigh);
    const tFee = parseFloat(tvloadFee);

    if (
      isNaN(cStep) || cStep <= 0 ||
      isNaN(cFee) || cFee < 0 ||
      isNaN(eThresh) || eThresh <= 0 ||
      isNaN(eLow) || eLow < 0 ||
      isNaN(eHigh) || eHigh < 0 ||
      isNaN(tFee) || tFee < 0
    ) {
      Alert.alert("Invalid Input", "All configuration values must be valid non-negative numbers, and threshold/step sizes must be greater than zero.");
      return;
    }

    try {
      setIsSavingSettings(true);
      if (process.env.EXPO_OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await updateSettingsMutation.mutateAsync({
        cash_step_amount: cashStep,
        cash_fee_per_step: cashFee,
        eload_threshold: eloadThreshold,
        eload_fee_low: eloadFeeLow,
        eload_fee_high: eloadFeeHigh,
        tvload_fee: tvloadFee,
      });
      showToast("Fee rules updated successfully!", "success");
    } catch (err: any) {
      Alert.alert("Error", cleanErrorMessage(err));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const getWalletLabel = (channel: string) => {
    const upper = channel.toUpperCase();
    const defaultNames: Record<string, string> = {
      GCASH: 'GCash Float',
      MAYA: 'Maya Float',
      MAYA_BUSINESS: 'Maya Business Float',
      MARIBANK: 'MariBank Float',
      PHYSICAL_CASH: 'Physical Cash Box',
    };
    if (defaultNames[upper]) return defaultNames[upper];
    return (channel.length <= 4 ? channel.toUpperCase() : (channel.charAt(0).toUpperCase() + channel.slice(1))) + ' Float';
  };

  const getWalletAccentColor = (channel: string) => {
    const upper = channel.toUpperCase();
    const defaultAccents: Record<string, string> = {
      GCASH: '#2b5cbf',
      MAYA: '#22c55e',
      MAYA_BUSINESS: '#eab308',
      MARIBANK: '#06b6d4',
      PHYSICAL_CASH: '#d97706',
    };
    if (defaultAccents[upper]) return defaultAccents[upper];

    const customPalette = [
      '#a855f7', // Violet
      '#ef4444', // Crimson/Red
      '#06b6d4', // Cyan
      '#ec4899', // Pink
      '#6366f1', // Indigo
      '#f97316', // Orange-Red
      '#14b8a6', // Teal-Mint
      '#10b981', // Emerald
      '#84cc16', // Lime
      '#c026d3', // Magenta
    ];

    let hash = 0;
    for (let i = 0; i < upper.length; i++) {
      hash = upper.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % customPalette.length;
    return customPalette[idx];
  };

  const handleOpenEditModal = (wallet: { channel: string; balance: number }) => {
    setSelectedWallet(wallet);
    setNewBalance(wallet.balance.toString());
    setEditModalVisible(true);
  };

  const handleSaveBalance = async () => {
    if (!selectedWallet || updateWalletMutation.isPending) return;
    const val = parseFloat(newBalance);
    if (isNaN(val) || val < 0) {
      Alert.alert("Input Error", "Please enter a valid non-negative float balance.");
      return;
    }

    try {
      if (process.env.EXPO_OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await updateWalletMutation.mutateAsync({
        channel: selectedWallet.channel,
        balance: val,
      });
      const lbl = getWalletLabel(selectedWallet.channel);
      setEditModalVisible(false);
      setSelectedWallet(null);
      refetchDashboard();
      showToast(`Float balance for "${lbl}" overridden.`, 'success');
    } catch (e: any) {
      Alert.alert("Error", cleanErrorMessage(e));
    }
  };

  const handleExportCSV = async () => {
    if (isExporting) return;
    try {
      setIsExporting(true);
      if (process.env.EXPO_OS !== 'web') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      const result = await refetchExportData();
      const exportData = result.data;
      if (!exportData) {
        Alert.alert("Export Failed", "Could not retrieve data for export.");
        return;
      }

      const { transactions, expenses } = exportData;

      let csvString = "Date,Log Type,Description/Method,Principal Amount,Fee Charged,Total Affect,Wallet Source,Debtor/Customer\n";

      for (const tx of transactions) {
        const total = tx.amount + tx.fee;
        const debtorName = tx.customer_name || '';
        const dateFormatted = new Date(tx.created_at).toISOString();
        csvString += `"${dateFormatted}","${tx.type}","Transaction",${tx.amount},${tx.fee},${total},"${tx.channel}","${debtorName}"\n`;
      }

      for (const exp of expenses) {
        const dateFormatted = new Date(exp.created_at).toISOString();
        csvString += `"${dateFormatted}","EXPENSE","${exp.description}",${exp.amount},0,${-exp.amount},"${exp.channel}",""\n`;
      }

      const filename = `shop_ledger_export_${new Date().toISOString().split('T')[0]}.csv`;

      if (process.env.EXPO_OS === 'web') {
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const fileUri = FileSystem.documentDirectory + filename;
        await FileSystem.writeAsStringAsync(fileUri, csvString, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          await Sharing.shareAsync(fileUri);
        } else {
          Alert.alert("Saved Locally", `CSV exported to:\n${fileUri}`);
        }
      }
    } catch (e: any) {
      Alert.alert("Export Failed", e.message || "An error occurred during CSV export.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleResetDatabase = () => {
    Alert.alert(
      "☢️ SYSTEM DATABASE RESET",
      "WARNING: This will permanently delete ALL transactions, customer debt records, and expenses. Wallet floats will be reset to ₱0.00. This CANNOT be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Reset Everything",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "CONFIRM ACTION",
              "Are you ABSOLUTELY sure? Type reset on prompt? (Tapping OK resets everything)",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Reset DB",
                  style: "destructive",
                  onPress: async () => {
                    if (process.env.EXPO_OS !== 'web') {
                      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    }
                    try {
                      await resetDbMutation.mutateAsync();
                      refetchDashboard();
                      showToast("Database ledger has been reset successfully.", "info");
                    } catch (err: any) {
                      Alert.alert("Error", cleanErrorMessage(err));
                    }
                  }
                }
              ]
            );
          }
        }
      ]
    );
  };



  const CARD_STYLE = {
    backgroundColor: C.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
  };

  if (!dashboardData) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 130 }}
      >
        {/* Header */}
        <View style={{ marginTop: 24, marginBottom: 20 }}>
          <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>Shop Manager</Text>
          <Text style={{ color: C.text1, fontSize: 26, fontWeight: '800', marginTop: 4 }}>Control Center</Text>
        </View>

        {/* Database Stats Card */}
        <View style={CARD_STYLE}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: C.border, paddingBottom: 14 }}>
            <Database size={18} color={C.accent} />
            <Text style={{ color: C.text1, fontSize: 14, fontWeight: '700' }}>Diagnostic Ledger Monitor</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 16 }}>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Ledger Records</Text>
              <Text style={{ color: C.text1, fontSize: 16, fontWeight: '900' }}>{dashboardData.recentTransactions.length}</Text>
            </View>
            <View style={{ alignItems: 'center', flex: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border }}>
              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Linked Float</Text>
              <Text style={{ color: C.text1, fontSize: 16, fontWeight: '900' }}>{dashboardData.wallets.length} accounts</Text>
            </View>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Core System</Text>
              <Text style={{ color: C.success, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' }}>SQLite Core</Text>
            </View>
          </View>
        </View>

        {/* Float Control Panel */}
        <View style={CARD_STYLE}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Coins size={18} color={C.accent} />
              <Text style={{ color: C.text1, fontSize: 14, fontWeight: '700' }}>Float Balances</Text>
            </View>
            <TouchableOpacity
              onPress={() => setAddWalletModalVisible(true)}
              style={{
                backgroundColor: C.accentDim,
                borderWidth: 1,
                borderColor: C.accent,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                + Add Wallet
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: C.text2, fontSize: 12, marginBottom: 16, lineHeight: 17 }}>
            Override balances to sync digital floats or your cash drawer, or register a new wallet/bank channel.
          </Text>

          <View style={{ gap: 10 }}>
            {dashboardData.wallets.map((wallet) => (
              <TouchableOpacity
                key={wallet.channel}
                onPress={() => handleOpenEditModal(wallet)}
                style={{
                  backgroundColor: C.surface2,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderLeftWidth: 5,
                  borderLeftColor: getWalletAccentColor(wallet.channel),
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderRadius: 16,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ color: C.text1, fontWeight: '700', fontSize: 13 }}>
                    {getWalletLabel(wallet.channel)}
                  </Text>
                  <Text style={{ color: C.text3, fontSize: 10, marginTop: 2 }}>Tap to override balance</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: C.text1, fontWeight: '800', fontSize: 14 }}>
                    ₱{wallet.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>

                  {!['GCASH', 'MAYA', 'MAYA_BUSINESS', 'MARIBANK', 'PHYSICAL_CASH'].includes(wallet.channel.toUpperCase()) && (
                    <TouchableOpacity
                      onPress={() => handleDeleteWallet(wallet.channel)}
                      disabled={deleteWalletMutation.isPending}
                      style={{ padding: 6, marginLeft: 4, backgroundColor: C.dangerDim, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(220,107,90,0.15)' }}
                    >
                      <Trash2 size={13} color={C.danger} />
                    </TouchableOpacity>
                  )}

                  <ChevronRight size={14} color={C.text3} style={{ marginLeft: 4 }} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Configurable Fee Rules Panel */}
        <View style={CARD_STYLE}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Settings size={18} color={C.accent} />
            <Text style={{ color: C.text1, fontSize: 14, fontWeight: '700' }}>Configure Fee Rules</Text>
          </View>
          <Text style={{ color: C.text2, fontSize: 12, marginBottom: 18, lineHeight: 17 }}>
            Adjust the default transaction service fees and rule thresholds calculated on counter ledger entries.
          </Text>

          <View style={{ gap: 20 }}>
            {/* Cash-In & Cash-Out Config */}
            <View style={{ borderBottomWidth: 1, borderColor: C.border, paddingBottom: 16 }}>
              <Text style={{ color: C.text2, fontSize: 12, fontWeight: '700', marginBottom: 12 }}>Cash-In & Cash-Out Fee Rules</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Step Size</Text>
                  <View style={{ position: 'relative', justifyContent: 'center' }}>
                    <Text style={{ position: 'absolute', left: 12, color: C.text2, fontSize: 12, fontWeight: '700', zIndex: 10 }}>₱</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={cashStep}
                      onChangeText={setCashStep}
                      style={{
                        backgroundColor: C.bg,
                        borderWidth: 1,
                        borderColor: C.border,
                        color: C.text1,
                        borderRadius: 14,
                        paddingLeft: 24,
                        paddingRight: 12,
                        paddingVertical: 10,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Fee per Step</Text>
                  <View style={{ position: 'relative', justifyContent: 'center' }}>
                    <Text style={{ position: 'absolute', left: 12, color: C.text2, fontSize: 12, fontWeight: '700', zIndex: 10 }}>₱</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={cashFee}
                      onChangeText={setCashFee}
                      style={{
                        backgroundColor: C.bg,
                        borderWidth: 1,
                        borderColor: C.border,
                        color: C.text1,
                        borderRadius: 14,
                        paddingLeft: 24,
                        paddingRight: 12,
                        paddingVertical: 10,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    />
                  </View>
                </View>
              </View>
            </View>

            {/* E-Load Config */}
            <View style={{ borderBottomWidth: 1, borderColor: C.border, paddingBottom: 16 }}>
              <Text style={{ color: C.text2, fontSize: 12, fontWeight: '700', marginBottom: 12 }}>E-Load Fee Rules</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Threshold</Text>
                  <View style={{ position: 'relative', justifyContent: 'center' }}>
                    <Text style={{ position: 'absolute', left: 10, color: C.text2, fontSize: 12, fontWeight: '700', zIndex: 10 }}>₱</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={eloadThreshold}
                      onChangeText={setEloadThreshold}
                      style={{
                        backgroundColor: C.bg,
                        borderWidth: 1,
                        borderColor: C.border,
                        color: C.text1,
                        borderRadius: 14,
                        paddingLeft: 22,
                        paddingRight: 10,
                        paddingVertical: 10,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Fee Below</Text>
                  <View style={{ position: 'relative', justifyContent: 'center' }}>
                    <Text style={{ position: 'absolute', left: 10, color: C.text2, fontSize: 12, fontWeight: '700', zIndex: 10 }}>₱</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={eloadFeeLow}
                      onChangeText={setEloadFeeLow}
                      style={{
                        backgroundColor: C.bg,
                        borderWidth: 1,
                        borderColor: C.border,
                        color: C.text1,
                        borderRadius: 14,
                        paddingLeft: 22,
                        paddingRight: 10,
                        paddingVertical: 10,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Fee Above/Eq</Text>
                  <View style={{ position: 'relative', justifyContent: 'center' }}>
                    <Text style={{ position: 'absolute', left: 10, color: C.text2, fontSize: 12, fontWeight: '700', zIndex: 10 }}>₱</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={eloadFeeHigh}
                      onChangeText={setEloadFeeHigh}
                      style={{
                        backgroundColor: C.bg,
                        borderWidth: 1,
                        borderColor: C.border,
                        color: C.text1,
                        borderRadius: 14,
                        paddingLeft: 22,
                        paddingRight: 10,
                        paddingVertical: 10,
                        fontSize: 12,
                        fontWeight: '700',
                      }}
                    />
                  </View>
                </View>
              </View>
            </View>

            {/* TV Load Config */}
            <View>
              <Text style={{ color: C.text2, fontSize: 12, fontWeight: '700', marginBottom: 12 }}>TV Load Fee Rules</Text>
              <View style={{ width: '50%' }}>
                <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Flat Fee</Text>
                <View style={{ position: 'relative', justifyContent: 'center' }}>
                  <Text style={{ position: 'absolute', left: 12, color: C.text2, fontSize: 12, fontWeight: '700', zIndex: 10 }}>₱</Text>
                  <TextInput
                    keyboardType="numeric"
                    value={tvloadFee}
                    onChangeText={setTvloadFee}
                    style={{
                      backgroundColor: C.bg,
                      borderWidth: 1,
                      borderColor: C.border,
                      color: C.text1,
                      borderRadius: 14,
                      paddingLeft: 24,
                      paddingRight: 12,
                      paddingVertical: 10,
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  />
                </View>
              </View>
            </View>

            {/* Save Settings Button */}
            <TouchableOpacity
              onPress={handleSaveSettings}
              disabled={isSavingSettings}
              style={{
                width: '100%',
                paddingVertical: 14,
                backgroundColor: C.accent,
                borderRadius: 16,
                justifyContent: 'center',
                alignItems: 'center',
                marginTop: 10,
                opacity: isSavingSettings ? 0.6 : 1,
              }}
            >
              <Text style={{ color: C.bg, fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                {isSavingSettings ? 'Saving Settings...' : 'Save Configured Fees'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Back up & Actions Panel */}
        <View style={CARD_STYLE}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <TrendingUp size={18} color={C.success} />
            <Text style={{ color: C.text1, fontSize: 14, fontWeight: '700' }}>Admin Utilities</Text>
          </View>
          <Text style={{ color: C.text2, fontSize: 12, marginBottom: 18, lineHeight: 17 }}>
            Secure your store accounts by exporting reports or resetting metrics back to defaults.
          </Text>

          {/* Export CSV */}
          <TouchableOpacity
            onPress={handleExportCSV}
            disabled={isExporting}
            style={{
              width: '100%',
              paddingVertical: 14,
              backgroundColor: C.success,
              borderRadius: 16,
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 12,
              opacity: isExporting ? 0.6 : 1,
            }}
          >
            <Share2 size={16} color={C.bg} style={{ marginRight: 6 }} />
            <Text style={{ color: C.bg, fontWeight: '800', fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              {isExporting ? 'Exporting...' : 'Export & Share CSV Ledger'}
            </Text>
          </TouchableOpacity>

          {/* Wipe Database */}
          <TouchableOpacity
            onPress={handleResetDatabase}
            style={{
              width: '100%',
              paddingVertical: 14,
              backgroundColor: C.bg,
              borderWidth: 1,
              borderColor: 'rgba(220,107,90,0.3)',
              borderRadius: 16,
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Trash2 size={16} color={C.danger} style={{ marginRight: 6 }} />
            <Text style={{ color: C.danger, fontWeight: '700', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
              Wipe Database Ledger
            </Text>
          </TouchableOpacity>
        </View>

        {/* Custom Edit Float Modal */}
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
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Float Editor</Text>
                  <Text style={{ color: C.text1, fontSize: 18, fontWeight: '800', marginTop: 2 }}>Adjust: {selectedWallet ? getWalletLabel(selectedWallet.channel) : ''}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setEditModalVisible(false)}
                  style={{ padding: 8, backgroundColor: C.surface2, borderRadius: 20, borderWidth: 1, borderColor: C.border }}
                >
                  <X size={18} color={C.text2} />
                </TouchableOpacity>
              </View>

              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>New Balance (₱)</Text>
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
                  marginBottom: 24,
                }}
                keyboardType="decimal-pad"
                value={newBalance}
                onChangeText={setNewBalance}
              />

              <TouchableOpacity
                onPress={handleSaveBalance}
                style={{
                  width: '100%',
                  paddingVertical: 16,
                  backgroundColor: C.accent,
                  borderRadius: 16,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Check size={18} color={C.bg} style={{ marginRight: 8 }} />
                <Text style={{ color: C.bg, fontWeight: '800', fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                  Confirm Balance Override
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Custom Add Wallet Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={addWalletModalVisible}
          onRequestClose={() => setAddWalletModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18, 16, 14, 0.85)' }}
          >
            <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.border, borderTopLeftRadius: 36, borderTopRightRadius: 36, padding: 24, paddingBottom: 48 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <View>
                  <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' }}>Wallet Creator</Text>
                  <Text style={{ color: C.text1, fontSize: 18, fontWeight: '800', marginTop: 2 }}>Register Custom Float Account</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setAddWalletModalVisible(false)}
                  style={{ padding: 8, backgroundColor: C.surface2, borderRadius: 20, borderWidth: 1, borderColor: C.border }}
                >
                  <X size={18} color={C.text2} />
                </TouchableOpacity>
              </View>

              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Wallet/Bank Name (e.g. BDO, ShopeePay)</Text>
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
                  fontSize: 16,
                  marginBottom: 16,
                }}
                placeholder="Enter custom wallet or bank name..."
                placeholderTextColor={C.text3}
                autoCapitalize="characters"
                value={newWalletName}
                onChangeText={setNewWalletName}
              />

              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Initial Balance (₱)</Text>
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
                  marginBottom: 24,
                }}
                keyboardType="decimal-pad"
                value={newWalletBalance}
                onChangeText={setNewWalletBalance}
                placeholder="0.00"
                placeholderTextColor={C.text3}
              />

              <TouchableOpacity
                onPress={handleAddWallet}
                style={{
                  width: '100%',
                  paddingVertical: 16,
                  backgroundColor: C.accent,
                  borderRadius: 16,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Check size={18} color={C.bg} style={{ marginRight: 8 }} />
                <Text style={{ color: C.bg, fontWeight: '800', fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                  Create Account Float
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>

      </ScrollView>
    </SafeAreaView>
  );
}
