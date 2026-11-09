-- Historico de ouvintes do streaming da Pop FM (Shoutcast).
-- Uma linha a cada coleta (cron a cada 5 minutos). ts em segundos UTC.
CREATE TABLE IF NOT EXISTS amostras (
  ts INTEGER PRIMARY KEY,
  ouvintes INTEGER NOT NULL,
  unicos INTEGER NOT NULL,
  pico INTEGER NOT NULL,
  tempo_medio INTEGER NOT NULL,
  no_ar INTEGER NOT NULL
);
