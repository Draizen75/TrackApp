import React from 'react';
import { act, create } from 'react-test-renderer';
import { Animated, Pressable } from 'react-native';
import { ToastNotice, ToastProvider, useToast, type ToastType } from '@/components/toast';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('lucide-react-native', () => ({
  AlertTriangle: () => null,
  CheckCircle2: () => null,
  Info: () => null,
  X: () => null,
}));

function ToastTrigger({ type = 'info' }: { type?: ToastType }) {
  const { showToast } = useToast();
  return React.createElement(Pressable, {
    testID: 'show-toast',
    onPress: () => showToast('Payment is being recorded.', type),
  });
}

describe('toast notifications', () => {
  let renderer: ReturnType<typeof create> | undefined;

  beforeEach(() => {
    jest.spyOn(Animated, 'parallel').mockImplementation(() => ({
      start: callback => callback?.({ finished: true }),
      stop: () => {},
      reset: () => {},
    }));
  });

  const mount = (element: React.ReactElement) => {
    act(() => {
      renderer = create(element);
    });
  };

  const getRenderer = () => {
    if (!renderer) throw new Error('Toast test renderer has not been mounted.');
    return renderer;
  };

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = undefined;
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    ['success', 'Saved successfully'],
    ['error', 'Something went wrong'],
    ['info', 'Notice'],
  ] as const)('renders an accessible %s notice with a dismiss action', (type, title) => {
    const onDismiss = jest.fn();
    mount(
      React.createElement(ToastNotice, {
        message: 'Payment could not be recorded.',
        type,
        onDismiss,
      })
    );

    expect(getRenderer().root.findByProps({ accessibilityRole: 'alert' })).toBeTruthy();
    expect(getRenderer().root.findByProps({ children: title })).toBeTruthy();
    expect(getRenderer().root.findByProps({ children: 'Payment could not be recorded.' })).toBeTruthy();

    act(() => {
      getRenderer().root.findByProps({ accessibilityLabel: 'Dismiss notification' }).props.onPress();
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows a provider notification and dismisses it when requested', () => {
    mount(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(ToastTrigger)
      )
    );

    act(() => {
      getRenderer().root.findByProps({ testID: 'show-toast' }).props.onPress();
    });

    expect(getRenderer().root.findByProps({ accessibilityRole: 'alert' })).toBeTruthy();
    expect(getRenderer().root.findByProps({ children: 'Payment is being recorded.' })).toBeTruthy();

    act(() => {
      getRenderer().root.findByProps({ accessibilityLabel: 'Dismiss notification' }).props.onPress();
    });

    expect(getRenderer().root.findAllByProps({ testID: 'toast-notice' })).toHaveLength(0);
  });

  it('keeps error notifications visible longer than standard notifications', () => {
    jest.useFakeTimers();
    mount(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(ToastTrigger, { type: 'error' })
      )
    );

    act(() => {
      getRenderer().root.findByProps({ testID: 'show-toast' }).props.onPress();
      jest.advanceTimersByTime(4999);
    });
    expect(getRenderer().root.findAllByProps({ testID: 'toast-notice' }).length).toBeGreaterThan(0);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(getRenderer().root.findAllByProps({ testID: 'toast-notice' })).toHaveLength(0);
  });

  it('restarts the timeout when a newer notification replaces the current one', () => {
    jest.useFakeTimers();
    mount(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(ToastTrigger)
      )
    );

    act(() => {
      getRenderer().root.findByProps({ testID: 'show-toast' }).props.onPress();
      jest.advanceTimersByTime(2000);
      getRenderer().root.findByProps({ testID: 'show-toast' }).props.onPress();
      jest.advanceTimersByTime(1500);
    });
    expect(getRenderer().root.findAllByProps({ testID: 'toast-notice' }).length).toBeGreaterThan(0);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(getRenderer().root.findAllByProps({ testID: 'toast-notice' })).toHaveLength(0);
  });
});
