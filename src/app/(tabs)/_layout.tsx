import { Tabs } from 'expo-router';
import {
  Home,
  PlusCircle,
  Users,
  History,
  Settings,
} from 'lucide-react-native';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ledgerColors as C } from '@/theme/ledger';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === 'web' && width >= 1024;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktopWeb ? 'left' : 'bottom',
        tabBarLabelPosition: isDesktopWeb ? 'beside-icon' : 'below-icon',
        tabBarStyle: isDesktopWeb
          ? {
              width: 236,
              backgroundColor: C.surface,
              borderRightWidth: 1,
              borderRightColor: C.border,
              borderTopWidth: 0,
              paddingTop: 28,
              paddingHorizontal: 14,
              elevation: 0,
              shadowColor: '#000',
              shadowOpacity: 0.16,
              shadowOffset: { width: 2, height: 0 },
              shadowRadius: 16,
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
              borderRadius: 12,
              marginBottom: 6,
              paddingHorizontal: 12,
              justifyContent: 'flex-start',
            }
          : undefined,
        tabBarIconStyle: isDesktopWeb ? { marginRight: 12 } : undefined,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarButtonTestID: 'tab-dashboard',
          tabBarIcon: ({ color, size }) => <Home size={size || 20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="entry"
        options={{
          title: 'Quick Entry',
          tabBarButtonTestID: 'tab-quick-entry',
          tabBarHideOnKeyboard: true,
          tabBarIcon: ({ color, size }) => <PlusCircle size={size || 20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="debtors"
        options={{
          title: 'Debtors',
          tabBarButtonTestID: 'tab-debtors',
          tabBarIcon: ({ color, size }) => <Users size={size || 20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarButtonTestID: 'tab-history',
          tabBarIcon: ({ color, size }) => <History size={size || 20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="data"
        options={{
          title: 'Settings',
          tabBarButtonTestID: 'tab-settings',
          tabBarIcon: ({ color, size }) => <Settings size={size || 20} color={color} />,
        }}
      />
    </Tabs>
  );
}
