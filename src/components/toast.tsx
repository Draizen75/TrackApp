import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, Animated, Pressable } from 'react-native';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ledgerColors as C } from '@/theme/ledger';

export type ToastType = 'success' | 'error' | 'info';

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

type ToastNoticeProps = {
  message: string;
  type: ToastType;
  onDismiss?: () => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

function getToastColors(type: ToastType) {
  switch (type) {
    case 'success':
      return {
        border: 'rgba(32,200,117,0.55)',
        text: C.success,
        iconBg: C.successDim,
        title: 'Saved successfully',
        icon: <CheckCircle2 size={17} color={C.success} />,
      };
    case 'error':
      return {
        border: 'rgba(239,68,68,0.55)',
        text: '#fca5a5',
        iconBg: C.dangerDim,
        title: 'Something went wrong',
        icon: <AlertTriangle size={17} color={C.danger} />,
      };
    case 'info':
      return {
        border: 'rgba(255,209,102,0.55)',
        text: C.accent,
        iconBg: C.accentDim,
        title: 'Notice',
        icon: <Info size={17} color={C.accent} />,
      };
  }
}

export function ToastNotice({ message, type, onDismiss }: ToastNoticeProps) {
  const colors = getToastColors(type);

  return (
    <View
      testID="toast-notice"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: C.surface,
        boxShadow: '0 8px 26px rgba(0,0,0,0.42)',
      }}
    >
      <View style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.iconBg,
      }}>
        {colors.icon}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
          {colors.title}
        </Text>
        <Text style={{ color: C.text2, fontSize: 12, fontWeight: '500', lineHeight: 17 }}>
          {message}
        </Text>
      </View>
      {onDismiss && (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          hitSlop={8}
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={16} color={C.text3} />
        </Pressable>
      )}
    </View>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('success');
  const [visible, setVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [slideAnim] = useState(() => new Animated.Value(-24));
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -24,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }, [fadeAnim, slideAnim]);

  const showToast = useCallback((msg: string, type: ToastType = 'success') => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    fadeAnim.stopAnimation();
    slideAnim.stopAnimation();
    setMessage(msg);
    setToastType(type);
    setVisible(true);
    fadeAnim.setValue(0);
    slideAnim.setValue(-24);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      dismissToast();
    }, type === 'error' ? 5000 : 3500);
  }, [dismissToast, fadeAnim, slideAnim]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {visible && (
        <Animated.View
          style={{
            position: 'absolute',
            top: insets.top + 10,
            left: 16,
            right: 16,
            zIndex: 9999,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
          <ToastNotice message={message} type={toastType} onDismiss={dismissToast} />
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}
