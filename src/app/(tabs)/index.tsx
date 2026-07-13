import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDbQueries, Transaction } from '@/hooks/useDbQueries';
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
  AlertTriangle,
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
  const { useDashboardData, useDeleteTransaction } = useDbQueries();
  const { data, isLoading, refetch } = useDashboardData();
  const deleteTxMutation = useDeleteTransaction();

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
        contentContainerStyle={{ paddingBottom: 110 }}
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

        <View style={CARD_STYLE}>
          <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', marginBottom: 16 }}>
            Today At A Glance
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {[
              { label: 'Transactions', value: data.todayTransactionsCount },
              { label: 'Debt Added', value: `PHP ${data.debtAddedToday.toFixed(0)}` },
              { label: 'Debt Collected', value: `PHP ${data.debtCollectedToday.toFixed(0)}` },
            ].map((item, idx) => (
              <View key={item.label} style={{ width: idx === 2 ? '100%' : '48%', backgroundColor: idx === 2 ? C.bg : 'transparent', borderWidth: idx === 2 ? 1 : 0, borderColor: C.border, borderRadius: 14, padding: idx === 2 ? 12 : 0 }}>
                <Text style={{ color: C.text3, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 }}>{item.label}</Text>
                <Text style={{ color: C.text1, fontSize: idx === 2 ? 17 : 15, fontWeight: '800' }}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={CARD_STYLE}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <AlertTriangle size={13} color={C.warning} />
            <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700' }}>
              Health Check
            </Text>
          </View>
          {data.healthChecks?.length ? (
            <View style={{ gap: 10 }}>
              {data.healthChecks.map((item, idx) => (
                <View key={`${item.kind}-${idx}`} style={{ padding: 12, borderRadius: 14, borderWidth: 1, borderColor: item.severity === 'danger' ? 'rgba(220,107,90,0.3)' : 'rgba(230,168,23,0.3)', backgroundColor: item.severity === 'danger' ? C.dangerDim : C.accentDim }}>
                  <Text style={{ color: item.severity === 'danger' ? C.danger : C.accent, fontSize: 12, fontWeight: '800' }}>{item.label}</Text>
                  <Text style={{ color: C.text2, fontSize: 11, marginTop: 4 }}>{item.detail}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ color: C.text3, fontSize: 13 }}>No urgent issues detected in float or debt records.</Text>
          )}
        </View>

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

        {/* ── 7-Day Profit Chart ────────────────────────────────────── */}
        <View style={CARD_STYLE}>
          <Text style={{ color: C.text2, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '700', marginBottom: 16 }}>
            7-Day Gross Profit
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 100, paddingTop: 8 }}>
            {data.dailyProfits.map((day, idx) => {
              const maxProfit = Math.max(...data.dailyProfits.map(d => d.profit), 100);
              const heightPct = Math.min((day.profit / maxProfit) * 100, 100);
              const isToday = idx === data.dailyProfits.length - 1;
              return (
                <View key={idx} style={{ alignItems: 'center', flex: 1 }}>
                  {day.profit > 0 && (
                    <Text style={{ color: isToday ? C.accent : C.text3, fontSize: 8, fontWeight: '700', marginBottom: 4 }}>
                      ₱{day.profit.toFixed(0)}
                    </Text>
                  )}
                  <View
                    style={{
                      height: `${Math.max(heightPct, 5)}%` as any,
                      width: 28,
                      borderRadius: 6,
                      backgroundColor: isToday ? C.accent : C.surface2,
                      borderWidth: 1,
                      borderColor: isToday ? 'rgba(230,168,23,0.4)' : C.border,
                    }}
                  />
                  <Text style={{ color: C.text3, fontSize: 9, marginTop: 6, textAlign: 'center' }} numberOfLines={1}>
                    {day.date}
                  </Text>
                </View>
              );
            })}
          </View>
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
    </SafeAreaView>
  );
}
