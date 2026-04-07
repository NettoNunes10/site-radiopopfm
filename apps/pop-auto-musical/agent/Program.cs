using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace RadioAgent
{
    class Program
    {
        static async Task Main(string[] args)
        {
            Console.WriteLine("========================================");
            Console.WriteLine("   RadioAgent - Unified Sync Service   ");
            Console.WriteLine("========================================\n");

            // 1. Configurações locais
            string musicPath = @"M:\MUSICAS"; 
            string sweepersPath = @"U:\Materiais\Eventos Gerais\VHT - Geração";
            string apiUrl = "https://site-radiopopfm.pages.dev/api/pop/library";
            string apiKey = "COLOQUE_API_KEY"; // Preencher via Admin ou Config

            Console.WriteLine($"> Analisando pastas...");
            
            var library = new Dictionary<string, List<MusicFile>>();

            void ScanFolder(string path, string defaultCategory)
            {
                if (!Directory.Exists(path)) return;
                var files = Directory.GetFiles(path, "*.*", SearchOption.AllDirectories)
                                     .Where(s => s.EndsWith(".mp3") || s.EndsWith(".wav") || s.EndsWith(".wma"))
                                     .ToList();

                foreach (var file in files)
                {
                    try
                    {
                        var folderName = Path.GetFileName(Path.GetDirectoryName(file));
                        // Se for a raiz, usar a categoria padrão
                        var category = folderName == Path.GetFileName(path) ? defaultCategory : folderName;

                        if (!library.ContainsKey(category)) library[category] = new List<MusicFile>();

                        using (var tfile = TagLib.File.Create(file))
                        {
                            library[category].Add(new MusicFile
                            {
                                FileName = Path.GetFileName(file),
                                FullPath = file, // Mantém o caminho original para o roteiro .bil
                                Artist = tfile.Tag.FirstPerformer ?? "DESCONHECIDO",
                                Title = tfile.Tag.Title ?? Path.GetFileNameWithoutExtension(file),
                                DurationMs = (int)tfile.Properties.Duration.TotalMilliseconds
                            });
                        }
                    } catch { /* Ignorar falhas de tags individuais */ }
                }
            }

            ScanFolder(musicPath, "MUSICAS");
            ScanFolder(sweepersPath, "VIG");

            int total = library.Values.Sum(v => v.Count);
            Console.WriteLine($"> Indexação concluída. {total} músicas divididas em {library.Count} categorias.");

            // 2. Enviar para a Nuvem
            await SyncWithCloud(apiUrl, apiKey, library, total);

            Console.WriteLine("\n[Pronto! Operação concluída]");
            await Task.Delay(2000);
        }

        static async Task SyncWithCloud(string url, string key, Dictionary<string, List<MusicFile>> library, int total)
        {
            using (var client = new HttpClient())
            {
                client.DefaultRequestHeaders.Add("Authorization", $"Bearer {key}");
                var json = JsonSerializer.Serialize(new {
                    lastUpdate = DateTime.UtcNow,
                    host = Environment.MachineName,
                    count = total,
                    library = library // Enviamos o dicionário agrupado por pastas
                });
                var content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
                var response = await client.PostAsync(url, content);
                if (response.IsSuccessStatusCode) Console.WriteLine("✓ Sincronizado com sucesso!");
                else Console.WriteLine($"! Erro: {response.StatusCode}");
            }
        }
    }

    public class MusicFile
    {
        public string FileName { get; set; }
        public string FullPath { get; set; }
        public string Artist { get; set; }
        public string Title { get; set; }
        public int DurationMs { get; set; }
    }
}
