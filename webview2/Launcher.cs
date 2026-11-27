using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
static class Launcher
{
    [STAThread]
    static void Main()
    {
        var dir = AppDomain.CurrentDomain.BaseDirectory;
        var script = Path.Combine(dir, "DalalaLauncher.ps1");
        if (!File.Exists(script)) { MessageBox.Show("ملف التشغيل مفقود. أعد تثبيت المنظومة.", "منظومة دلالة للمطاعم والمقاهي", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
        var ps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"System32\WindowsPowerShell\v1.0\powershell.exe");
        var psi = new ProcessStartInfo { FileName = ps, Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"", UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = dir };
        try { Process.Start(psi); } catch (Exception ex) { MessageBox.Show("تعذر تشغيل المنظومة: " + ex.Message, "منظومة دلالة للمطاعم والمقاهي", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
}
