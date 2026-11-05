import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

export function useScreenFocus() {
  const [isFocused, setIsFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  return isFocused;
}
