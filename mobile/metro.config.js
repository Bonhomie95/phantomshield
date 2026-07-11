// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// The mobile app is a self-contained (non-workspace) install, but it links
// @phantomshield/shared via a file: dependency whose real files live in
// ../packages/shared. Metro must watch that folder to bundle it.
config.watchFolders = [path.resolve(workspaceRoot, 'packages/shared')];

// Resolve modules ONLY from the app's own node_modules. This keeps Metro from
// reaching into the workspace root (e.g. the dashboard's React 18) and mixing
// React versions.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

// Only src/app is the router root (set in app.json). Keep non-route source out.
config.resolver.blockList = [
  /src[\/\\]scripts[\/\\].*/,
];

module.exports = config;
