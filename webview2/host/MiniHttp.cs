using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace DalalaRestaurant
{
    public class HttpReq
    {
        public string Method = "", Path = "/", RemoteIp = "";
        public Dictionary<string, string> Query = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public byte[] Body = new byte[0];
        public string Header(string k) { string v; return Headers.TryGetValue(k, out v) ? v : ""; }
        public string Q(string k) { string v; return Query.TryGetValue(k, out v) ? v : ""; }
    }

    public class HttpRes
    {
        readonly Stream s; public bool Sent;
        public HttpRes(Stream s) { this.s = s; }
        public void Send(int code, string contentType, byte[] body, IDictionary<string, string> extra)
        {
            if (Sent) return; Sent = true;
            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(code).Append(' ').Append(Reason(code)).Append("\r\n");
            sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
            sb.Append("Content-Length: ").Append(body == null ? 0 : body.Length).Append("\r\n");
            sb.Append("Connection: close\r\n");
            if (extra != null) foreach (var kv in extra) sb.Append(kv.Key).Append(": ").Append(kv.Value).Append("\r\n");
            sb.Append("\r\n");
            var head = Encoding.UTF8.GetBytes(sb.ToString());
            s.Write(head, 0, head.Length);
            if (body != null && body.Length > 0) s.Write(body, 0, body.Length);
            s.Flush();
        }
        static string Reason(int c) { switch (c) { case 200: return "OK"; case 204: return "No Content"; case 302: return "Found"; case 400: return "Bad Request"; case 401: return "Unauthorized"; case 404: return "Not Found"; case 409: return "Conflict"; case 500: return "Server Error"; default: return "OK"; } }
    }

    /// <summary>Very small HTTP/1.1 server (one thread per connection, Connection: close). No URL ACL / admin rights needed.</summary>
    public class MiniHttp
    {
        readonly TcpListener listener; readonly Action<HttpReq, HttpRes> handler; volatile bool running; Thread acceptThread;
        readonly List<TcpClient> open = new List<TcpClient>();
        public const int MaxBody = 200 * 1024 * 1024;
        public static volatile string LastError = "";
        public static volatile int Served = 0;

        public MiniHttp(IPAddress bind, int port, Action<HttpReq, HttpRes> handler)
        { listener = new TcpListener(bind, port); this.handler = handler; }

        public void Start()
        {
            listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, false);
            listener.Start(); running = true;
            acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "dalala-http-accept" };
            acceptThread.Start();
        }

        public void Stop()
        {
            running = false;
            try { listener.Stop(); } catch { }
            lock (open) { foreach (var c in open) { try { c.Close(); } catch { } } open.Clear(); }
        }

        void AcceptLoop()
        {
            while (running)
            {
                TcpClient c;
                try { c = listener.AcceptTcpClient(); } catch { if (!running) return; continue; }
                lock (open) open.Add(c);
                var t = new Thread(() => Serve(c)) { IsBackground = true };
                t.Start();
            }
        }

        void Serve(TcpClient c)
        {
            try
            {
                c.ReceiveTimeout = 30000; c.SendTimeout = 30000;
                c.LingerState = new LingerOption(true, 5);
                var s = c.GetStream(); var req = ReadRequest(s, c);
                if (req == null) return;
                var res = new HttpRes(s);
                try { handler(req, res); if (!res.Sent) res.Send(404, "text/plain", Encoding.UTF8.GetBytes("not found"), null); }
                catch (Exception ex) { LastError = "handler: " + ex; try { if (!res.Sent) res.Send(500, "text/plain", Encoding.UTF8.GetBytes("error"), null); } catch { } }
                Served++;
                // graceful close: stop sending, drain whatever the peer still sends, so Windows never answers with RST
                try { c.Client.Shutdown(SocketShutdown.Send); c.ReceiveTimeout = 800; var d = new byte[2048]; while (s.Read(d, 0, d.Length) > 0) { } } catch { }
            }
            catch (Exception ex) { LastError = "serve: " + ex.Message; }
            finally { try { c.Close(); } catch { } lock (open) open.Remove(c); }
        }

        static HttpReq ReadRequest(Stream s, TcpClient c)
        {
            var buf = new List<byte>(1024); var one = new byte[4096]; int headEnd = -1;
            while (headEnd < 0)
            {
                int n = s.Read(one, 0, one.Length); if (n <= 0) return null;
                for (int i = 0; i < n; i++) buf.Add(one[i]);
                headEnd = IndexOfHeaderEnd(buf);
                if (buf.Count > 65536 && headEnd < 0) return null;
            }
            var headBytes = buf.GetRange(0, headEnd).ToArray();
            var head = Encoding.UTF8.GetString(headBytes).Split(new[] { "\r\n" }, StringSplitOptions.None);
            var first = head[0].Split(new[] { ' ' }); if (first.Length < 2) return null;
            var req = new HttpReq { Method = first[0].ToUpperInvariant() };
            var target = first[1]; int q = target.IndexOf('?');
            req.Path = Uri.UnescapeDataString(q >= 0 ? target.Substring(0, q) : target);
            if (q >= 0) foreach (var pair in target.Substring(q + 1).Split(new[] { '&' }))
            {
                if (pair.Length == 0) continue; int e = pair.IndexOf('=');
                var k = e >= 0 ? pair.Substring(0, e) : pair; var v = e >= 0 ? pair.Substring(e + 1) : "";
                req.Query[Uri.UnescapeDataString(k.Replace('+', ' '))] = Uri.UnescapeDataString(v.Replace('+', ' '));
            }
            for (int i = 1; i < head.Length; i++) { int e = head[i].IndexOf(':'); if (e > 0) req.Headers[head[i].Substring(0, e).Trim()] = head[i].Substring(e + 1).Trim(); }
            try { req.RemoteIp = ((IPEndPoint)c.Client.RemoteEndPoint).Address.ToString(); } catch { }
            long len = 0; long.TryParse(req.Header("Content-Length"), out len);
            if (len > MaxBody) return null;
            var body = new byte[len]; int have = buf.Count - (headEnd + 4);
            if (have > 0) buf.CopyTo(headEnd + 4, body, 0, (int)Math.Min(have, len));
            long got = Math.Min(have < 0 ? 0 : have, len);
            while (got < len) { int n = s.Read(body, (int)got, (int)Math.Min(len - got, 1 << 20)); if (n <= 0) return null; got += n; }
            req.Body = body; return req;
        }

        static int IndexOfHeaderEnd(List<byte> b)
        {
            for (int i = 3; i < b.Count; i++) if (b[i - 3] == 13 && b[i - 2] == 10 && b[i - 1] == 13 && b[i] == 10) return i - 3;
            return -1;
        }
    }

    /// <summary>Serves the app's web folder on 127.0.0.1 only.</summary>
    public static class StaticSite
    {
        static readonly Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            { ".html", "text/html; charset=utf-8" }, { ".js", "application/javascript; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
            { ".png", "image/png" }, { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" }, { ".json", "application/json" }, { ".woff2", "font/woff2" }, { ".woff", "font/woff" }, { ".ttf", "font/ttf" }, { ".jpg", "image/jpeg" }, { ".webp", "image/webp" } };
        public static Action<HttpReq, HttpRes> Handler(string root)
        {
            var full = Path.GetFullPath(root);
            return (req, res) =>
            {
                if (req.Method != "GET" && req.Method != "HEAD") { res.Send(404, "text/plain", new byte[0], null); return; }
                var rel = req.Path == "/" ? "index.html" : req.Path.TrimStart(new[] { '/' });
                var p = Path.GetFullPath(Path.Combine(full, rel.Replace('/', Path.DirectorySeparatorChar)));
                if (!p.StartsWith(full + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(p)) { res.Send(404, "text/plain", Encoding.UTF8.GetBytes("not found"), null); return; }
                string t; if (!Types.TryGetValue(Path.GetExtension(p), out t)) t = "application/octet-stream";
                res.Send(200, t, File.ReadAllBytes(p), new Dictionary<string, string> { { "Cache-Control", "no-cache" } });
            };
        }
    }
}
