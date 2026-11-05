import { DarkTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SQLite from 'expo-sqlite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { migrateDbIfNeeded } from '@/db/db';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ToastProvider } from '@/components/toast';
import '../global.css';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Ledger writes explicitly invalidate affected queries. This prevents
      // avoidable re-queries while switching tabs without serving stale writes.
      staleTime: 2 * 60_000,
      gcTime: 10 * 60_000,
    },
  },
});

export default function RootLayout() {
  if (process.env.EXPO_OS === 'web') {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={DarkTheme}>
          <ToastProvider>
            <StatusBar style="light" />
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
        <ThemeProvider value={DarkTheme}>
          <ToastProvider>
            <StatusBar style="light" />
            <AnimatedSplashOverlay />
            <Stack screenOptions={{ headerShown: false }} />
          </ToastProvider>
        </ThemeProvider>
      </SQLite.SQLiteProvider>
    </QueryClientProvider>
  );
}
