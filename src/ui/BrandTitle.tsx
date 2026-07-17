import { StyleSheet, Text, View } from "react-native";

/**
 * Wordmark for 不白刷 — Liu Jian Mao Cao, flat pure white.
 */
export function BrandTitle() {
  return (
    <View style={styles.wrap} accessibilityRole="header">
      <Text allowFontScaling={false} style={styles.mark}>
        不白刷
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "flex-start",
  },
  mark: {
    fontFamily: "LiuJianMaoCao_400Regular",
    fontSize: 48,
    lineHeight: 58,
    color: "#FFFFFF",
    letterSpacing: 2,
  },
});
