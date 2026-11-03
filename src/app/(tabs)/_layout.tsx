import { Tabs } from 'expo-router';
import { 
  Home, 
  PlusCircle, 
  Users, 
  History, 
  Settings 
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ledgerColors as C, ledgerRadius } from '@/theme/ledger';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: insets.bottom > 0 ? insets.bottom + 12 : 16,
          left: 16,
          right: 16,
          backgroundColor: C.surface,
          borderTopWidth: 0,
          height: 64,
          borderRadius: ledgerRadius.sheet,
          paddingBottom: 8,
          paddingTop: 10,
          borderWidth: 1.5,
          borderColor: C.border,
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowOffset: { width: 0, height: 8 },
          shadowRadius: 16,
        },
        tabBarActiveTintColor: C.accent,
        tabBarInactiveTintColor: C.text3,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '700',
          marginTop: 2,
          letterSpacing: 0.3,
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
