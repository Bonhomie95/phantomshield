/**
 * app.json holds the config; this only adjusts it per EAS build profile.
 *
 * Preview builds are APKs sideloaded onto testers' phones. Every phone sold in
 * years is 64-bit ARM, so shipping only arm64-v8a roughly halves the download.
 * Store builds are app bundles, which Google Play already splits per device.
 */
module.exports = ({ config }) => {
  if (process.env.EAS_BUILD_PROFILE !== 'preview') return config;
  return {
    ...config,
    plugins: config.plugins.map((p) =>
      Array.isArray(p) && p[0] === 'expo-build-properties'
        ? [p[0], { ...p[1], android: { ...p[1].android, buildArchs: ['arm64-v8a'] } }]
        : p,
    ),
  };
};
