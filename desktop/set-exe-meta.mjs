// Sets the app icon + version info on the Windows .exe without Wine (pure JS PE editing).
import * as ResEdit from 'resedit';
import fs from 'fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const exePath = `dist/win-unpacked/${pkg.productName}.exe`;
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync('build/icon.ico'));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const [a, b, c] = pkg.version.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  ProductName: pkg.productName, FileDescription: pkg.description,
  CompanyName: 'Dalala', LegalCopyright: '© Dalala', OriginalFilename: `${pkg.productName}.exe`, InternalName: pkg.name,
});
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('exe icon + version info updated:', exePath);
