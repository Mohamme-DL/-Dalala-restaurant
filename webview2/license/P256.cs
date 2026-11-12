using System;
using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;

namespace DalalaRestaurantLicense
{
    // ECDSA over NIST P-256 with SHA-256 (raw r||s signatures, 64 bytes), implemented with BigInteger
    internal static class P256
    {
        static BigInteger H(string hex) { return BigInteger.Parse("0" + hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture); }
        static readonly BigInteger P = H("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
        static readonly BigInteger A = P - 3;
        static readonly BigInteger B = H("5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");
        static readonly BigInteger N = H("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
        static readonly BigInteger Gx = H("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296");
        static readonly BigInteger Gy = H("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5");

        struct Pt { public BigInteger X, Y; public bool Inf; }

        static BigInteger Mod(BigInteger x, BigInteger m) { var r = x % m; return r.Sign < 0 ? r + m : r; }
        static BigInteger Inv(BigInteger x, BigInteger m) { return BigInteger.ModPow(Mod(x, m), m - 2, m); }

        static Pt Add(Pt p, Pt q)
        {
            if (p.Inf) return q; if (q.Inf) return p;
            BigInteger l;
            if (p.X == q.X)
            {
                if (Mod(p.Y + q.Y, P).IsZero) return new Pt { Inf = true };
                l = Mod((3 * p.X * p.X + A) * Inv(2 * p.Y, P), P);
            }
            else l = Mod((q.Y - p.Y) * Inv(q.X - p.X, P), P);
            var x = Mod(l * l - p.X - q.X, P);
            var y = Mod(l * (p.X - x) - p.Y, P);
            return new Pt { X = x, Y = y };
        }

        static Pt Mul(BigInteger k, Pt p)
        {
            var r = new Pt { Inf = true }; var a = p;
            while (!k.IsZero) { if (!k.IsEven) r = Add(r, a); a = Add(a, a); k >>= 1; }
            return r;
        }

        public static BigInteger FromBytes(byte[] be)
        {
            var t = new byte[be.Length + 1];
            for (int i = 0; i < be.Length; i++) t[i] = be[be.Length - 1 - i];
            return new BigInteger(t);
        }
        public static byte[] ToBytes32(BigInteger v)
        {
            var le = v.ToByteArray(); var o = new byte[32];
            for (int i = 0; i < 32 && i < le.Length; i++) o[31 - i] = le[i];
            return o;
        }
        static byte[] Sha(byte[] data) { using (var s = SHA256.Create()) return s.ComputeHash(data); }

        static bool OnCurve(BigInteger x, BigInteger y)
        {
            return Mod(y * y - (x * x * x + A * x + B), P).IsZero && x.Sign >= 0 && x < P && y.Sign >= 0 && y < P;
        }

        public static bool Verify(byte[] pub64, byte[] message, byte[] sig64)
        {
            try
            {
                if (pub64 == null || pub64.Length != 64 || sig64 == null || sig64.Length != 64) return false;
                var qx = FromBytes(Slice(pub64, 0, 32)); var qy = FromBytes(Slice(pub64, 32, 32));
                if (!OnCurve(qx, qy)) return false;
                var r = FromBytes(Slice(sig64, 0, 32)); var s = FromBytes(Slice(sig64, 32, 32));
                if (r.Sign <= 0 || s.Sign <= 0 || r >= N || s >= N) return false;
                var e = FromBytes(Sha(message));
                var w = Inv(s, N);
                var u1 = Mod(e * w, N); var u2 = Mod(r * w, N);
                var g = new Pt { X = Gx, Y = Gy }; var q = new Pt { X = qx, Y = qy };
                var pt = Add(Mul(u1, g), Mul(u2, q));
                if (pt.Inf) return false;
                return Mod(pt.X, N) == r;
            }
            catch { return false; }
        }

        public static byte[] Sign(byte[] priv32, byte[] message)
        {
            var d = FromBytes(priv32);
            var e = FromBytes(Sha(message));
            var g = new Pt { X = Gx, Y = Gy };
            using (var rng = RandomNumberGenerator.Create())
            {
                while (true)
                {
                    var kb = new byte[32]; rng.GetBytes(kb);
                    var k = FromBytes(kb);
                    if (k.Sign <= 0 || k >= N) continue;
                    var rp = Mul(k, g); var r = Mod(rp.X, N);
                    if (r.IsZero) continue;
                    var s = Mod(Inv(k, N) * (e + r * d), N);
                    if (s.IsZero) continue;
                    var o = new byte[64];
                    Array.Copy(ToBytes32(r), 0, o, 0, 32); Array.Copy(ToBytes32(s), 0, o, 32, 32);
                    return o;
                }
            }
        }

        public static byte[] PublicFromPrivate(byte[] priv32)
        {
            var q = Mul(FromBytes(priv32), new Pt { X = Gx, Y = Gy });
            var o = new byte[64];
            Array.Copy(ToBytes32(q.X), 0, o, 0, 32); Array.Copy(ToBytes32(q.Y), 0, o, 32, 32);
            return o;
        }

        static byte[] Slice(byte[] a, int i, int n) { var o = new byte[n]; Array.Copy(a, i, o, 0, n); return o; }
    }
}
