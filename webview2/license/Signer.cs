using System;
using System.IO;
using System.Text;

namespace DalalaRestaurantLicense
{
    // Vendor-side only: NOT shipped with the product.
    public static class Signer
    {
        static byte[] Hex(string h) { h = h.Trim(); var o = new byte[h.Length / 2]; for (int i = 0; i < o.Length; i++) o[i] = Convert.ToByte(h.Substring(i * 2, 2), 16); return o; }

        public static string Activation(string machineCode, string privateKeyHex)
        {
            var msg = Encoding.UTF8.GetBytes("DLALA-RESTAURANT|1|" + Guard.Normalize(machineCode));
            return Codec.Group(Codec.Encode(P256.Sign(Hex(privateKeyHex), msg)), 5);
        }

        public static string SignManifest(string root, string[] relFiles, string privateKeyHex)
        {
            var sb = new StringBuilder();
            using (var sha = System.Security.Cryptography.SHA256.Create())
                foreach (var rel in relFiles)
                {
                    byte[] h; using (var fs = File.OpenRead(Path.Combine(root, rel))) h = sha.ComputeHash(fs);
                    var hx = new StringBuilder(); foreach (var b in h) hx.Append(b.ToString("x2"));
                    sb.Append(rel.Replace('\\', '/')).Append('|').Append(hx).Append('\n');
                }
            var sig = P256.Sign(Hex(privateKeyHex), Encoding.UTF8.GetBytes(sb.ToString()));
            return sb + "SIG|" + Codec.Group(Codec.Encode(sig), 5) + "\n";
        }

        public static string PublicKeyHex(string privateKeyHex) { var p = P256.PublicFromPrivate(Hex(privateKeyHex)); var sb = new StringBuilder(); foreach (var b in p) sb.Append(b.ToString("x2")); return sb.ToString(); }
    }
}
