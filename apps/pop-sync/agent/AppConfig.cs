using System;

namespace PopSync
{
    public class AppConfig
    {
        public string ApiUrl { get; set; } = "";
        public string ApiKey { get; set; } = "";
        public string MusicPath { get; set; } = "";
        public string SweepersPath { get; set; } = "";
        public string DownloadPath { get; set; } = "";
        public string SlackWebhookUrl { get; set; } = "";
        public int SyncIntervalMinutes { get; set; } = 5;
    }
}
