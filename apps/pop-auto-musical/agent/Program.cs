using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace RadioAgent
{
    class Program
    {
        static Config config;
        static string lastSyncFingerprint = "";

        static async Task Main(string[] args)
        {
            Console.WriteLine("========================================");
            Console.WriteLine("   RadioAgent - Robot Automação Pop   ");
            Console.WriteLine("========================================\n");

            // 1. Load Local Config
            if (!File.Exists("config.json"))
            {
                Console.WriteLine("! Erro: config.json não encontrado.");
                return;
            }
            config = JsonSerializer.Deserialize<Config>(File.ReadAllText("config.json"));

            Console.WriteLine($"> Iniciando loop de 24h (Intervalo: {config.SyncIntervalMinutes} min)");
            Console.WriteLine($"> Pasta Músicas: {config.MusicPath}");
            Console.WriteLine($"> Pasta Roteiros: {config.DownloadPath}");

            while (true)
            {
                try
                {
                    Console.WriteLine($"\n[{DateTime.Now:HH:mm:ss}] Verificando ordens do servidor...");
                    await ProcessCycle();
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"! Erro no ciclo: {ex.Message}");
                }

                await Task.Delay(TimeSpan.FromMinutes(config.SyncIntervalMinutes));
            }
        }

        static async Task ProcessCycle()
        {
            using (var client = new HttpClient())
            {
                client.DefaultRequestHeaders.Add("Authorization", $"Bearer {config.ApiKey}");

                // 2. Heartbeat: Check with Server
                var syncStatusRes = await client.GetAsync($"{config.ApiUrl}/agent-sync");
                if (!syncStatusRes.IsSuccessStatusCode)
                {
                    Console.WriteLine("! Falha no Heartbeat (Unauthorized?).");
                    return;
                }

                var commands = JsonSerializer.Deserialize<AgentCommands>(await syncStatusRes.Content.ReadAsStringAsync());

                // 3. Process Downloads (Queue)
                if (commands.Downloads != null && commands.Downloads.Count > 0)
                {
                    Console.WriteLine($"> {commands.Downloads.Count} Roteiros pendentes na fila.");
                    foreach (var dl in commands.Downloads)
                    {
                        Console.WriteLine($">> Baixando: {dl.Filename}");
                        string fullPath = Path.Combine(config.DownloadPath, dl.Filename);
                        
                        File.WriteAllText(fullPath, dl.Content, new UTF8Encoding(false));
                        Console.WriteLine($"✓ Salvo: {dl.Filename}");

                        // Acknowledge this specific download
                        await AckCommand(client, "download", dl.Id);
                    }
                }

                // 4. Library Sync Logic
                var currentFingerprint = GetLibraryFingerprint(config.MusicPath);
                
                if (commands.ForceSync || currentFingerprint != lastSyncFingerprint)
                {
                    if (commands.ForceSync) Console.WriteLine("> Sincronização FORÇADA pelo Painel.");
                    else Console.WriteLine("> Alteração detectada na pasta local. Iniciando Upload...");

                    var library = ScanLibrary();
                    int total = library.Values.Sum(v => v.Count);
                    
                    await UploadLibrary(client, library, total);
                    
                    lastSyncFingerprint = currentFingerprint;

                    if (commands.ForceSync) await AckCommand(client, "forceSync");
                }
                else
                {
                    Console.WriteLine("✓ Biblioteca está sincronizada e atualizada.");
                }
            }
        }

        static string GetLibraryFingerprint(string path)
        {
            if (!Directory.Exists(path)) return "";
            var files = Directory.GetFiles(path, "*.*", SearchOption.AllDirectories);
            // Fingerprint = Count + Last Modified of most recent file
            var lastMod = files.Any() ? files.Max(f => File.GetLastWriteTime(f).Ticks) : 0;
            return $"{files.Length}_{lastMod}";
        }

        static Dictionary<string, List<MusicFile>> ScanLibrary()
        {
            var library = new Dictionary<string, List<MusicFile>>();
            
            void DoScan(string root, string defCat)
            {
                if (!Directory.Exists(root)) return;
                var files = Directory.GetFiles(root, "*.*", SearchOption.AllDirectories)
                                     .Where(s => s.EndsWith(".mp3") || s.EndsWith(".wav"))
                                     .ToList();
                foreach (var f in files)
                {
                    var cat = Path.GetFileName(Path.GetDirectoryName(f));
                    if (!library.ContainsKey(cat)) library[cat] = new List<MusicFile>();
                    
                    using (var t = TagLib.File.Create(f))
                    {
                        library[cat].Add(new MusicFile {
                            FileName = Path.GetFileName(f),
                            FullPath = f,
                            Artist = t.Tag.FirstPerformer ?? "DESCONHECIDO",
                            Title = t.Tag.Title ?? Path.GetFileNameWithoutExtension(f),
                            DurationMs = (int)t.Properties.Duration.TotalMilliseconds
                        });
                    }
                }
            }

            DoScan(config.MusicPath, "MUSICAS");
            DoScan(config.SweepersPath, "VIG");
            return library;
        }

        static async Task UploadLibrary(HttpClient client, Dictionary<string, List<MusicFile>> lib, int total)
        {
            var json = JsonSerializer.Serialize(new {
                lastUpdate = DateTime.UtcNow,
                host = Environment.MachineName,
                count = total,
                library = lib
            });
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var res = await client.PostAsync($"{config.ApiUrl}/library", content);
            if (res.IsSuccessStatusCode) Console.WriteLine("✓ Upload da Biblioteca concluído.");
        }

        static async Task AckCommand(HttpClient client, string type, string id = null)
        {
            var json = JsonSerializer.Serialize(new { ack = type, id = id });
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            await client.PostAsync($"{config.ApiUrl}/agent-sync", content);
        }
    }

    class Config
    {
        public string ApiUrl { get; set; }
        public string ApiKey { get; set; }
        public string MusicPath { get; set; }
        public string SweepersPath { get; set; }
        public string DownloadPath { get; set; }
        public int SyncIntervalMinutes { get; set; }
    }

    class MusicFile
    {
        public string FileName { get; set; }
        public string FullPath { get; set; }
        public string Artist { get; set; }
        public string Title { get; set; }
        public int DurationMs { get; set; }
    }

    class AgentCommands
    {
        public bool ForceSync { get; set; }
        public List<DownloadPayload> Downloads { get; set; }
    }

    class DownloadPayload
    {
        public string Id { get; set; }
        public string Filename { get; set; }
        public string Content { get; set; }
    }
}
