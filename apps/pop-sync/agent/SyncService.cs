using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Text.Json;

namespace PopSync
{
    public class SyncService
    {
        private readonly AppConfig _config;
        private readonly HttpClient _httpClient;
        private string? _lastSyncHash;
        public event Action<string>? OnLog;

        public SyncService(AppConfig config)
        {
            _config = config;
            _httpClient = new HttpClient();
            if (!string.IsNullOrEmpty(_config.ApiKey))
            {
                _httpClient.DefaultRequestHeaders.Add("Authorization", "Bearer " + _config.ApiKey);
            }
        }

        public async Task RunSync()
        {
            try
            {
                Log("Iniciando varredura da biblioteca...");
                var library = new Dictionary<string, List<object>>();
                int totalCount = 0;

                // 1. Varrer Músicas (Drive M:)
                if (Directory.Exists(_config.MusicPath))
                {
                    Log($"Escaneando músicas em: {_config.MusicPath}");
                    var dirs = Directory.GetDirectories(_config.MusicPath);
                    foreach (var dir in dirs)
                    {
                        var dirInfo = new DirectoryInfo(dir);
                        // Ignora pastas de sistema ou ocultas (ex: System Volume Information)
                        if ((dirInfo.Attributes & FileAttributes.System) != 0 || 
                            (dirInfo.Attributes & FileAttributes.Hidden) != 0 ||
                            dirInfo.Name.StartsWith("$")) 
                        {
                            continue;
                        }

                        var category = dirInfo.Name.ToUpper();
                        var files = ScanFolder(dir);
                        if (files.Any())
                        {
                            library[category] = files;
                            totalCount += files.Count;
                        }
                    }
                }

                // 2. Varrer Materiais (Drive U: - Vinhetas, etc)
                if (Directory.Exists(_config.SweepersPath))
                {
                    Log($"Escaneando materiais em: {_config.SweepersPath}");
                    // Se o SweepersPath for uma pasta direto de VHT
                    var category = "VHT";
                    if (_config.SweepersPath.ToUpper().Contains("CHAMADA")) category = "PROMOS";
                    
                    var files = ScanFolder(_config.SweepersPath);
                    if (files.Any())
                    {
                        if (!library.ContainsKey(category)) library[category] = new List<object>();
                        library[category].AddRange(files);
                        totalCount += files.Count;
                    }
                }

                Log($"Varredura concluída. Total de arquivos: {totalCount}");

                // 3. Verificar Mudanças
                var currentHash = JsonSerializer.Serialize(library);
                bool hasChanges = currentHash != _lastSyncHash;

                if (hasChanges)
                {
                    Log("Alterações detectadas. Enviando para a nuvem...");
                    await NotifySlackAsync($":computer: Pop Sync - {Environment.MachineName}\n:outbox_tray: Iniciando sincronização de trilhas...");

                    var payload = new 
                    {
                        host = Environment.MachineName,
                        count = totalCount,
                        library = library
                    };

                    var json = JsonSerializer.Serialize(payload);
                    var content = new StringContent(json, Encoding.UTF8, "application/json");

                    var response = await _httpClient.PostAsync(_config.ApiUrl, content);
                    if (response.IsSuccessStatusCode)
                    {
                        Log("✅ Sincronia de biblioteca concluída!");
                        _lastSyncHash = currentHash;
                        await NotifySlackAsync($":computer: Pop Sync - {Environment.MachineName}\n:white_check_mark: Sincronização concluída: {totalCount} itens indexados.");
                    }
                    else
                    {
                        var err = await response.Content.ReadAsStringAsync();
                        Log($"❌ Erro no upload: {response.StatusCode} - {err}");
                    }
                }
                else
                {
                    Log("ℹ️ Nenhuma alteração na biblioteca. Pulando upload.");
                }

                // 4. Verificar Downloads Pendentes (Roteiros .bil)
                await DownloadPendingFilesAsync();
            }
            catch (Exception ex)
            {
                Log($"❌ Erro crítico: {ex.Message}");
            }
        }

        private async Task DownloadPendingFilesAsync()
        {
            try
            {
                var response = await _httpClient.GetAsync(_config.ApiUrl);
                if (!response.IsSuccessStatusCode) return;

                var status = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(status);
                
                if (doc.RootElement.TryGetProperty("pendingDownloads", out var downloads) && downloads.ValueKind == JsonValueKind.Array)
                {
                    foreach (var key in downloads.EnumerateArray())
                    {
                        var keyStr = key.GetString();
                        if (string.IsNullOrEmpty(keyStr)) continue;

                        Log($"⬇️ Baixando roteiro pendente: {keyStr}");
                        
                        // Busca o conteúdo
                        var fileRes = await _httpClient.GetAsync($"{_config.ApiUrl}?download_key={keyStr}");
                        if (fileRes.IsSuccessStatusCode)
                        {
                            var fileJson = await fileRes.Content.ReadAsStringAsync();
                            using var fileDoc = JsonDocument.Parse(fileJson);
                            var filename = fileDoc.RootElement.GetProperty("filename").GetString();
                            var content = fileDoc.RootElement.GetProperty("content").GetString();

                            if (!string.IsNullOrEmpty(filename) && content != null)
                            {
                                var localPath = Path.Combine(_config.DownloadPath, filename);
                                await File.WriteAllTextAsync(localPath, content);
                                Log($"✅ Roteiro salvo em: {localPath}");

                                // Confirma e deleta do servidor
                                await _httpClient.DeleteAsync($"{_config.ApiUrl}?key={keyStr}");
                                await NotifySlackAsync($":computer: Pop Sync - {Environment.MachineName}\n:satellite_antenna: Roteiro baixado: {filename}");
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log($"⚠️ Falha no download de roteiros: {ex.Message}");
            }
        }

        private async Task NotifySlackAsync(string message)
        {
            if (string.IsNullOrEmpty(_config.SlackWebhookUrl)) return;

            try
            {
                var payload = new { text = message };
                var json = JsonSerializer.Serialize(payload);
                await _httpClient.PostAsync(_config.SlackWebhookUrl, new StringContent(json, Encoding.UTF8, "application/json"));
            }
            catch { }
        }

        private List<object> ScanFolder(string path)
        {
            var results = new List<object>();
            try
            {
                var files = Directory.GetFiles(path, "*.*", SearchOption.AllDirectories)
                    .Where(f => new[] { ".mp3", ".wav", ".wma" }.Contains(Path.GetExtension(f).ToLower()));

                foreach (var file in files)
                {
                    var fileName = Path.GetFileNameWithoutExtension(file);
                    var artist = "";
                    var title = fileName;

                    if (fileName.Contains(" - "))
                    {
                        var parts = fileName.Split(new[] { " - " }, 2, StringSplitOptions.None);
                        artist = parts[0];
                        title = parts[1];
                    }

                    results.Add(new
                    {
                        Name = title,
                        Artist = artist,
                        FullPath = file,
                        DurationMs = 180000 // Fallback se não tiver TagLib
                    });
                }
            }
            catch (Exception ex)
            {
                Log($"Aviso: Falha ao ler pasta {path}: {ex.Message}");
            }
            return results;
        }

        private void Log(string msg)
        {
            OnLog?.Invoke($"[{DateTime.Now:HH:mm:ss}] {msg}");
        }
    }
}
