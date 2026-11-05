import { Tabs } from 'expo-router';
import { 
  Home, 
  PlusCircle, 
  Users, 
  History, 
  Settings 
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ledgerColors as C } from '@/theme/ledger';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
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
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '700',
          marginTop: 1,
          letterSpacing: 0.1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Home size={size || 20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="entry"
        options={{
          title: 'Quick Entry',
          tabBarIcon: ({ color, size }) => <PlusCircle size={size || 20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="debtors"
        options={{
          title: 'Debtors',
          tabBarIcon: ({ color, size }) => <Users size={size || 20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <History size={size || 20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="data"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings size={size || 20} color={color} />,
        }}
      />
    </Tabs>
  );
}
