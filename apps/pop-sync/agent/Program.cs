using System;
using System.Drawing;
using System.Windows.Forms;
using System.IO;
using System.Text.Json;

namespace PopSync
{
    internal static class Program
    {
        private static NotifyIcon? _trayIcon;
        private static SyncService? _syncService;
        private static AppConfig? _config;
        private static System.Windows.Forms.Timer? _syncTimer;
        private static ContextMenuStrip? _contextMenu;
        private static string _basePath = AppDomain.CurrentDomain.BaseDirectory;

        [STAThread]
        static void Main()
        {
            try 
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                LoadConfiguration();

                if (_config == null)
                {
                    MessageBox.Show("Não foi possível carregar o arquivo config.json.\nCertifique-se que ele está na mesma pasta que o executável.", "Erro PopSync", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                _syncService = new SyncService(_config);
                _syncService.OnLog += (msg) => {
                    try {
                        string logPath = Path.Combine(_basePath, "sync_log.txt");
                        File.AppendAllText(logPath, msg + "\n");
                    } catch { }
                };

                CreateTrayIcon();
                StartSyncTimer();

                // Sincronia inicial
                _ = _syncService.RunSync();

                Application.Run();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Erro fatal na inicialização:\n\n" + ex.ToString(), "Erro Crítico PopSync", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static void LoadConfiguration()
        {
            try
            {
                string configPath = Path.Combine(_basePath, "config.json");
                if (File.Exists(configPath))
                {
                    string json = File.ReadAllText(configPath);
                    var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                    _config = JsonSerializer.Deserialize<AppConfig>(json, options);
                }
            }
            catch { }
        }

        private static void CreateTrayIcon()
        {
            _contextMenu = new ContextMenuStrip();
            _contextMenu.Items.Add("PopSync - Ativo", null, (s, e) => { });
            _contextMenu.Items.Add(new ToolStripSeparator());
            _contextMenu.Items.Add("Sincronizar Agora", null, async (s, e) => {
                if (_syncService != null) await _syncService.RunSync();
            });
            _contextMenu.Items.Add("Ver Logs", null, (s, e) => {
                string logPath = Path.Combine(_basePath, "sync_log.txt");
                if (File.Exists(logPath)) System.Diagnostics.Process.Start("notepad.exe", logPath);
            });
            _contextMenu.Items.Add("Configurações", null, (s, e) => {
                var configPath = Path.Combine(_basePath, "config.json");
                using (var form = new FormConfig(_config!, configPath))
                {
                    if (form.ShowDialog() == DialogResult.OK)
                    {
                        StopSyncTimer();
                        _syncService = new SyncService(_config!);
                        StartSyncTimer();
                        _ = _syncService.RunSync();
                    }
                }
            });
            _contextMenu.Items.Add(new ToolStripSeparator());
            _contextMenu.Items.Add("Sair", null, Exit);

            _trayIcon = new NotifyIcon
            {
                Icon = SystemIcons.Information,
                // Assign both legacy and modern menu properties for maximum compatibility
                ContextMenuStrip = _contextMenu,
                Text = "PopSync - Sincronizador Rádio Pop FM",
                Visible = true
            };

            // Força a exibição do menu no clique com o botão direito (correção para falhas do WinForms)
            _trayIcon.MouseUp += (s, e) => {
                if (e.Button == MouseButtons.Right) {
                    _contextMenu.Show(Cursor.Position);
                }
            };
        }

        private static void StartSyncTimer()
        {
            if (_config == null || _syncService == null) return;
            
            _syncTimer = new System.Windows.Forms.Timer();
            _syncTimer.Interval = Math.Max(1, _config.SyncIntervalMinutes) * 60 * 1000;
            _syncTimer.Tick += async (s, e) => await _syncService.RunSync();
            _syncTimer.Start();
        }

        private static void StopSyncTimer()
        {
            if (_syncTimer != null)
            {
                _syncTimer.Stop();
                _syncTimer.Dispose();
                _syncTimer = null;
            }
        }

        private static void Exit(object? sender, EventArgs e)
        {
            if (_trayIcon != null) _trayIcon.Visible = false;
            Application.Exit();
        }
    }
}
