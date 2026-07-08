import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Platform } from 'react-native';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react-native';

export type ToastType = 'success' | 'error' | 'info';

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

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
  
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [slideAnim] = useState(() => new Animated.Value(-100));
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string, type: ToastType = 'success') => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setMessage(msg);
    setToastType(type);
    setVisible(true);

    // Reset animations
    fadeAnim.setValue(0);
    slideAnim.setValue(-100);

    // Slide in and fade in
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: Platform.OS === 'ios' ? 60 : 40, // Position safely below top notch / safe area
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto dismiss after 2.5 seconds
    timeoutRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: -100,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setVisible(false);
      });
    }, 2500);
  }, [fadeAnim, slideAnim]);

  const getColors = () => {
    switch (toastType) {
      case 'success':
        return {
          bg: '#142820',
          border: 'rgba(90,155,110,0.35)',
          text: '#a2dfb4',
          icon: <CheckCircle2 size={16} color="#5a9b6e" />
        };
      case 'error':
        return {
          bg: '#2d1815',
          border: 'rgba(220,107,90,0.35)',
          text: '#f2a69c',
          icon: <AlertTriangle size={16} color="#dc6b5a" />
        };
      case 'info':
      default:
        return {
          bg: '#1c1916',
          border: 'rgba(230,168,23,0.35)',
          text: '#f7d37a',
          icon: <Info size={16} color="#e6a817" />
        };
    }
  };

  const colors = getColors();

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {visible && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
              backgroundColor: colors.bg,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.toastContent}>
            {colors.icon}
            <Text style={[styles.toastText, { color: colors.text }]}>{message}</Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toastText: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    lineHeight: 16,
  },
});
