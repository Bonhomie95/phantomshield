import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontSize } from '@/constants/theme';
export default function ModalScreen() {
  return (
    <View style={s.c}>
      <Text style={s.t}>Modal</Text>
    </View>
  );
}
const s = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  t: { fontSize: FontSize.lg, color: Colors.textPrimary },
});
