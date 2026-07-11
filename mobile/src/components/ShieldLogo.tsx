import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { Colors } from '@/constants/theme';

interface Props { size?: number; animated?: boolean; pulse?: boolean; style?: any }

export function ShieldLogo({ size = 60, animated = false, pulse = false, style }: Props) {
  const glowAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (animated) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
        ])
      ).start();
    }
    if (pulse) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.06, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [animated, pulse]);

  const opacity = animated
    ? glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] })
    : 1;

  return (
    <Animated.View style={[{ transform: [{ scale: pulseAnim }], opacity }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="shield" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={Colors.primary} stopOpacity="1" />
            <Stop offset="1" stopColor="#0080CC" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Path
          d="M50 8 L85 22 L85 50 C85 68 70 82 50 92 C30 82 15 68 15 50 L15 22 Z"
          fill="url(#shield)"
          opacity={0.15}
        />
        <Path
          d="M50 8 L85 22 L85 50 C85 68 70 82 50 92 C30 82 15 68 15 50 L15 22 Z"
          fill="none"
          stroke={Colors.primary}
          strokeWidth="2.5"
        />
        <Path
          d="M36 50 L46 60 L64 40"
          fill="none"
          stroke={Colors.primary}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx="50" cy="50" r="3" fill={Colors.primary} opacity={0.6} />
      </Svg>
    </Animated.View>
  );
}
export default ShieldLogo;
