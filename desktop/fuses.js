/* electron-builder afterPack hook: harden the packaged Electron binary.
   Disables running it as plain Node, NODE_OPTIONS and --inspect, so the app's
   code cannot be started or inspected outside the licensed app. */
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
exports.default = async ctx => {
  const win = ctx.electronPlatformName === 'win32';
  const exe = path.join(ctx.appOutDir, win ? `${ctx.packager.appInfo.productFilename}.exe` : ctx.packager.executableName);
  await flipFuses(exe, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false });
};
