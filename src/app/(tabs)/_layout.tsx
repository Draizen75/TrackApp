import { Tabs } from 'expo-router';
import { 
  Home, 
  PlusCircle, 
  Users, 
  TrendingDown, 
  Settings 
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
          backgroundColor: '#0e0c0b',
          borderTopWidth: 0,
          height: 64,
          borderRadius: 22,
          paddingBottom: 8,
          paddingTop: 10,
          borderWidth: 1.5,
          borderColor: '#2d2920',
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowOffset: { width: 0, height: 8 },
          shadowRadius: 16,
        },
        tabBarActiveTintColor: '#e6a817',
        tabBarInactiveTintColor: '#6b6158',
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
        name="expenses"
        options={{
          title: 'Expenses',
          tabBarIcon: ({ color, size }) => <TrendingDown size={size || 20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="data"
        options={{
          title: 'Admin',
          tabBarIcon: ({ color, size }) => <Settings size={size || 20} color={color} />,
        }}
      />
    </Tabs>
  );
}
