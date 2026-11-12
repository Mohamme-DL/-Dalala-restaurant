using System;
using System.Text;

namespace DalalaRestaurantLicense
{
    // Crockford base32 (no I, L, O, U) used for machine codes and activation codes
    public static class Codec
    {
        const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

        public static string Encode(byte[] data)
        {
            var sb = new StringBuilder(); int buffer = 0, bits = 0;
            foreach (var b in data)
            {
                buffer = (buffer << 8) | b; bits += 8;
                while (bits >= 5) { sb.Append(Alphabet[(buffer >> (bits - 5)) & 31]); bits -= 5; }
                buffer &= (1 << bits) - 1;
            }
            if (bits > 0) sb.Append(Alphabet[(buffer << (5 - bits)) & 31]);
            return sb.ToString();
        }

        public static byte[] Decode(string text, int expectedBytes)
        {
            if (text == null) return null;
            var clean = new StringBuilder();
            foreach (var ch in text.ToUpperInvariant())
            {
                if (ch == '-' || ch == ' ' || ch == '\r' || ch == '\n' || ch == '\t') continue;
                var c = ch == 'O' ? '0' : (ch == 'I' || ch == 'L') ? '1' : ch;
                clean.Append(c);
            }
            var s = clean.ToString();
            var outBytes = new byte[(s.Length * 5) / 8]; int buffer = 0, bits = 0, idx = 0;
            foreach (var c in s)
            {
                int v = Alphabet.IndexOf(c); if (v < 0) return null;
                buffer = (buffer << 5) | v; bits += 5;
                if (bits >= 8) { if (idx < outBytes.Length) outBytes[idx++] = (byte)((buffer >> (bits - 8)) & 255); bits -= 8; buffer &= (1 << bits) - 1; }
            }
            if (outBytes.Length != expectedBytes) return null;
            return outBytes;
        }

        public static string Group(string s, int size)
        {
            var sb = new StringBuilder();
            for (int i = 0; i < s.Length; i += size) { if (i > 0) sb.Append('-'); sb.Append(s.Substring(i, Math.Min(size, s.Length - i))); }
            return sb.ToString();
        }
    }
}
