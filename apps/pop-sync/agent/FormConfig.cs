using System;
using System.Drawing;
using System.Windows.Forms;
using System.IO;
using System.Text.Json;

namespace PopSync
{
    public class FormConfig : Form
    {
        private AppConfig _config;
        private string _configPath;

        private TextBox txtApiUrl = new TextBox { Width = 300 };
        private TextBox txtApiKey = new TextBox { Width = 300 };
        private TextBox txtMusicPath = new TextBox { Width = 250 };
        private TextBox txtSweepersPath = new TextBox { Width = 250 };
        private TextBox txtDownloadPath = new TextBox { Width = 250 };
        private TextBox txtSlackUrl = new TextBox { Width = 300 };
        private NumericUpDown numInterval = new NumericUpDown { Minimum = 1, Maximum = 60, Value = 5 };

        public FormConfig(AppConfig config, string configPath)
        {
            _config = config;
            _configPath = configPath;

            this.Text = "Configurações PopSync";
            this.Size = new Size(420, 450);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.MaximizeBox = false;

            int labelX = 20, inputX = 20, y = 20, spacing = 50;

            AddLabel("URL da API:", labelX, y);
            txtApiUrl.Location = new Point(inputX, y + 20);
            this.Controls.Add(txtApiUrl);
            y += spacing;

            AddLabel("Chave de API:", labelX, y);
            txtApiKey.Location = new Point(inputX, y + 20);
            this.Controls.Add(txtApiKey);
            y += spacing;

            AddLabel("Caminho Músicas (M:):", labelX, y);
            txtMusicPath.Location = new Point(inputX, y + 20);
            this.Controls.Add(txtMusicPath);
            AddBrowseButton(txtMusicPath, y + 20);
            y += spacing;

            AddLabel("Caminho Materiais (U:):", labelX, y);
            txtSweepersPath.Location = new Point(inputX, y + 20);
            this.Controls.Add(txtSweepersPath);
            AddBrowseButton(txtSweepersPath, y + 20);
            y += spacing;

            AddLabel("Caminho Roteiros (.bil):", labelX, y);
            txtDownloadPath.Location = new Point(inputX, y + 20);
            this.Controls.Add(txtDownloadPath);
            AddBrowseButton(txtDownloadPath, y + 20);
            y += spacing;

            AddLabel("Slack Webhook URL:", labelX, y);
            txtSlackUrl.Location = new Point(inputX, y + 20);
            this.Controls.Add(txtSlackUrl);
            y += spacing;

            AddLabel("Intervalo (Minutos):", labelX, y);
            numInterval.Location = new Point(inputX, y + 20);
            this.Controls.Add(numInterval);

            var btnSave = new Button { Text = "Salvar", Location = new Point(220, 370), Size = new Size(80, 30) };
            btnSave.Click += Save_Click;
            this.Controls.Add(btnSave);

            var btnCancel = new Button { Text = "Cancelar", Location = new Point(310, 370), Size = new Size(80, 30) };
            btnCancel.Click += (s, e) => this.Close();
            this.Controls.Add(btnCancel);

            LoadData();
        }

        private void AddLabel(string text, int x, int y)
        {
            this.Controls.Add(new Label { Text = text, Location = new Point(x, y), AutoSize = true });
        }

        private void AddBrowseButton(TextBox target, int y)
        {
            var btn = new Button { Text = "...", Location = new Point(target.Right + 5, y), Width = 30, Height = 22 };
            btn.Click += (s, e) => {
                using (var fbd = new FolderBrowserDialog())
                {
                    if (fbd.ShowDialog() == DialogResult.OK) target.Text = fbd.SelectedPath;
                }
            };
            this.Controls.Add(btn);
        }

        private void LoadData()
        {
            txtApiUrl.Text = _config.ApiUrl;
            txtApiKey.Text = _config.ApiKey;
            txtMusicPath.Text = _config.MusicPath;
            txtSweepersPath.Text = _config.SweepersPath;
            txtDownloadPath.Text = _config.DownloadPath;
            txtSlackUrl.Text = _config.SlackWebhookUrl;
            numInterval.Value = Math.Max(1, Math.Min(60, _config.SyncIntervalMinutes));
        }

        private void Save_Click(object? sender, EventArgs e)
        {
            _config.ApiUrl = txtApiUrl.Text;
            _config.ApiKey = txtApiKey.Text;
            _config.MusicPath = txtMusicPath.Text;
            _config.SweepersPath = txtSweepersPath.Text;
            _config.DownloadPath = txtDownloadPath.Text;
            _config.SlackWebhookUrl = txtSlackUrl.Text;
            _config.SyncIntervalMinutes = (int)numInterval.Value;

            try
            {
                var options = new JsonSerializerOptions { WriteIndented = true };
                string json = JsonSerializer.Serialize(_config, options);
                File.WriteAllText(_configPath, json);
                this.DialogResult = DialogResult.OK;
                this.Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Erro ao salvar: " + ex.Message, "Erro", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
