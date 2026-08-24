import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDbQueries, Transaction, DailyProfitItem } from '@/hooks/useDbQueries';
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  Wallet, 
  Trash2, 
  Pencil,
  ArrowUpRight,
  ArrowDownLeft,
  Smartphone,
  Tv,
  Coins,
  RefreshCw,
  ChevronRight,
  Calendar,
  Clock,
  BarChart2,
  SlidersHorizontal,
  ChevronDown,
  Check,
  X,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

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

export default function DashboardScreen() {
  const router = useRouter();

  // Interactive Chart & Earnings Summary State
  const [timeframe, setTimeframe] = useState<'7d' | '14d' | '30d' | 'custom'>('7d');
  const [customDays, setCustomDays] = useState<number>(45);
  const activeDaysCount = timeframe === '7d' ? 7 : timeframe === '14d' ? 14 : timeframe === '30d' ? 30 : customDays;

  const { useDashboardData, useDeleteTransaction } = useDbQueries();
  const { data, isLoading, refetch } = useDashboardData(activeDaysCount);
  const deleteTxMutation = useDeleteTransaction();

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

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

  // Custom N-Day Summary Calculation (BEFORE ANY CONDITIONAL RETURNS)
  const customNDaySummary = useMemo(() => {
    const list = (data?.dailyProfits || []).slice(-Math.max(customDays, 1));
    const grossProfit = list.reduce((sum, d) => sum + (d.grossProfit || d.profit || 0), 0);
    const expenses = list.reduce((sum, d) => sum + (d.expenses || 0), 0);
    return {
      grossProfit,
      expenses,
      netProfit: grossProfit - expenses,
      txCount: list.reduce((sum, d) => sum + (d.txCount || 0), 0),
    };
  }, [data?.dailyProfits, customDays]);

  const handleRefresh = async () => {
    if (process.env.EXPO_OS !== 'web') {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    refetch();
  };

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

  if (isLoading || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: C.text3, fontSize: 14 }}>Loading ledger…</Text>
      </View>
    );
  }

  const getTxTypeBadge = (type: Transaction['type']) => {
    switch (type) {
      case 'CASH_IN':
        return { icon: <ArrowUpRight size={14} color={C.success} />, bg: C.successDim, text: C.success, label: 'Cash In' };
      case 'CASH_OUT':
        return { icon: <ArrowDownLeft size={14} color={C.accent} />, bg: C.accentDim, text: C.accent, label: 'Cash Out' };
      case 'E_LOAD':
        return { icon: <Smartphone size={14} color="#8b7cf8" />, bg: 'rgba(139,124,248,0.12)', text: '#8b7cf8', label: 'E-Load' };
      case 'TV_LOAD':
        return { icon: <Tv size={14} color="#6fa3d8" />, bg: 'rgba(111,163,216,0.12)', text: '#6fa3d8', label: 'TV Load' };
      case 'DEBT_PAYMENT':
        return { icon: <Coins size={14} color={C.warning} />, bg: 'rgba(201,123,46,0.12)', text: C.warning, label: 'Debt Pay' };
    }
  };

  const getWalletTheme = (channel: string) => {
    const upper = channel.toUpperCase();
    
    // Core default themes
    const defaultThemes: Record<string, { colors: string[]; label: string; accentColor: string; segmentColor: string }> = {
      GCASH: { colors: ['#1a2640', '#111827'], label: 'GCash', accentColor: '#6fa3d8', segmentColor: '#4a7fa5' },
      MAYA: { colors: ['#142820', '#0d1f18'], label: 'Maya', accentColor: '#5a9b6e', segmentColor: '#5a9b6e' },
      MAYA_BUSINESS: { colors: ['#1f1b14', '#15120d'], label: 'Maya Biz', accentColor: '#c97b2e', segmentColor: '#c97b2e' },
      MARIBANK: { colors: ['#14261f', '#0e1b16'], label: 'MariBank', accentColor: '#4a9b8a', segmentColor: '#4a9b8a' },
      PHYSICAL_CASH: { colors: ['#2a1f10', '#1c1509'], label: 'Cash Box', accentColor: '#e6a817', segmentColor: '#e6a817' },
    };

    if (defaultThemes[upper]) return defaultThemes[upper];

    // Premium unique visual themes list for custom banks / e-wallets
    const customPalette = [
      { colors: ['#2a1b40', '#150d24'], accent: '#c084fc', segment: '#a855f7' }, // Violet
      { colors: ['#3b181e', '#1c0a0c'], accent: '#f87171', segment: '#ef4444' }, // Crimson/Red
      { colors: ['#112d32', '#09181b'], accent: '#22d3ee', segment: '#06b6d4' }, // Cyan
      { colors: ['#3c162f', '#1b0a15'], accent: '#f472b6', segment: '#ec4899' }, // Pink
      { colors: ['#1b1f3c', '#0d0f1f'], accent: '#818cf8', segment: '#6366f1' }, // Indigo
      { colors: ['#36220f', '#1b1007'], accent: '#fb923c', segment: '#f97316' }, // Orange-Red
      { colors: ['#11322a', '#081a15'], accent: '#2dd4bf', segment: '#14b8a6' }, // Teal-Mint
      { colors: ['#0f321d', '#07190e'], accent: '#34d399', segment: '#10b981' }, // Emerald
      { colors: ['#28350e', '#131b07'], accent: '#a3e635', segment: '#84cc16' }, // Lime
      { colors: ['#321a48', '#170c22'], accent: '#d946ef', segment: '#c026d3' }, // Magenta
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
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
  };



  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView
        style={{ flex: 1, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 180 }}
      >

        {/* ── Header ───────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 20 }}>
          <View>
            <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' }}>
              Counter Float
            </Text>
            <Text style={{ color: C.text1, fontSize: 22, fontWeight: '800', marginTop: 2 }}>
              Ledger Dashboard
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleRefresh}
            style={{
              padding: 12,
              backgroundColor: C.surface2,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: C.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RefreshCw size={14} color={C.text2} />
            <Text style={{ color: C.text2, fontSize: 11, fontWeight: '600' }}>Refresh</Text>
          </TouchableOpacity>
        </View>

        {/* ── Hero KPI Card ─────────────────────────────────────────── */}
        <LinearGradient
          colors={['#1f1b12', '#181410']}
          style={{
            borderRadius: 22,
            padding: 24,
            borderWidth: 1,
            borderColor: data.netProfit >= 0 ? 'rgba(230,168,23,0.25)' : 'rgba(220,107,90,0.25)',
            marginBottom: 16,
          }}
        >
          <Text style={{ color: C.text3, fontSize: 10, letterSpacing: 2.5, textTransform: 'uppercase', fontWeight: '700', textAlign: 'center', marginBottom: 4 }}>
            True Net Profit
          </Text>
          <Text style={{ 
            fontSize: 44, 
            fontWeight: '900', 
            textAlign: 'center', 
            letterSpacing: -1,
            color: data.netProfit >= 0 ? C.accent : C.danger,
            marginBottom: 2,
          }}>
            ₱{data.netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
          <Text style={{ color: C.text3, fontSize: 11, textAlign: 'center', marginBottom: 20 }}>
            Gross fees collected minus all operating costs
          </Text>

          {/* Divider */}
          <View style={{ height: 1, backgroundColor: C.border, marginBottom: 20 }} />

          {/* Stat Row */}
          <View style={{ flexDirection: 'row' }}>
            {[
              { icon: <TrendingUp size={13} color={C.success} />, label: 'Gross Fees', value: data.grossProfit, color: C.text1 },
              { icon: <TrendingDown size={13} color={C.danger} />, label: 'Expenses', value: data.totalExpenses, color: C.danger },
              { icon: <Users size={13} color={C.warning} />, label: 'Lends/Debt', value: data.totalDebt, color: C.warning },
            ].map((item, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', borderRightWidth: i < 2 ? 1 : 0, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  {item.icon}
                  <Text style={{ color: C.text3, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '700' }}>
                    {item.label}
                  </Text>
                </View>
                <Text style={{ color: item.color, fontSize: 15, fontWeight: '800' }}>
                  ₱{item.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </Text>
              </View>
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
            {data.wallets.map((wallet) => {
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

        {/* ── Float Allocation Bar ──────────────────────────────────── */}
        <View style={CARD_STYLE}>
          <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', marginBottom: 16 }}>
            Float Allocation
          </Text>
          {(() => {
            const totalFloat = data.wallets.reduce((sum, w) => sum + Math.max(w.balance, 0), 0);
            if (totalFloat === 0) {
              return <Text style={{ color: C.text3, fontSize: 13 }}>No active float allocated yet.</Text>;
            }
            const segments = data.wallets
              .map((w) => ({ channel: w.channel, balance: Math.max(w.balance, 0), pct: (Math.max(w.balance, 0) / totalFloat) * 100 }))
              .filter((s) => s.pct > 0);

            return (
              <View>
                {/* Stacked bar */}
                <View style={{ height: 8, borderRadius: 8, backgroundColor: C.surface2, flexDirection: 'row', overflow: 'hidden', marginBottom: 16 }}>
                  {segments.map((s, idx) => (
                    <View key={idx} style={{ width: `${s.pct}%` as any, height: '100%', backgroundColor: getWalletTheme(s.channel).segmentColor }} />
                  ))}
                </View>
                {/* Legend */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {segments.map((s, idx) => {
                    const theme = getWalletTheme(s.channel);
                    return (
                      <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: '46%' }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.segmentColor }} />
                        <View>
                          <Text style={{ color: C.text1, fontSize: 11, fontWeight: '700' }}>
                            {theme.label} <Text style={{ color: C.text3 }}>({s.pct.toFixed(0)}%)</Text>
                          </Text>
                          <Text style={{ color: C.text3, fontSize: 10 }}>
                            ₱{s.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })()}
        </View>

        {/* ── Multi-Timeframe Earnings Summary Section ──────────────── */}
        <View style={CARD_STYLE}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <Calendar size={14} color={C.accent} />
            <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }}>
              Earnings Summary
            </Text>
          </View>

          {/* Summary Cards */}
          <View style={{ gap: 10 }}>
            {/* Today */}
            <View style={{ backgroundColor: C.surface2, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>Today</Text>
                <Text style={{ color: C.text1, fontSize: 16, fontWeight: '800', marginTop: 2 }}>
                  ₱{(data.earningsSummary?.today?.netProfit ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.success, fontSize: 11, fontWeight: '700' }}>
                  Gross: ₱{(data.earningsSummary?.today?.grossProfit ?? data.todayProfit).toLocaleString('en-US')}
                </Text>
                <Text style={{ color: C.danger, fontSize: 10, marginTop: 2 }}>
                  Exp: ₱{(data.earningsSummary?.today?.expenses ?? 0).toLocaleString('en-US')}
                </Text>
              </View>
            </View>

            {/* 7 Days (This Week) */}
            <View style={{ backgroundColor: C.surface2, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>This Week (7 Days)</Text>
                <Text style={{ color: C.text1, fontSize: 16, fontWeight: '800', marginTop: 2 }}>
                  ₱{(data.earningsSummary?.week?.netProfit ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.success, fontSize: 11, fontWeight: '700' }}>
                  Gross: ₱{(data.earningsSummary?.week?.grossProfit ?? 0).toLocaleString('en-US')}
                </Text>
                <Text style={{ color: C.danger, fontSize: 10, marginTop: 2 }}>
                  Exp: ₱{(data.earningsSummary?.week?.expenses ?? 0).toLocaleString('en-US')}
                </Text>
              </View>
            </View>

            {/* 30 Days (This Month) */}
            <View style={{ backgroundColor: C.surface2, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>This Month (30 Days)</Text>
                <Text style={{ color: C.accent, fontSize: 16, fontWeight: '800', marginTop: 2 }}>
                  ₱{(data.earningsSummary?.month?.netProfit ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.success, fontSize: 11, fontWeight: '700' }}>
                  Gross: ₱{(data.earningsSummary?.month?.grossProfit ?? 0).toLocaleString('en-US')}
                </Text>
                <Text style={{ color: C.danger, fontSize: 10, marginTop: 2 }}>
                  Exp: ₱{(data.earningsSummary?.month?.expenses ?? 0).toLocaleString('en-US')}
                </Text>
              </View>
            </View>

            {/* Custom N-Days Dropdown Card */}
            <View style={{ backgroundColor: C.surface2, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(230,168,23,0.3)' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                  <SlidersHorizontal size={12} color={C.accent} />
                  <Text style={{ color: C.accent, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }} numberOfLines={1}>
                    Custom Range Summary
                  </Text>
                </View>

                {/* Dropdown Selector Button */}
                <TouchableOpacity
                  onPress={async () => {
                    if (process.env.EXPO_OS !== 'web') {
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                    setCustomInputText(customDays.toString());
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
                    {customDays} Days
                  </Text>
                  <ChevronDown size={13} color={C.accent} />
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={{ color: C.text1, fontSize: 15, fontWeight: '800' }}>
                    ₱{customNDaySummary.netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={{ color: C.text3, fontSize: 10, marginTop: 1 }}>
                    Total Net Profit in last {customDays} days
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: C.success, fontSize: 11, fontWeight: '700' }}>
                    Gross: ₱{customNDaySummary.grossProfit.toLocaleString('en-US')}
                  </Text>
                  <Text style={{ color: C.danger, fontSize: 10, marginTop: 2 }}>
                    Exp: ₱{customNDaySummary.expenses.toLocaleString('en-US')}
                  </Text>
                </View>
              </View>
            </View>

          </View>
        </View>

        {/* ── Dynamic Interactive Profit Chart ─────────────────────── */}
        <View style={CARD_STYLE}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <BarChart2 size={14} color={C.accent} />
              <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }} numberOfLines={1}>
                Profit Trend
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

          <Text style={{ color: C.text3, fontSize: 10, marginBottom: 14 }}>
            💡 Tap any day bar below to view daily fees, expenses, and net profit.
          </Text>

          {/* Scrollable Bar Chart */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, paddingTop: 10, gap: activeDailyProfits.length > 14 ? 8 : 12, minWidth: '100%' }}>
              {activeDailyProfits.map((day, idx) => {
                const maxProfit = Math.max(...activeDailyProfits.map(d => d.grossProfit || d.profit || 0), 100);
                const dayProfit = day.grossProfit || day.profit || 0;
                const heightPct = Math.min((dayProfit / maxProfit) * 100, 100);
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
                        backgroundColor: isSelected ? C.accent : isToday ? 'rgba(230,168,23,0.6)' : C.surface2,
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
            <View style={{ backgroundColor: C.surface2, borderRadius: 16, padding: 14, marginTop: 16, borderWidth: 1, borderColor: 'rgba(230,168,23,0.3)' }}>
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
                  <Text style={{ color: C.text3, fontSize: 9, textTransform: 'uppercase', fontWeight: '700' }}>Gross Fee</Text>
                  <Text style={{ color: C.success, fontSize: 14, fontWeight: '800', marginTop: 2 }}>
                    ₱{(selectedDayInfo.grossProfit || selectedDayInfo.profit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
                <View style={{ flex: 1, backgroundColor: C.surface, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ color: C.text3, fontSize: 9, textTransform: 'uppercase', fontWeight: '700' }}>Expenses</Text>
                  <Text style={{ color: C.danger, fontSize: 14, fontWeight: '800', marginTop: 2 }}>
                    ₱{(selectedDayInfo.expenses || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
                <View style={{ flex: 1, backgroundColor: C.surface, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.border }}>
                  <Text style={{ color: C.text3, fontSize: 9, textTransform: 'uppercase', fontWeight: '700' }}>Net Profit</Text>
                  <Text style={{ color: (selectedDayInfo.netProfit ?? ((selectedDayInfo.grossProfit || selectedDayInfo.profit || 0) - (selectedDayInfo.expenses || 0))) >= 0 ? C.accent : C.danger, fontSize: 14, fontWeight: '800', marginTop: 2 }}>
                    ₱{(selectedDayInfo.netProfit ?? ((selectedDayInfo.grossProfit || selectedDayInfo.profit || 0) - (selectedDayInfo.expenses || 0))).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
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

          {data.recentTransactions.length === 0 ? (
            <View style={{ paddingVertical: 28, alignItems: 'center' }}>
              <Text style={{ color: C.text3, fontSize: 13 }}>No transactions logged today yet.</Text>
            </View>
          ) : (
            data.recentTransactions.map((tx, idx) => {
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
                      style={{ padding: 8 }}
                    >
                      <Pencil size={14} color={C.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteTx(tx)}
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
                      } else if (opt.days === 14) {
                        setTimeframe('14d');
                      } else if (opt.days === 30) {
                        setTimeframe('30d');
                      } else {
                        setTimeframe('custom');
                        setCustomDays(opt.days);
                      }
                      setSelectedDayKey(null);
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
                      if (num === 7) setTimeframe('7d');
                      else if (num === 14) setTimeframe('14d');
                      else if (num === 30) setTimeframe('30d');
                      else {
                        setTimeframe('custom');
                        setCustomDays(num);
                      }
                      setSelectedDayKey(null);
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
