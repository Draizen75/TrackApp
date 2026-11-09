import { DailyProfitItem, Transaction, useDbQueries } from '@/hooks/useDbQueries';
import { useScreenFocus } from '@/hooks/useScreenFocus';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart2,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Coins,
  Pencil,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  TrendingUp,
  Tv,
  Wallet,
  X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ledgerColors as C, ledgerRadius, ledgerTypography, ledgerSpacing, ledgerElevation } from '@/theme/ledger';
import { LedgerEmptyState, LedgerErrorState, LedgerLoadingState } from '@/components/ledger-state';
import { LedgerMetricCard } from '@/components/ledger-metric-card';

// ─── Obsidian & Gold Design ────────────────────────────────────────────────────
export default function DashboardScreen() {
  const router = useRouter();
  const isScreenFocused = useScreenFocus();
  const { width: viewportWidth } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && viewportWidth >= 1024;

  // Interactive Chart & Earnings Summary State
  const [timeframe, setTimeframe] = useState<'7d' | '14d' | '30d' | 'custom'>('7d');
  const [customDays, setCustomDays] = useState<number>(7);
  const activeDaysCount = timeframe === '7d' ? 7 : timeframe === '14d' ? 14 : timeframe === '30d' ? 30 : customDays;

  const { useDashboardData, useDeleteTransaction, useTransactionsForDate } = useDbQueries();
  const { data, isLoading, isError, refetch } = useDashboardData(activeDaysCount, isScreenFocused);
  const deleteTxMutation = useDeleteTransaction();

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [showSelectedDayTransactions, setShowSelectedDayTransactions] = useState(false);

  // Custom Timeframe Dropdown Modal State
  const [isCustomDaysModalOpen, setIsCustomDaysModalOpen] = useState(false);
  const [customInputText, setCustomInputText] = useState('7');

  // Dynamic daily profits chart dataset based on timeframe selection (BEFORE ANY CONDITIONAL RETURNS)
  const activeDailyProfits: DailyProfitItem[] = useMemo(() => {
    const fullList = data?.dailyProfits || [];
    if (timeframe === '7d') return fullList.slice(-7);
    if (timeframe === '14d') return fullList.slice(-14);
    if (timeframe === '30d') return fullList.slice(-30);
    return fullList.slice(-Math.max(customDays, 1));
  }, [data?.dailyProfits, timeframe, customDays]);

  // Selected Day Details for Interactive Chart (BEFORE ANY CONDITIONAL RETURNS)
  const selectedDayInfo = useMemo(() => {
    if (!activeDailyProfits || activeDailyProfits.length === 0) return null;
    if (selectedDayKey) {
      const match = activeDailyProfits.find(d => d.dateKey === selectedDayKey);
      if (match) return match;
    }
    // Default to the last item in the series (Today or most recent)
    return activeDailyProfits[activeDailyProfits.length - 1];
  }, [activeDailyProfits, selectedDayKey]);

  const { data: selectedDayTransactions = [], isLoading: isSelectedDayTransactionsLoading } = useTransactionsForDate(
    showSelectedDayTransactions ? selectedDayInfo?.dateKey || '' : '',
    isScreenFocused,
  );

  // Custom N-Day Summary Calculation (BEFORE ANY CONDITIONAL RETURNS)
  const customNDaySummary = useMemo(() => {
    const dayCount = Math.max(activeDaysCount, 1);
    const list = (data?.dailyProfits || []).slice(-dayCount);
    const earningsCollected = list.reduce((sum, d) => sum + d.netProfit, 0);
    return {
      netProfit: earningsCollected,
      txCount: list.reduce((sum, d) => sum + (d.txCount || 0), 0),
      dailyAverage: earningsCollected / dayCount,
    };
  }, [data?.dailyProfits, activeDaysCount]);
  const maxDailyEarnings = activeDailyProfits.reduce((maximum, day) => Math.max(maximum, day.netProfit), 100);

  const handleDeleteTx = (tx: Transaction) => {
    Alert.alert(
      "Delete Transaction",
      `Are you sure you want to delete this transaction of ₱${tx.amount.toFixed(2)}? This will revert the wallet balances.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (process.env.EXPO_OS !== 'web') {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            deleteTxMutation.mutate(tx.id);
          }
        }
      ]
    );
  };

  if (isLoading && !data) {
    return (
      <LedgerLoadingState label="Loading your dashboard…" />
    );
  }
  if (isError && !data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: ledgerSpacing.lg }}>
        <LedgerErrorState title="Dashboard unavailable" description="We couldn't load your ledger summary. Your saved transactions are not affected." onRetry={() => { void refetch(); }} />
      </View>
    );
  }
  if (!data) return null;
  const recentTransactions = data.recentTransactions.slice(0, 5);

  const getTxTypeBadge = (type: Transaction['type']) => {
    switch (type) {
      case 'CASH_IN':
        return { icon: <ArrowUpRight size={14} color={C.info} />, bg: C.infoDim, text: C.info, label: 'Cash In' };
      case 'CASH_OUT':
        return { icon: <ArrowDownLeft size={14} color={C.accent} />, bg: C.accentDim, text: C.accent, label: 'Cash Out' };
      case 'E_LOAD':
        return { icon: <Smartphone size={14} color={C.accent} />, bg: C.accentDim, text: C.accent, label: 'E-Load' };
      case 'TV_LOAD':
        return { icon: <Tv size={14} color={C.info} />, bg: C.infoDim, text: C.info, label: 'TV Load' };
      case 'DEBT_PAYMENT':
        return { icon: <Coins size={14} color={C.warning} />, bg: 'rgba(215,173,100,0.14)', text: C.warning, label: 'Debt Pay' };
    }
  };

  const getWalletTheme = (channel: string) => {
    const upper = channel.toUpperCase();

    // Core default themes
    const defaultThemes: Record<string, { colors: string[]; label: string; accentColor: string; segmentColor: string }> = {
      GCASH: { colors: ['#182438', C.surface], label: 'GCash', accentColor: C.info, segmentColor: C.info },
      MAYA: { colors: ['#173126', C.surface], label: 'Maya', accentColor: C.success, segmentColor: C.success },
      MAYA_BUSINESS: { colors: ['#302619', C.surface], label: 'Maya Biz', accentColor: C.warning, segmentColor: C.warning },
      MARIBANK: { colors: ['#18302d', C.surface], label: 'MariBank', accentColor: '#63c4a4', segmentColor: '#63c4a4' },
      PHYSICAL_CASH: { colors: ['#302719', C.surface], label: 'Cash Box', accentColor: C.accent, segmentColor: C.accent },
    };

    if (defaultThemes[upper]) return defaultThemes[upper];

    // Premium unique visual themes list for custom banks / e-wallets
    const customPalette = [
      { colors: ['#25232a', C.surface], accent: C.accent, segment: C.accent },
      { colors: ['#222a31', C.surface], accent: C.info, segment: C.info },
      { colors: ['#242b27', C.surface], accent: C.success, segment: C.success },
      { colors: ['#2b2621', C.surface], accent: C.warning, segment: C.warning },
      { colors: ['#272430', C.surface], accent: '#b5a4ec', segment: '#8b75d1' },
      { colors: ['#202b32', C.surface], accent: '#73b8c5', segment: '#4d8c99' },
      { colors: ['#29232b', C.surface], accent: '#d49bad', segment: '#ab7185' },
      { colors: ['#222b25', C.surface], accent: C.success, segment: C.success },
      { colors: ['#2a2922', C.surface], accent: '#c6ba7c', segment: '#9b8c4c' },
      { colors: ['#24272d', C.surface], accent: '#aab4c7', segment: '#7c899e' },
    ];

    let hash = 0;
    for (let i = 0; i < upper.length; i++) {
      hash = upper.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % customPalette.length;
    const match = customPalette[idx];

    const label = channel.length <= 4 ? channel.toUpperCase() : (channel.charAt(0).toUpperCase() + channel.slice(1));

    return {
      colors: match.colors,
      label,
      accentColor: match.accent,
      segmentColor: match.segment
    };
  };

  const CARD_STYLE = {
    backgroundColor: C.surface,
    borderRadius: ledgerRadius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
  };
  const SECONDARY_SECTION_STYLE = {
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: C.border,
    marginBottom: 8,
  };
  const SUMMARY_ROW_STYLE = {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  };



  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView
        style={{ flex: 1, width: '100%', maxWidth: isDesktopWeb ? 1440 : undefined, alignSelf: 'center', paddingHorizontal: isDesktopWeb ? 32 : 16 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: isDesktopWeb ? 48 : 96, paddingTop: isDesktopWeb ? 24 : 0 }}
      >

        {isError && (
          <TouchableOpacity onPress={() => refetch()} accessibilityRole="button" accessibilityLabel="Retry refreshing dashboard" style={{ backgroundColor: C.dangerDim, borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: C.danger, fontSize: 12, textAlign: 'center', fontWeight: '700' }}>Could not refresh dashboard data. Showing the last available results. Tap to retry.</Text>
          </TouchableOpacity>
        )}

        {/* ── Hero KPI Card ─────────────────────────────────────────── */}
        <LinearGradient
          colors={['#282315', '#11141f']}
          style={{
            borderRadius: ledgerRadius.card,
            paddingHorizontal: isDesktopWeb ? 36 : 24,
            paddingVertical: isDesktopWeb ? 32 : 26,
            borderWidth: 1,
            borderColor: C.accent,
            ...ledgerElevation.accent,
            marginBottom: 16,
          }}
        >
          <View style={{ alignItems: 'center', marginBottom: 22, paddingHorizontal: 4 }}>
            <Text style={{ color: C.text2, fontSize: 12, letterSpacing: 2.1, textTransform: 'uppercase', fontWeight: '800', marginBottom: 8, textAlign: 'center' }}>
              Earnings Collected
            </Text>
            <Text style={{
              fontSize: Math.max(ledgerTypography.display, 38),
              fontWeight: '900',
              letterSpacing: -0.8,
              color: data.earningsPaid >= 0 ? C.accent : C.danger,
              marginBottom: 6,
              textAlign: 'center',
              includeFontPadding: false,
            }}>
              ₱{data.netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <Text style={{ color: C.text2, fontSize: 12, textAlign: 'center' }}>
              All-time fees and interest received
            </Text>
          </View>

          {/* Divider */}
          <View style={{ height: 1, backgroundColor: '#ffffff20', marginBottom: 16 }} />

          {/* Ledger status */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, columnGap: 10 }}>
            {[
              { icon: <TrendingUp size={13} color={C.text2} />, label: 'Fees Recorded', value: data.grossProfit, color: C.text1 },
              { icon: <Check size={13} color={C.success} />, label: 'Principal Paid', value: data.principalPaid, color: C.success },
              { icon: <Coins size={13} color={C.warning} />, label: 'Pending Earnings', value: data.pendingEarnings, color: C.warning },
              { icon: <AlertTriangle size={13} color={C.danger} />, label: 'Debt Outstanding', value: data.totalDebt, color: C.danger },
            ].map((item) => (
              <LedgerMetricCard
                key={item.label}
                icon={item.icon}
                label={item.label}
                value={item.value}
                color={item.color}
              />
            ))}
          </View>
        </LinearGradient>

        {/* ── Wallet Float Cards ────────────────────────────────────── */}
        <View style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Wallet size={13} color={C.text3} />
            <Text style={{ color: C.text3, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }}>
              Active Counter Float
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingRight: 8 }}
          >
            {data.wallets.length === 0 ? (
              <LedgerEmptyState title="No wallets configured" description="Add a wallet in Settings to start tracking your counter float." />
            ) : data.wallets.map((wallet) => {
              const theme = getWalletTheme(wallet.channel);
              return (
                <LinearGradient
                  key={wallet.channel}
                  colors={theme.colors as [string, string]}
                  style={{
                    width: 148,
                    height: 100,
                    borderRadius: 16,
                    padding: 14,
                    justifyContent: 'space-between',
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: theme.accentColor, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>
                      {theme.label}
                    </Text>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: wallet.balance > 0 ? C.success : C.danger }} />
                  </View>
                  <View>
                    <Text style={{ color: C.text3, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 }}>
                      Float Balance
                    </Text>
                    <Text style={{ color: C.text1, fontSize: 17, fontWeight: '800', letterSpacing: -0.5 }}>
                      ₱{wallet.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </Text>
                  </View>
                </LinearGradient>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Multi-Timeframe Earnings Summary Section ──────────────── */}
        <View style={SECONDARY_SECTION_STYLE}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <Calendar size={14} color={C.accent} />
            <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }}>
              Earnings Summary
            </Text>
          </View>

          {/* Compact summary rows keep the earnings hierarchy calm and scannable. */}
          <View>
            {/* Today */}
            <View style={SUMMARY_ROW_STYLE}>
              <View>
                <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>Today</Text>
                <Text style={{ color: C.text1, fontSize: 16, fontWeight: '800', marginTop: 2 }}>
                  ₱{(data.earningsSummary?.today?.netProfit ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
                <Text style={{ color: C.warning, fontSize: 10, fontWeight: '700', marginTop: 2 }}>
                  ₱{(data.earningsSummary?.today?.pendingEarnings ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pending fees
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>
                  {(data.earningsSummary?.today?.txCount ?? 0)} Tx Logs
                </Text>
              </View>
            </View>

            <View style={SUMMARY_ROW_STYLE}>
              <View>
                <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>Week to Date</Text>
                <Text style={{ color: C.text1, fontSize: 16, fontWeight: '800', marginTop: 2 }}>
                  ₱{(data.earningsSummary?.week?.netProfit ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
                <Text style={{ color: C.warning, fontSize: 10, fontWeight: '700', marginTop: 2 }}>
                  ₱{(data.earningsSummary?.week?.pendingEarnings ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pending fees
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>
                  {(data.earningsSummary?.week?.txCount ?? 0)} Tx Logs
                </Text>
              </View>
            </View>

            <View style={{ ...SUMMARY_ROW_STYLE, borderBottomWidth: 0 }}>
              <View>
                <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>Month to Date</Text>
                <Text style={{ color: C.accent, fontSize: 16, fontWeight: '800', marginTop: 2 }}>
                  ₱{(data.earningsSummary?.month?.netProfit ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
                <Text style={{ color: C.warning, fontSize: 10, fontWeight: '700', marginTop: 2 }}>
                  ₱{(data.earningsSummary?.month?.pendingEarnings ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pending fees
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>
                  {(data.earningsSummary?.month?.txCount ?? 0)} Tx Logs
                </Text>
              </View>
            </View>

          </View>
        </View>

        {/* ── Dynamic Interactive Profit Chart ─────────────────────── */}
        <View style={SECONDARY_SECTION_STYLE}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <BarChart2 size={14} color={C.accent} />
              <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }} numberOfLines={1}>
                Earnings Collected
              </Text>
            </View>

            {/* Single Unified Dropdown Selector Button */}
            <TouchableOpacity
              onPress={async () => {
                if (process.env.EXPO_OS !== 'web') {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                setCustomInputText(activeDaysCount.toString());
                setIsCustomDaysModalOpen(true);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 8,
                backgroundColor: C.accentDim,
                borderWidth: 1,
                borderColor: C.accent,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '800', color: C.accent }}>
                {activeDaysCount} Days Range
              </Text>
              <ChevronDown size={13} color={C.accent} />
            </TouchableOpacity>
          </View>

          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: C.surface2,
            borderRadius: ledgerRadius.control,
            padding: 14,
            borderWidth: 1,
            borderColor: C.border,
            marginBottom: 12,
          }}>
            <View>
              <Text style={{ color: C.text1, fontSize: 16, fontWeight: '800' }}>
                ₱{customNDaySummary.netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
              <Text style={{ color: C.text3, fontSize: 10, marginTop: 2 }}>
                Earnings collected · past {activeDaysCount} days
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 }}>
                Daily Average
              </Text>
              <Text style={{ color: C.success, fontSize: 14, fontWeight: '800', marginTop: 2 }}>
                ₱{customNDaySummary.dailyAverage.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
              <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700' }}>
                {customNDaySummary.txCount} transactions
              </Text>
            </View>
          </View>

          <Text style={{ color: C.text3, fontSize: 10, marginBottom: 14 }}>
            Tap a day to inspect earnings collected, fees assessed, and transactions.
          </Text>

          {/* Scrollable Bar Chart */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, paddingTop: 10, gap: activeDailyProfits.length > 14 ? 8 : 12, minWidth: '100%' }}>
              {activeDailyProfits.map((day, idx) => {
                const dayProfit = day.netProfit;
                const heightPct = Math.min((dayProfit / maxDailyEarnings) * 100, 100);
                const isSelected = selectedDayInfo?.dateKey === day.dateKey;
                const isToday = idx === activeDailyProfits.length - 1;

                return (
                  <TouchableOpacity
                    key={day.dateKey || idx}
                    onPress={async () => {
                      if (process.env.EXPO_OS !== 'web') {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }
                      setSelectedDayKey(day.dateKey);
                      setShowSelectedDayTransactions(false);
                    }}
                    activeOpacity={0.7}
                    style={{ alignItems: 'center', width: activeDailyProfits.length > 14 ? 28 : (280 / Math.max(activeDailyProfits.length, 1)) }}
                  >
                    {dayProfit > 0 && (
                      <Text style={{ color: isSelected ? C.accent : isToday ? C.accent : C.text3, fontSize: 8, fontWeight: '800', marginBottom: 4 }}>
                        ₱{dayProfit.toFixed(0)}
                      </Text>
                    )}
                    <View
                      style={{
                        height: `${Math.max(heightPct, 6)}%` as any,
                        width: '100%',
                        maxHeight: 80,
                        borderRadius: 6,
                        backgroundColor: isSelected ? C.accent : isToday ? 'rgba(255,209,102,0.6)' : C.surface2,
                        borderWidth: isSelected ? 2 : 1,
                        borderColor: isSelected ? '#ffffff' : isToday ? C.accent : C.border,
                      }}
                    />
                    <Text style={{ color: isSelected ? C.accent : C.text3, fontSize: 8, marginTop: 6, textAlign: 'center', fontWeight: isSelected ? '800' : '500' }} numberOfLines={1}>
                      {day.date.split(',')[0] || day.date}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* Selected Day Detail Card */}
          {selectedDayInfo && (
            <View style={{ backgroundColor: C.surface2, borderRadius: 16, padding: 14, marginTop: 16, borderWidth: 1, borderColor: 'rgba(255,209,102,0.3)' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Clock size={13} color={C.accent} />
                  <Text style={{ color: C.text1, fontSize: 13, fontWeight: '800' }}>
                    {selectedDayInfo.date}
                  </Text>
                </View>
                <View style={{ backgroundColor: C.accentDim, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ color: C.accent, fontSize: 10, fontWeight: '800' }}>
                    {selectedDayInfo.txCount || 0} Tx Logs
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1, backgroundColor: C.surface, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ color: C.text3, fontSize: 9, textTransform: 'uppercase', fontWeight: '700' }}>Earnings Collected</Text>
                  <Text style={{ color: C.accent, fontSize: 14, fontWeight: '800', marginTop: 2 }}>
                    ₱{selectedDayInfo.netProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
                <View style={{ flex: 1, backgroundColor: C.surface, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ color: C.text3, fontSize: 9, textTransform: 'uppercase', fontWeight: '700' }}>Fees Recorded</Text>
                  <Text style={{ color: C.text1, fontSize: 14, fontWeight: '800', marginTop: 2 }}>
                    ₱{selectedDayInfo.grossProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              </View>
              <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12 }}>
                <TouchableOpacity
                  onPress={() => setShowSelectedDayTransactions(value => !value)}
                  accessibilityRole="button"
                  accessibilityLabel={`${showSelectedDayTransactions ? 'Hide' : 'Show'} transactions for ${selectedDayInfo.date}`}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}
                >
                  <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '700' }}>
                    Transactions · {selectedDayInfo.txCount || 0}
                  </Text>
                  {showSelectedDayTransactions
                    ? <ChevronUp size={14} color={C.text3} />
                    : <ChevronDown size={14} color={C.text3} />}
                </TouchableOpacity>
                {showSelectedDayTransactions && (isSelectedDayTransactionsLoading ? (
                  <Text style={{ color: C.text3, fontSize: 12, paddingVertical: 8 }}>Loading transactions...</Text>
                ) : selectedDayTransactions.length === 0 ? (
                  <Text style={{ color: C.text3, fontSize: 12, paddingVertical: 8 }}>No transactions recorded for this day.</Text>
                ) : (
                  selectedDayTransactions.map((transaction) => {
                    const typeDetails = getTxTypeBadge(transaction.type);
                    return (
                      <View key={transaction.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border }}>
                        <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: typeDetails.bg, alignItems: 'center', justifyContent: 'center' }}>
                          {typeDetails.icon}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ color: C.text1, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                            {typeDetails.label}{transaction.customer_name ? ` · ${transaction.customer_name}` : ''}
                          </Text>
                          <Text style={{ color: C.text3, fontSize: 10, marginTop: 2 }} numberOfLines={1}>
                            {transaction.channel}{transaction.fee > 0 ? ` · Fee ${transaction.fee.toFixed(2)}` : ''}
                          </Text>
                        </View>
                        <Text style={{ color: typeDetails.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                          ₱{transaction.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                      </View>
                    );
                  })
                ))}
              </View>
            </View>
          )}

        </View>

        {/* ── Recent Transactions ───────────────────────────────────── */}
        <View style={CARD_STYLE}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }}>
              Recent Transactions
            </Text>
            <TouchableOpacity
              onPress={async () => {
                if (process.env.EXPO_OS !== 'web') {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                router.push('/history');
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>View All</Text>
              <ChevronRight size={13} color={C.accent} />
            </TouchableOpacity>
          </View>

          {recentTransactions.length === 0 ? (
            <LedgerEmptyState title="No transactions yet" description="Your latest cash-ins, cash-outs, and debt payments will appear here." tone="accent" />
          ) : (
            recentTransactions.map((tx, idx) => {
              const badge = getTxTypeBadge(tx.type);
              return (
                <View
                  key={tx.id}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: 12,
                    borderTopWidth: idx > 0 ? 1 : 0,
                    borderColor: C.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    {/* Icon bubble */}
                    <View style={{ width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: badge?.bg }}>
                      {badge?.icon}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ color: C.text1, fontSize: 14, fontWeight: '700' }}>
                          ₱{tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </Text>
                        {tx.fee > 0 && (
                          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: C.accentDim }}>
                            <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700' }}>+₱{tx.fee}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: C.text3, fontSize: 11, marginTop: 2 }}>
                        {getWalletTheme(tx.channel).label} • {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {tx.customer_name ? ` • ${tx.customer_name}` : ''}
                        {tx.is_debt === 1 ? ' · Utang' : ''}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity
                      onPress={async () => {
                        if (process.env.EXPO_OS !== 'web') {
                          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }
                        router.push(`/history?editTxId=${tx.id}`);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Edit transaction"
                      hitSlop={10}
                      style={{ padding: 8 }}
                    >
                      <Pencil size={14} color={C.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteTx(tx)}
                      accessibilityRole="button"
                      accessibilityLabel="Delete transaction"
                      hitSlop={10}
                      style={{ padding: 8 }}
                    >
                      <Trash2 size={14} color={C.text3} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>

      </ScrollView>

      {/* ── Custom Days Selection Dropdown Modal ──────────────────────── */}
      <Modal
        visible={isCustomDaysModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsCustomDaysModalOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setIsCustomDaysModalOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 }}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={{
              width: '100%',
              maxWidth: 360,
              backgroundColor: C.surface,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: C.border,
              padding: 20,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <SlidersHorizontal size={16} color={C.accent} />
                <Text style={{ color: C.text1, fontSize: 16, fontWeight: '800' }}>
                  Select Timeframe
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsCustomDaysModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close date range selector"
                hitSlop={10}
                style={{ padding: 4 }}
              >
                <X size={18} color={C.text3} />
              </TouchableOpacity>
            </View>

            <Text style={{ color: C.text3, fontSize: 11, marginBottom: 14 }}>
              Choose a timeframe preset or enter a custom number of days to aggregate ledger metrics:
            </Text>

            {/* Presets List */}
            <View style={{ gap: 8, marginBottom: 16 }}>
              {[
                { days: 7, label: '7 Days', sub: 'Past 1 Week' },
                { days: 14, label: '14 Days', sub: 'Past 2 Weeks' },
                { days: 30, label: '30 Days', sub: 'Past Month (30 Days)' },
                { days: 45, label: '45 Days', sub: 'Past 1.5 Months' },
                { days: 60, label: '60 Days', sub: 'Past 2 Months' },
                { days: 90, label: '90 Days', sub: 'Past Quarter (3 Months)' },
              ].map((opt) => {
                const isSelected = activeDaysCount === opt.days;
                return (
                  <TouchableOpacity
                    key={opt.days}
                    onPress={async () => {
                      if (process.env.EXPO_OS !== 'web') {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }
                      if (opt.days === 7) {
                        setTimeframe('7d');
                        setCustomDays(7);
                      } else if (opt.days === 14) {
                        setTimeframe('14d');
                        setCustomDays(14);
                      } else if (opt.days === 30) {
                        setTimeframe('30d');
                        setCustomDays(30);
                      } else {
                        setTimeframe('custom');
                        setCustomDays(opt.days);
                      }
                      setSelectedDayKey(null);
                      setShowSelectedDayTransactions(false);
                      setCustomInputText(opt.days.toString());
                      setIsCustomDaysModalOpen(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 12,
                      borderRadius: 12,
                      backgroundColor: isSelected ? C.accentDim : C.surface2,
                      borderWidth: 1,
                      borderColor: isSelected ? C.accent : C.border,
                    }}
                  >
                    <View>
                      <Text style={{ color: isSelected ? C.accent : C.text1, fontSize: 13, fontWeight: '700' }}>
                        {opt.label}
                      </Text>
                      <Text style={{ color: C.text3, fontSize: 10, marginTop: 1 }}>
                        {opt.sub}
                      </Text>
                    </View>
                    {isSelected && <Check size={16} color={C.accent} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Manual Input for N Days */}
            <View style={{ backgroundColor: C.surface2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border }}>
              <Text style={{ color: C.text2, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Or Enter Custom N Days:
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  style={{
                    flex: 1,
                    backgroundColor: C.bg,
                    color: C.text1,
                    fontSize: 14,
                    fontWeight: '700',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                  keyboardType="numeric"
                  value={customInputText}
                  onChangeText={setCustomInputText}
                  placeholder="e.g. 120"
                  placeholderTextColor={C.text3}
                />
                <TouchableOpacity
                  onPress={async () => {
                    const num = parseInt(customInputText, 10);
                    if (!isNaN(num) && num > 0) {
                      if (process.env.EXPO_OS !== 'web') {
                        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }
                      if (num === 7) {
                        setTimeframe('7d');
                        setCustomDays(7);
                      } else if (num === 14) {
                        setTimeframe('14d');
                        setCustomDays(14);
                      } else if (num === 30) {
                        setTimeframe('30d');
                        setCustomDays(30);
                      }
                      else {
                        setTimeframe('custom');
                        setCustomDays(num);
                      }
                      setSelectedDayKey(null);
                      setShowSelectedDayTransactions(false);
                      setIsCustomDaysModalOpen(false);
                    }
                  }}
                  style={{
                    backgroundColor: C.accent,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: C.bg, fontSize: 12, fontWeight: '800' }}>
                    Set Days
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
