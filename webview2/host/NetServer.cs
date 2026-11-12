using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace DalalaRestaurant
{
    using Dict = Dictionary<string, object>;

    public static class J
    {
        static readonly JavaScriptSerializer Ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 200 };
        public static string S(object o) { lock (Ser) return Ser.Serialize(o); }
        public static object P(string s) { lock (Ser) return Ser.DeserializeObject(s); }
        public static Dict D(object o) { return o as Dict; }
        public static ArrayList L(object o) { return o as ArrayList ?? (o is object[] ? new ArrayList((object[])o) : null); }
        public static string Str(object o) { return o == null ? "" : Convert.ToString(o, CultureInfo.InvariantCulture); }
        public static bool IsNum(object o) { return o is int || o is long || o is double || o is decimal || o is float || o is short; }
        public static double Num(object o)
        {
            if (o == null) return 0; if (IsNum(o)) return Convert.ToDouble(o, CultureInfo.InvariantCulture);
            double d; return double.TryParse(Str(o), NumberStyles.Float, CultureInfo.InvariantCulture, out d) ? d : 0;
        }
        public static bool Truthy(object o) { if (o == null) return false; if (o is bool) return (bool)o; if (IsNum(o)) return Num(o) != 0; return Str(o).Length > 0; }
        public static object Get(Dict d, string k) { object v; return d != null && d.TryGetValue(k, out v) ? v : null; }
    }

    /// <summary>Product rules (port of netrules.js): order numbers never repeat across computers.</summary>
    public class Ctx { public Dict Data; public Dictionary<string, Tuple<double, double>> Renum = new Dictionary<string, Tuple<double, double>>(); public Action<string> Touch; }

    public static class Rules
    {
        static string Pad(int n) { return n.ToString("00"); }
        public static string DayKey(double ms) { var d = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(ms).ToLocalTime(); return d.Year + "-" + Pad(d.Month) + "-" + Pad(d.Day); }
        static double Now() { return (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds; }
        static double WhenOf(Dict r) { foreach (var k in new[] { "openedAt", "createdAt", "date" }) { var v = J.Num(J.Get(r, k)); if (v != 0) return v; } return Now(); }
        static Dict Settings(Ctx c) { return J.D(J.Get(c.Data, "settings")); }

        public static void Put(string col, Dict rec, Ctx ctx)
        {
            var id = J.Str(J.Get(rec, "id"));
            if ((col == "open" || col == "orders") && J.Truthy(J.Get(rec, "dailyNo")))
            {
                Tuple<double, double> known;
                if (ctx.Renum.TryGetValue(id, out known) && J.Num(rec["dailyNo"]) == known.Item1) rec["dailyNo"] = known.Item2;
                var day = DayKey(WhenOf(rec));
                var all = new List<Dict>();
                foreach (var key in new[] { "open", "orders" }) { var arr = J.L(J.Get(ctx.Data, key)); if (arr != null) foreach (var o in arr) { var r = J.D(o); if (r != null && J.Str(J.Get(r, "id")) != id && J.Truthy(J.Get(r, "dailyNo")) && DayKey(WhenOf(r)) == day) all.Add(r); } }
                if (all.Any(r => J.Num(r["dailyNo"]) == J.Num(rec["dailyNo"])))
                {
                    var from = J.Num(rec["dailyNo"]); var to = Math.Max(0, all.Max(r => J.Num(r["dailyNo"]))) + 1; rec["dailyNo"] = (long)to; ctx.Renum[id] = Tuple.Create(from, to);
                }
                var s = Settings(ctx);
                if (s != null && day == DayKey(Now()))
                {
                    var dn = J.D(J.Get(s, "dailyNo")); if (dn == null || J.Str(J.Get(dn, "day")) != day) dn = new Dict { { "day", day }, { "n", 0 } };
                    if (J.Num(J.Get(dn, "n")) < J.Num(rec["dailyNo"])) { s["dailyNo"] = new Dict { { "day", day }, { "n", rec["dailyNo"] } }; ctx.Touch("settings"); }
                }
            }
            if (col == "orders" && rec.ContainsKey("no") && rec["no"] != null && J.Str(rec["no"]).Length > 0 && !double.IsNaN(J.Num(rec["no"])) && (J.IsNum(rec["no"]) || J.Num(rec["no"]) != 0))
            {
                var orders = J.L(J.Get(ctx.Data, "orders")) ?? new ArrayList();
                var no = J.Num(rec["no"]);
                Func<Dict, bool> other = r => r != null && J.Str(J.Get(r, "id")) != id;
                if (orders.Cast<object>().Select(J.D).Any(r => other(r) && J.Num(J.Get(r, "no")) == no))
                { rec["no"] = (long)(Math.Max(0, orders.Cast<object>().Select(J.D).Where(other).Select(r => J.Num(J.Get(r, "no"))).DefaultIfEmpty(0).Max()) + 1); no = J.Num(rec["no"]); }
                var s = Settings(ctx);
                if (s != null && !(J.Num(J.Get(s, "nextInvoice")) > no)) { s["nextInvoice"] = (long)no + 1; ctx.Touch("settings"); }
            }
            if (col == "tickets" && J.Str(J.Get(rec, "orderId")).Length > 0)
            {
                Tuple<double, double> m;
                if (ctx.Renum.TryGetValue(J.Str(rec["orderId"]), out m) && J.Num(J.Get(rec, "dailyNo")) == m.Item1)
                {
                    rec["dailyNo"] = (long)m.Item2;
                    if (rec.ContainsKey("label") && rec["label"] is string) rec["label"] = ((string)rec["label"]).Replace(" رقم " + (long)m.Item1, " رقم " + (long)m.Item2);
                }
            }
        }

        public static Dict Obj(string name, Dict val, Dict cur)
        {
            if (name != "settings" || val == null || cur == null) return null;
            bool changed = false; var o = new Dict(val);
            if (J.Num(J.Get(cur, "nextInvoice")) > J.Num(J.Get(o, "nextInvoice"))) { o["nextInvoice"] = cur["nextInvoice"]; changed = true; }
            var a = J.D(J.Get(cur, "dailyNo")) ?? new Dict(); var b = J.D(J.Get(o, "dailyNo")) ?? new Dict();
            var ad = J.Str(J.Get(a, "day")); var bd = J.Str(J.Get(b, "day"));
            if (ad.Length > 0 && (bd.Length == 0 || string.CompareOrdinal(ad, bd) > 0 || (ad == bd && J.Num(J.Get(a, "n")) > J.Num(J.Get(b, "n"))))) { o["dailyNo"] = new Dict(a); changed = true; }
            return changed ? o : null;
        }
    }

    public class NetServer
    {
        const int LogMax = 5000;
        static readonly Regex AutoCode = new Regex(@"^([A-Za-z]+-)(\d+)$");
        readonly string dir, file, jfile, backups, key; readonly int port; readonly Action<string, string> onEvent;
        readonly object sync = new object();
        long version; Dict data;
        class Entry { public long V; public string ClientId; public ArrayList Ops; }
        readonly List<Entry> log = new List<Entry>();
        readonly List<ManualResetEvent> waiters = new List<ManualResetEvent>();
        class ClientInfo { public string Name = ""; public double LastSeen; public string Ip = ""; }
        readonly Dictionary<string, ClientInfo> clients = new Dictionary<string, ClientInfo>();
        readonly Ctx ctx = new Ctx();
        MiniHttp http; Timer saveTimer; FileStream jfs;
        public volatile string LastError = "";

        public NetServer(int port, string key, string dir, Action<string, string> onEvent)
        {
            this.port = port; this.key = key; this.dir = dir; this.onEvent = (a, b) => { if (a == "error") LastError = b; if (onEvent != null) onEvent(a, b); };
            file = Path.Combine(dir, "shared-db.json"); jfile = Path.Combine(dir, "journal.ndjson"); backups = Path.Combine(dir, "backups");
            Directory.CreateDirectory(dir);
            try { var st = J.D(J.P(File.ReadAllText(file, Encoding.UTF8))); if (st != null) { version = (long)J.Num(J.Get(st, "version")); data = J.D(J.Get(st, "data")); } } catch { }
            ctx.Touch = n => { };
            Recover();
        }

        public static string NewKey()
        {
            const string A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; var b = new byte[8]; using (var r = RandomNumberGenerator.Create()) r.GetBytes(b);
            var s = new string(b.Select(x => A[x % 32]).ToArray()); return s.Substring(0, 4) + "-" + s.Substring(4);
        }

        void Recover()
        {
            try
            {
                if (!File.Exists(jfile)) return; int n = 0;
                foreach (var line in File.ReadAllLines(jfile, Encoding.UTF8))
                {
                    if (line.Length == 0) continue; Dict e; try { e = J.D(J.P(line)); } catch { break; } if (e == null) break;
                    var v = (long)J.Num(J.Get(e, "v")); if (v > version) { ApplyChanges(J.L(e["ops"])); version = v; log.Add(new Entry { V = v, ClientId = J.Str(J.Get(e, "c")), Ops = J.L(e["ops"]) }); n++; }
                }
                if (n > 0) onEvent("recovered", n.ToString());
                if (log.Count > 0) { try { SnapshotNow(); } catch (Exception ex) { onEvent("error", ex.Message); } }
            }
            catch { }
        }

        /// <summary>apply already-processed changes (journal replay)</summary>
        void ApplyChanges(ArrayList changes)
        {
            if (data == null) data = new Dict();
            foreach (var o in changes)
            {
                var op = J.D(o); if (op == null) continue;
                if (op.ContainsKey("obj"))
                {
                    var name = J.Str(op["obj"]);
                    if (op.ContainsKey("value") && op["value"] != null) data[name] = op["value"];
                    else { var cur = J.D(J.Get(data, name)) ?? new Dict(); var next = new Dict(cur); var p = J.D(J.Get(op, "patch")); if (p != null) foreach (var kv in p) next[kv.Key] = kv.Value; var un = J.L(J.Get(op, "unset")); if (un != null) foreach (var k in un) next.Remove(J.Str(k)); data[name] = next; }
                    continue;
                }
                var col = J.Str(J.Get(op, "col")); if (col.Length == 0) continue;
                var arr = J.L(J.Get(data, col)) ?? new ArrayList();
                var del = J.L(J.Get(op, "del")); if (del != null && del.Count > 0) { var ds = new HashSet<string>(del.Cast<object>().Select(J.Str)); arr = new ArrayList(arr.Cast<object>().Where(r => !ds.Contains(J.Str(J.Get(J.D(r), "id")))).ToList()); }
                var idx = new Dictionary<string, int>(); for (int i = 0; i < arr.Count; i++) idx[J.Str(J.Get(J.D(arr[i]), "id"))] = i;
                var put = J.L(J.Get(op, "put")); if (put != null) foreach (var r in put) { var rd = J.D(r); var id = J.Str(J.Get(rd, "id")); if (idx.ContainsKey(id)) arr[idx[id]] = r; else { idx[id] = arr.Count; arr.Add(r); } }
                data[col] = arr;
            }
        }

        void Journal(long v, string cid, ArrayList ops)
        {
            try
            {
                if (jfs == null) jfs = new FileStream(jfile, FileMode.Append, FileAccess.Write, FileShare.Read);
                var line = Encoding.UTF8.GetBytes(J.S(new Dict { { "v", v }, { "c", cid }, { "ops", ops } }) + "\n"); jfs.Write(line, 0, line.Length); jfs.Flush(true);
            }
            catch (Exception e) { onEvent("error", "journal: " + e.Message); }
        }

        void SnapshotNow()
        {
            lock (sync)
            {
                if (saveTimer != null) { saveTimer.Dispose(); saveTimer = null; }
                Directory.CreateDirectory(dir); var tmp = file + ".tmp";
                File.WriteAllText(tmp, J.S(new Dict { { "version", version }, { "data", data } }), new UTF8Encoding(false));
                if (File.Exists(file)) File.Delete(file); File.Move(tmp, file);
                try { if (jfs != null) { jfs.Dispose(); jfs = null; } File.WriteAllText(jfile, ""); } catch { }
            }
        }

        void Persist()
        {
            if (saveTimer != null) saveTimer.Dispose();
            saveTimer = new Timer(_ =>
            {
                try
                {
                    SnapshotNow();
                    var bk = Path.Combine(backups, "shared-" + DateTime.UtcNow.ToString("yyyy-MM-dd") + ".json");
                    if (!File.Exists(bk))
                    {
                        Directory.CreateDirectory(backups); File.Copy(file, bk);
                        foreach (var f in Directory.GetFiles(backups, "shared-*").OrderBy(x => x, StringComparer.Ordinal).Reverse().Skip(30)) { try { File.Delete(f); } catch { } }
                    }
                }
                catch (Exception e) { onEvent("error", e.Message); }
            }, null, 250, Timeout.Infinite);
        }

        static string NextNumber(ArrayList arr, string field, string value)
        {
            var m = AutoCode.Match(value); if (!m.Success) return null; var prefix = m.Groups[1].Value; var width = m.Groups[2].Value.Length; long max = 0;
            foreach (var o in arr) { var mm = AutoCode.Match(J.Str(J.Get(J.D(o), field))); if (mm.Success && mm.Groups[1].Value == prefix) max = Math.Max(max, long.Parse(mm.Groups[2].Value)); }
            return prefix + (max + 1).ToString().PadLeft(width, '0');
        }

        Dict Apply(ArrayList ops, string cid)
        {
            if (data == null) data = new Dict();
            var changes = new ArrayList(); var touched = new List<string>(); var patched = new List<KeyValuePair<string, Dict>>();
            ctx.Data = data; ctx.Touch = n => { if (!touched.Contains(n)) touched.Add(n); };
            if (ops != null) foreach (var o in ops)
            {
                var op = J.D(o); if (op == null) continue;
                if (op.ContainsKey("obj") && op["obj"] != null)
                {
                    var name = J.Str(op["obj"]); if (name == "version" || name.StartsWith("__")) continue;
                    var cur = J.Get(data, name); var curD = J.D(cur);
                    var patch = J.D(J.Get(op, "patch")); var unset = J.L(J.Get(op, "unset")); bool isPatch = patch != null || unset != null;
                    object val;
                    if (isPatch) { var nv = curD != null ? new Dict(curD) : new Dict(); if (patch != null) foreach (var kv in patch) nv[kv.Key] = kv.Value; if (unset != null) foreach (var k in unset) nv.Remove(J.Str(k)); val = nv; }
                    else val = J.Get(op, "value");
                    var vd = J.D(val); if (vd != null) { var r = Rules.Obj(name, vd, curD); if (r != null) { val = r; if (!touched.Contains(name)) touched.Add(name); } }
                    data[name] = val;
                    if (isPatch)
                    {
                        var e = patched.FirstOrDefault(x => x.Key == name); if (e.Value == null) { e = new KeyValuePair<string, Dict>(name, new Dict { { "patch", new Dict() }, { "unset", new ArrayList() } }); patched.Add(e); }
                        var pp = (Dict)e.Value["patch"]; var uu = (ArrayList)e.Value["unset"];
                        if (patch != null) foreach (var kv in patch) pp[kv.Key] = kv.Value;
                        if (unset != null) foreach (var k in unset) { pp.Remove(J.Str(k)); uu.Add(k); }
                    }
                    else if (!touched.Contains(name)) touched.Add(name);
                    continue;
                }
                var col = J.Str(J.Get(op, "col")); if (col.Length == 0 || col.StartsWith("__")) continue;
                var arr = J.L(J.Get(data, col)) ?? new ArrayList(); data[col] = arr;
                var index = new HashSet<string>(arr.Cast<object>().Select(r => J.Str(J.Get(J.D(r), "id"))));
                var del = (J.L(J.Get(op, "del")) ?? new ArrayList()).Cast<object>().Select(J.Str).Where(index.Contains).ToList();
                if (del.Count > 0) { var ds = new HashSet<string>(del); arr = new ArrayList(arr.Cast<object>().Where(r => !ds.Contains(J.Str(J.Get(J.D(r), "id")))).ToList()); data[col] = arr; }
                var idx = new Dictionary<string, int>(); for (int i = 0; i < arr.Count; i++) idx[J.Str(J.Get(J.D(arr[i]), "id"))] = i;
                var put = new ArrayList(); var incAll = J.D(J.Get(op, "inc"));
                var puts = J.L(J.Get(op, "put"));
                if (puts != null) foreach (var po in puts)
                {
                    var rec = J.D(po); if (rec == null || !J.Truthy(J.Get(rec, "id"))) continue; var rid = J.Str(rec["id"]);
                    var inc = incAll != null ? J.D(J.Get(incAll, rid)) : null;
                    if (inc != null && idx.ContainsKey(rid))
                    {
                        var old = J.D(arr[idx[rid]]);
                        foreach (var kv in inc) if (J.IsNum(J.Get(old, kv.Key)) && J.IsNum(kv.Value)) rec[kv.Key] = Math.Round(J.Num(old[kv.Key]) + J.Num(kv.Value), 6);
                    }
                    Rules.Put(col, rec, ctx);
                    foreach (var f in new[] { "number", "code" })
                    {
                        var fv = J.Str(J.Get(rec, f));
                        if (fv.Length > 0 && AutoCode.IsMatch(fv) && arr.Cast<object>().Select(J.D).Any(r => J.Str(J.Get(r, f)) == fv && J.Str(J.Get(r, "id")) != rid)) { var n = NextNumber(arr, f, fv); if (n != null) rec[f] = n; }
                    }
                    if (idx.ContainsKey(rid)) arr[idx[rid]] = rec; else { idx[rid] = arr.Count; arr.Add(rec); }
                    put.Add(rec);
                }
                if (put.Count > 0 || del.Count > 0) changes.Add(new Dict { { "col", col }, { "put", put }, { "del", new ArrayList(del) } });
            }
            foreach (var name in touched) changes.Add(new Dict { { "obj", name }, { "value", data[name] } });
            foreach (var kv in patched) if (!touched.Contains(kv.Key)) changes.Add(new Dict { { "obj", kv.Key }, { "patch", kv.Value["patch"] }, { "unset", kv.Value["unset"] } });
            if (changes.Count == 0) return new Dict { { "version", version }, { "changes", new ArrayList() } };
            version++;
            Journal(version, cid, changes);
            log.Add(new Entry { V = version, ClientId = cid, Ops = changes }); if (log.Count > LogMax) log.RemoveRange(0, log.Count - LogMax);
            Persist();
            WakeAll();
            return new Dict { { "version", version }, { "changes", changes } };
        }

        void WakeAll() { lock (waiters) { foreach (var w in waiters) { try { w.Set(); } catch { } } waiters.Clear(); } }

        Dict Since(long v)
        {
            if ((log.Count > 0 && log[0].V <= v + 1) || v == version)
                return new Dict { { "version", version }, { "entries", new ArrayList(log.Where(e => e.V > v).Select(e => (object)new Dict { { "v", e.V }, { "clientId", e.ClientId }, { "ops", e.Ops } }).ToList()) } };
            return null;
        }

        bool KeyOk(string k) { if (k == null || k.Length != key.Length) return false; int d = 0; for (int i = 0; i < k.Length; i++) d |= k[i] ^ key[i]; return d == 0; }

        static readonly Dictionary<string, string> Cors = new Dictionary<string, string> {
            { "Access-Control-Allow-Origin", "*" }, { "Access-Control-Allow-Headers", "content-type, x-dalala-key, x-dalala-client" },
            { "Access-Control-Allow-Methods", "GET, POST, OPTIONS" }, { "Cache-Control", "no-store" } };
        static void Send(HttpRes res, int code, object obj)
        { res.Send(code, "application/json; charset=utf-8", code == 204 ? new byte[0] : Encoding.UTF8.GetBytes(J.S(obj)), Cors); }

        void Handle(HttpReq req, HttpRes res)
        {
            if (req.Method == "OPTIONS") { Send(res, 204, null); return; }
            var okKey = KeyOk(req.Header("x-dalala-key"));
            if (req.Path == "/api/ping") { Send(res, 200, new Dict { { "ok", true }, { "app", "dalala" }, { "version", version }, { "keyOk", okKey } }); return; }
            if (!okKey) { Send(res, 401, new Dict { { "error", "key" } }); return; }
            var cid = req.Header("x-dalala-client");
            if (cid.Length > 0) lock (clients)
            {
                ClientInfo ci; if (!clients.TryGetValue(cid, out ci)) clients[cid] = ci = new ClientInfo();
                ci.LastSeen = Rules_Now(); ci.Ip = req.RemoteIp; var nm = req.Q("name"); if (nm.Length > 0) ci.Name = nm;
            }
            if (req.Method == "GET" && req.Path == "/api/snapshot") { lock (sync) Send(res, 200, new Dict { { "version", version }, { "data", data } }); return; }
            if (req.Method == "GET" && req.Path == "/api/changes")
            {
                long v; long.TryParse(req.Q("since"), out v); var wait = req.Q("wait") == "1";
                Action reply = () => { Dict r; lock (sync) r = Since(v); if (r != null) Send(res, 200, r); else Send(res, 200, new Dict { { "reset", true }, { "version", version } }); };
                if (!wait || version > v) { reply(); return; }
                var ev = new ManualResetEvent(false); lock (waiters) waiters.Add(ev);
                ev.WaitOne(25000); lock (waiters) waiters.Remove(ev); ev.Close(); reply(); return;
            }
            if (req.Method == "POST" && (req.Path == "/api/apply" || req.Path == "/api/init"))
            {
                Dict msg; try { msg = J.D(J.P(Encoding.UTF8.GetString(req.Body))) ?? new Dict(); } catch { Send(res, 400, new Dict { { "error", "json" } }); return; }
                if (req.Path == "/api/init")
                {
                    lock (sync)
                    {
                        if (data != null && data.Count > 0 && !J.Truthy(J.Get(msg, "force"))) { Send(res, 409, new Dict { { "error", "exists" }, { "version", version } }); return; }
                        data = J.D(J.Get(msg, "data")) ?? new Dict(); version++; log.Clear(); try { SnapshotNow(); } catch (Exception e) { onEvent("error", e.Message); }
                    }
                    WakeAll(); onEvent("init", cid); Send(res, 200, new Dict { { "version", version } }); return;
                }
                Dict r2; lock (sync) r2 = Apply(J.L(J.Get(msg, "ops")), cid); Send(res, 200, r2); return;
            }
            Send(res, 404, new Dict { { "error", "not found" } });
        }
        static double Rules_Now() { return (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds; }

        public void Listen() { http = new MiniHttp(IPAddress.Any, port, Handle); http.Start(); }
        public void Close() { try { if (saveTimer != null || jfs != null) SnapshotNow(); } catch (Exception e) { onEvent("error", e.Message); } WakeAll(); if (http != null) http.Stop(); }
        public void Flush() { try { SnapshotNow(); } catch (Exception e) { onEvent("error", e.Message); } }

        /// <summary>JSON text for the settings page: version, clients…</summary>
        public string StatusJson()
        {
            var now = Rules_Now(); var list = new ArrayList();
            lock (clients) foreach (var kv in clients) list.Add(new Dict { { "id", kv.Key }, { "name", kv.Value.Name }, { "lastSeen", kv.Value.LastSeen }, { "ip", kv.Value.Ip }, { "online", now - kv.Value.LastSeen < 60000 } });
            return J.S(new Dict { { "version", version }, { "hasData", data != null }, { "clients", list }, { "file", file } });
        }
    }
}
