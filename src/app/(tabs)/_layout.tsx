import { Tabs } from 'expo-router';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import {
  Home,
  PlusCircle,
  Users,
  History,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  WalletCards,
} from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ledgerColors as C } from '@/theme/ledger';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= 1024;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const sidebarWidth = isSidebarCollapsed ? 76 : 224;

  return (
    <Tabs
      tabBar={(props) => isDesktopWeb ? (
        <View style={{
          width: sidebarWidth,
          minWidth: sidebarWidth,
          maxWidth: sidebarWidth,
          height: '100%',
          backgroundColor: C.surface,
          borderRightWidth: 1,
          borderRightColor: C.border,
          paddingTop: 18,
          paddingHorizontal: isSidebarCollapsed ? 10 : 14,
        }}>
          <View style={{
            minHeight: 54,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: isSidebarCollapsed ? 'center' : 'space-between',
            paddingHorizontal: isSidebarCollapsed ? 0 : 8,
            marginBottom: 20,
          }}>
            {!isSidebarCollapsed && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <WalletCards size={21} color={C.accent} />
                <Text style={{ color: C.text1, fontSize: 15, fontWeight: '900', letterSpacing: 1.2 }}>TRACK<Text style={{ color: C.accent }}>APP</Text></Text>
              </View>
            )}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              accessibilityHint="Changes the desktop navigation width"
              onPress={() => setIsSidebarCollapsed((current) => !current)}
              style={{
                width: 38,
                height: 38,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                backgroundColor: C.surface2,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              {isSidebarCollapsed
                ? <PanelLeftOpen size={18} color={C.text2} />
                : <PanelLeftClose size={18} color={C.text2} />}
            </TouchableOpacity>
          </View>
          <BottomTabBar {...props} />
          {!isSidebarCollapsed && (
            <View style={{ marginTop: 'auto', paddingHorizontal: 10, paddingVertical: 18, borderTopWidth: 1, borderTopColor: C.border }}>
              <Text style={{ color: C.text3, fontSize: 10, fontWeight: '700', letterSpacing: 1 }}>PERSONAL LEDGER</Text>
              <Text style={{ color: C.text3, fontSize: 10, marginTop: 5 }}>Obsidian & Gold</Text>
            </View>
          )}
        </View>
      ) : <BottomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktopWeb ? 'left' : 'bottom',
        tabBarLabelPosition: isDesktopWeb ? (isSidebarCollapsed ? 'below-icon' : 'beside-icon') : 'below-icon',
        tabBarShowLabel: !isDesktopWeb || !isSidebarCollapsed,
        tabBarStyle: isDesktopWeb
          ? {
              width: sidebarWidth - (isSidebarCollapsed ? 20 : 28),
              minWidth: sidebarWidth - (isSidebarCollapsed ? 20 : 28),
              maxWidth: sidebarWidth - (isSidebarCollapsed ? 20 : 28),
              flex: 1,
              backgroundColor: 'transparent',
              borderRightWidth: 0,
              borderTopWidth: 0,
              paddingTop: 8,
              paddingHorizontal: 0,
              elevation: 0,
            }
          : {
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: C.bg,
              height: 62 + insets.bottom,
              borderRadius: 0,
              paddingBottom: Math.max(insets.bottom, 8),
              paddingTop: 8,
              borderWidth: 0,
              borderTopWidth: 1,
              borderTopColor: C.border,
              elevation: 0,
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowOffset: { width: 0, height: -2 },
              shadowRadius: 8,
            },
        tabBarActiveTintColor: C.accent,
        tabBarActiveBackgroundColor: isDesktopWeb ? 'rgba(255,209,102,0.12)' : undefined,
        tabBarInactiveBackgroundColor: isDesktopWeb ? 'transparent' : undefined,
        tabBarInactiveTintColor: C.text3,
        tabBarLabelStyle: isDesktopWeb
          ? {
              fontSize: 13,
              fontWeight: '700',
              marginTop: 0,
              letterSpacing: 0.1,
              textAlign: 'left',
            }
          : {
              fontSize: 9,
              fontWeight: '700',
              marginTop: 1,
              letterSpacing: 0.1,
            },
        tabBarItemStyle: isDesktopWeb
          ? {
              minHeight: 48,
              borderRadius: 10,
              marginBottom: 6,
              backgroundColor: 'transparent',
              paddingHorizontal: isSidebarCollapsed ? 0 : 12,
              justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
            }
          : undefined,
        tabBarIconStyle: isDesktopWeb ? { marginRight: isSidebarCollapsed ? 0 : 12 } : undefined,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarButtonTestID: 'tab-dashboard', tabBarIcon: ({ color, size }) => <Home size={size || 20} color={color} /> }} />
      <Tabs.Screen name="entry" options={{ title: 'Quick Entry', tabBarButtonTestID: 'tab-quick-entry', tabBarHideOnKeyboard: true, tabBarIcon: ({ color, size }) => <PlusCircle size={size || 20} color={color} /> }} />
      <Tabs.Screen name="debtors" options={{ title: 'Debtors', tabBarButtonTestID: 'tab-debtors', tabBarIcon: ({ color, size }) => <Users size={size || 20} color={color} /> }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarButtonTestID: 'tab-history', tabBarIcon: ({ color, size }) => <History size={size || 20} color={color} /> }} />
      <Tabs.Screen name="data" options={{ title: 'Settings', tabBarButtonTestID: 'tab-settings', tabBarIcon: ({ color, size }) => <Settings size={size || 20} color={color} /> }} />
    </Tabs>
  );
}
