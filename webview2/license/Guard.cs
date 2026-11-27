using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace DalalaRestaurantLicense
{
    public static class Guard
    {
        // Public verification key (P-256). The matching private key is held only by the vendor.
        static readonly string PubHex = "0269cd0b65558f9421a26c9d0e7e748a436568ed135f2ab30d7d43fc85ce6335e282d689ae6fc12df29f8e10fa483af1e4ccc4e760b7244302ed5f5534c1415d";
        const string Product = "DLALA-RESTAURANT";

        static byte[] Hex(string h) { var o = new byte[h.Length / 2]; for (int i = 0; i < o.Length; i++) o[i] = Convert.ToByte(h.Substring(i * 2, 2), 16); return o; }
        static string HexOf(byte[] b) { var sb = new StringBuilder(); foreach (var x in b) sb.Append(x.ToString("x2")); return sb.ToString(); }

        public static string Normalize(string code)
        {
            if (code == null) return "";
            var sb = new StringBuilder();
            foreach (var ch in code.ToUpperInvariant()) if (ch != '-' && ch != ' ' && ch != '\r' && ch != '\n' && ch != '\t') sb.Append(ch);
            return sb.ToString();
        }

        // ---- machine fingerprint ----
        public static string ComputeFingerprint(string machineGuid, string cpuId, string boardSerial)
        {
            var text = "DLALA-FP|" + (machineGuid ?? "").Trim().ToLowerInvariant() + "|" + (cpuId ?? "").Trim().ToUpperInvariant() + "|" + (boardSerial ?? "").Trim().ToUpperInvariant();
            using (var sha = SHA256.Create())
            {
                var h = sha.ComputeHash(Encoding.UTF8.GetBytes(text)); var cut = new byte[12]; Array.Copy(h, cut, 12);
                return Codec.Group(Codec.Encode(cut), 5);
            }
        }

        static string cachedMachine;
        public static string MachineCode()
        {
            if (cachedMachine != null) return cachedMachine;
            cachedMachine = ComputeFingerprint(ReadMachineGuid(), WmiValue("Win32_Processor", "ProcessorId"), CleanSerial(WmiValue("Win32_BaseBoard", "SerialNumber")));
            return cachedMachine;
        }

        static string ReadMachineGuid()
        {
            try
            {
                using (var b = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, Microsoft.Win32.RegistryView.Registry64))
                using (var k = b.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                { var v = k == null ? null : k.GetValue("MachineGuid"); return v == null ? "" : v.ToString(); }
            }
            catch { return ""; }
        }

        static string CleanSerial(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "";
            var t = s.Trim().ToUpperInvariant();
            if (t.Contains("O.E.M") || t.Contains("DEFAULT") || t.Contains("NONE") || t.Contains("NOT SPECIFIED") || t.Contains("SERIAL") || t == "0" || t.Replace("0", "").Replace("-", "").Replace(".", "").Length == 0) return "";
            return t;
        }

        static string WmiValue(string cls, string prop)
        {
            try
            {
                using (var searcher = new System.Management.ManagementObjectSearcher("SELECT " + prop + " FROM " + cls))
                    foreach (System.Management.ManagementBaseObject o in searcher.Get()) { var v = o[prop]; if (v != null && v.ToString().Trim().Length > 0) return v.ToString().Trim(); }
            }
            catch { }
            return "";
        }

        // ---- activation ----
        static byte[] ActivationMessage(string machineCode) { return Encoding.UTF8.GetBytes(Product + "|1|" + Normalize(machineCode)); }

        public static string MakeActivationText(string machineCode, byte[] signature)
        { return Codec.Group(Codec.Encode(signature), 5); }

        public static bool VerifyActivation(string machineCode, string activationCode)
        {
            var sig = Codec.Decode(activationCode, 64);
            if (sig == null) return false;
            return P256.Verify(Hex(PubHex), ActivationMessage(machineCode), sig);
        }

        static string[] LicensePaths()
        {
            return new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "DalalaRestaurant", "license.dat"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DalalaRestaurant", "license.dat")
            };
        }

        public static string StoredCode()
        {
            foreach (var p in LicensePaths()) { try { if (File.Exists(p)) { var t = File.ReadAllText(p).Trim(); if (t.Length > 0) return t; } } catch { } }
            return "";
        }

        static DateTime lastCheck = DateTime.MinValue; static bool lastResult;
        public static bool IsActivated()
        {
            if ((DateTime.UtcNow - lastCheck).TotalSeconds < 30 && lastCheck != DateTime.MinValue) return lastResult;
            lastResult = VerifyActivation(MachineCode(), StoredCode()); lastCheck = DateTime.UtcNow; return lastResult;
        }

        public static bool Activate(string activationCode)
        {
            if (!VerifyActivation(MachineCode(), activationCode)) return false;
            var text = Codec.Group(Normalize(activationCode), 5); bool saved = false;
            foreach (var p in LicensePaths())
            {
                try { Directory.CreateDirectory(Path.GetDirectoryName(p)); File.WriteAllText(p, text); saved = true; break; } catch { }
            }
            lastCheck = DateTime.MinValue;
            return saved;
        }

        // ---- file integrity (signed manifest) ----
        public static bool VerifyManifestText(string manifestText, string root, out string problem)
        {
            problem = "";
            try
            {
                var lines = manifestText.Replace("\r\n", "\n").Split(new[] { '\n' }); var body = new StringBuilder(); string sigText = null;
                foreach (var line in lines)
                {
                    if (line.StartsWith("SIG|")) { sigText = line.Substring(4).Trim(); break; }
                    if (line.Length > 0) body.Append(line).Append('\n');
                }
                var sig = Codec.Decode(sigText, 64);
                if (sig == null || !P256.Verify(Hex(PubHex), Encoding.UTF8.GetBytes(body.ToString()), sig)) { problem = "توقيع قائمة الملفات غير صالح"; return false; }
                using (var sha = SHA256.Create())
                    foreach (var line in body.ToString().Split(new[] { '\n' }))
                    {
                        if (line.Length == 0) continue; var i = line.LastIndexOf('|'); if (i < 1) continue;
                        var rel = line.Substring(0, i); var want = line.Substring(i + 1).Trim().ToLowerInvariant();
                        var full = Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar));
                        if (!File.Exists(full)) { problem = "ملف مفقود: " + rel; return false; }
                        string got; using (var fs = File.OpenRead(full)) got = HexOf(sha.ComputeHash(fs));
                        if (got != want) { problem = "ملف معدَّل: " + rel; return false; }
                    }
                return true;
            }
            catch (Exception ex) { problem = ex.Message; return false; }
        }

        public static bool VerifyFiles(string root, out string problem)
        {
            problem = "";
            try
            {
                var m = Path.Combine(root, "license.manifest");
                if (!File.Exists(m)) { problem = "ملف التحقق مفقود"; return false; }
                return VerifyManifestText(File.ReadAllText(m, Encoding.UTF8), root, out problem);
            }
            catch (Exception ex) { problem = ex.Message; return false; }
        }
    }
}
