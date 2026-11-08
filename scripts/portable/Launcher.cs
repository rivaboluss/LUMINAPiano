using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Launcher
{
    static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" },
        { ".js", "text/javascript; charset=utf-8" },
        { ".mjs", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" },
        { ".svg", "image/svg+xml" },
        { ".png", "image/png" },
        { ".jpg", "image/jpeg" },
        { ".jpeg", "image/jpeg" },
        { ".webp", "image/webp" },
        { ".gif", "image/gif" },
        { ".ico", "image/x-icon" },
        { ".woff", "font/woff" },
        { ".woff2", "font/woff2" },
        { ".ttf", "font/ttf" },
        { ".txt", "text/plain; charset=utf-8" },
        { ".map", "application/json" },
        { ".webm", "video/webm" },
        { ".mp3", "audio/mpeg" },
        { ".wav", "audio/wav" },
        { ".mid", "audio/midi" },
        { ".midi", "audio/midi" }
    };

    [STAThread]
    static void Main()
    {
        string root = Path.GetDirectoryName(Application.ExecutablePath);
        string appRoot = Path.Combine(root, "app");
        bool silent = string.Equals(Environment.GetEnvironmentVariable("LUMINA_SILENT"), "1", StringComparison.Ordinal);
        if (!File.Exists(Path.Combine(appRoot, "index.html")))
        {
            if (!silent)
            {
                MessageBox.Show(
                    "\u627e\u4e0d\u5230\u9875\u9762\u6587\u4ef6\u3002\u8bf7\u628a\u538b\u7f29\u5305\u5b8c\u6574\u89e3\u538b\u540e\u518d\u6253\u5f00\u3002",
                    "LUMINA \u6d41\u5149\u94a2\u7434",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
            Environment.Exit(1);
        }

        HttpListener listener = null;
        int port = 0;
        for (int candidate = 4730; candidate <= 4750; candidate++)
        {
            var attempt = new HttpListener();
            attempt.Prefixes.Add("http://127.0.0.1:" + candidate + "/");
            try
            {
                attempt.Start();
                listener = attempt;
                port = candidate;
                break;
            }
            catch
            {
                attempt.Close();
            }
        }
        if (listener == null)
        {
            if (!silent)
            {
                MessageBox.Show(
                    "\u6ca1\u6709\u53ef\u7528\u7aef\u53e3\u3002\u8bf7\u5148\u5173\u6389\u5df2\u7ecf\u6253\u5f00\u7684\u6d41\u5149\u94a2\u7434\u3002",
                    "LUMINA \u6d41\u5149\u94a2\u7434",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
            Environment.Exit(1);
        }

        string url = "http://127.0.0.1:" + port + "/";
        string urlFile = Path.Combine(root, ".url");
        File.WriteAllText(urlFile, url, Encoding.ASCII);
        var server = new Thread(() => Serve(listener, appRoot));
        server.IsBackground = true;
        server.Start();

        if (silent)
        {
            Thread.Sleep(Timeout.Infinite);
            return;
        }

        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new HostForm(url, listener, urlFile));
    }

    static void Serve(HttpListener listener, string appRoot)
    {
        string appRootFull = Path.GetFullPath(appRoot);
        if (!appRootFull.EndsWith("\\")) appRootFull += "\\";
        try
        {
            while (listener.IsListening)
            {
                HttpListenerContext context = null;
                try { context = listener.GetContext(); }
                catch { break; }
                try
                {
                    string requestPath = context.Request.Url.AbsolutePath;
                    if (string.IsNullOrEmpty(requestPath)) requestPath = "/";
                    requestPath = Uri.UnescapeDataString(requestPath).Replace('\\', '/');
                    if (requestPath.IndexOf('\0') >= 0) throw new InvalidOperationException("bad path");
                    if (requestPath == "/") requestPath = "/index.html";
                    string relative = requestPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                    string full = Path.GetFullPath(Path.Combine(appRoot, relative));
                    bool inside = full.StartsWith(appRootFull, StringComparison.OrdinalIgnoreCase);
                    if (!inside || !File.Exists(full))
                    {
                        Send(context.Response, inside ? 404 : 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"));
                        continue;
                    }
                    string ext = Path.GetExtension(full);
                    string type = "application/octet-stream";
                    if (Mime.ContainsKey(ext)) type = Mime[ext];
                    Send(context.Response, 200, type, File.ReadAllBytes(full));
                }
                catch
                {
                    try { context.Response.Abort(); } catch { }
                }
            }
        }
        finally
        {
            try { listener.Close(); } catch { }
        }
    }

    static void Send(HttpListenerResponse response, int status, string type, byte[] bytes)
    {
        response.StatusCode = status;
        response.ContentType = type;
        response.Headers.Add("X-Content-Type-Options", "nosniff");
        response.ContentLength64 = bytes.LongLength;
        if (bytes.LongLength > 0) response.OutputStream.Write(bytes, 0, bytes.Length);
        response.Close();
    }
}

sealed class HostForm : Form
{
    readonly HttpListener listener;
    readonly string urlFile;

    public HostForm(string url, HttpListener listener, string urlFile)
    {
        this.listener = listener;
        this.urlFile = urlFile;
        Text = "LUMINA \u6d41\u5149\u94a2\u7434";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 252);
        BackColor = Color.FromArgb(7, 11, 20);
        ForeColor = Color.FromArgb(232, 241, 255);
        Font = new Font("Segoe UI", 10f);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
        catch { }

        var mark = new PictureBox();
        mark.Image = IconArt.Draw(80);
        mark.SizeMode = PictureBoxSizeMode.Zoom;
        mark.BackColor = BackColor;
        mark.Location = new Point(28, 24);
        mark.Size = new Size(72, 72);

        var title = new Label();
        title.Text = "LUMINA";
        title.Font = new Font("Segoe UI", 20f, FontStyle.Bold);
        title.ForeColor = Color.FromArgb(61, 255, 242);
        title.BackColor = BackColor;
        title.AutoSize = true;
        title.Location = new Point(116, 28);

        var subtitle = new Label();
        subtitle.Text = "\u6d41\u5149\u94a2\u7434";
        subtitle.Font = new Font("Segoe UI", 12f);
        subtitle.ForeColor = Color.FromArgb(147, 164, 194);
        subtitle.BackColor = BackColor;
        subtitle.AutoSize = true;
        subtitle.Location = new Point(120, 66);

        var status = new Label();
        status.Text = "\u5df2\u5728\u6d4f\u89c8\u5668\u4e2d\u6253\u5f00";
        status.ForeColor = ForeColor;
        status.BackColor = BackColor;
        status.AutoSize = true;
        status.Location = new Point(28, 116);

        var address = new Label();
        address.Text = url;
        address.ForeColor = Color.FromArgb(147, 164, 194);
        address.BackColor = BackColor;
        address.AutoSize = true;
        address.Location = new Point(28, 142);

        var hint = new Label();
        hint.Text = "\u8bf7\u4f7f\u7528 Chrome \u6216 Edge\u3002\u5173\u95ed\u6b64\u7a97\u53e3\u5c31\u4f1a\u505c\u6b62\u3002";
        hint.ForeColor = Color.FromArgb(147, 164, 194);
        hint.BackColor = BackColor;
        hint.AutoSize = true;
        hint.Location = new Point(28, 168);

        var button = new Button();
        button.Text = "\u518d\u6b21\u6253\u5f00\u6d4f\u89c8\u5668";
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 0;
        button.BackColor = Color.FromArgb(61, 255, 242);
        button.ForeColor = Color.FromArgb(4, 16, 24);
        button.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
        button.Location = new Point(28, 198);
        button.Size = new Size(168, 34);
        button.Cursor = Cursors.Hand;
        button.Click += delegate { Open(url); };

        Controls.Add(mark);
        Controls.Add(title);
        Controls.Add(subtitle);
        Controls.Add(status);
        Controls.Add(address);
        Controls.Add(hint);
        Controls.Add(button);
    }

    static void Open(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        try { if (File.Exists(urlFile)) File.Delete(urlFile); } catch { }
        try { listener.Stop(); } catch { }
        try { listener.Close(); } catch { }
        base.OnFormClosed(e);
    }
}
