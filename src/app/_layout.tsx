import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { migrateDbIfNeeded } from '@/db/db';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ToastProvider } from '@/components/toast';
import '../global.css';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  if (process.env.EXPO_OS === 'web') {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <ToastProvider>
            <AnimatedSplashOverlay />
            <Stack screenOptions={{ headerShown: false }} />
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SQLite.SQLiteProvider 
        databaseName="store.db" 
        onInit={migrateDbIfNeeded} 
        useSuspense={false}
      >
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <ToastProvider>
            <AnimatedSplashOverlay />
            <Stack screenOptions={{ headerShown: false }} />
          </ToastProvider>
        </ThemeProvider>
      </SQLite.SQLiteProvider>
    </QueryClientProvider>
  );
}
