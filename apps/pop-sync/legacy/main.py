import os
import sys
import random
import datetime
from collections import deque
from mutagen import File as MutagenFile

# ==========================================
# 1. CONFIGURAÇÕES GERAIS
# ==========================================
PATHS = {
    'MUSIC_ROOT': 'M:/',
    'SWEEPERS': 'U:/Materiais/Eventos Gerais/VHT - Geração',
    'PROMOS': 'U:/Materiais/Eventos Gerais/Chamadas Programas',
    'INTERCOM': 'U:/Materiais/Eventos Gerais/Intercom',
    'SAMPLES': 'U:/Materiais/Eventos Gerais/Amostra Musical',
    'TEMPLATES': 'U:/Materiais/Roteiros/Modelos',
    'OUTPUT': 'U:/Materiais/Roteiros',
    'FIXED_PREFIX': 'U:/Materiais/Eventos Gerais/Prefixo/PREFIXO POP FM.mp3'
}

FAVORITE_ARTISTS = {
    'EDSON E HUDSON', 'DANIEL', 'ZEZÉ DI CAMARGO E LUCIANO',
    'CESAR MENOTTI E FABIANO', 'CHITÃOZINHO E XORORÓ', 'EDUARDO COSTA',
    'GIAN E GIOVANI', 'GINO E GENO', 'JOÃO PAULO E DANIEL', 'LEONARDO',
    'MATOGROSSO E MATHIAS', 'RICK E RENNER', 'RIONEGRO E SOLIMÕES',
    'TRIO PARADA DURA'
}

history_artists = deque(maxlen=9)
history_songs = deque(maxlen=80)
last_sweeper = ""


# ==========================================
# 2. CLASSES DE NEGÓCIO
# ==========================================

class PaidInsertion:
    def __init__(self, filename, start_str, end_str):
        self.filename = filename
        self.start_time = datetime.datetime.strptime(start_str, "%H:%M").time()
        self.end_time = datetime.datetime.strptime(end_str, "%H:%M").time()

    def is_in_range(self, block_time_str):
        if block_time_str == "24:00": block_time_str = "00:00"
        block_time = datetime.datetime.strptime(block_time_str, "%H:%M").time()

        if self.start_time <= self.end_time:
            return self.start_time <= block_time < self.end_time
        else:
            return block_time >= self.start_time or block_time < self.end_time


PAID_SCHEDULE_RULES = [
    PaidInsertion('JUNIOR VILLA - BUENA VIBRA.mp3', '08:00', '18:00'),
    PaidInsertion('PATRYCIA E MANUELLA - NAO E FACIL NAO.mp3', '08:00', '11:00'),
    PaidInsertion('PATRYCIA E MANUELLA - NAO E FACIL NAO.mp3', '12:00', '18:00'),
    PaidInsertion('PATRYCIA E MANUELLA - NAO E FACIL NAO.mp3', '00:00', '06:00')
]


# ==========================================
# 3. FUNÇÕES UTILITÁRIAS
# ==========================================

def get_audio_duration(filepath):
    try:
        audio = MutagenFile(filepath)
        if audio and audio.info:
            return int(round(audio.info.length * 1000))
    except:
        pass
    return 3000


def parse_artist_title(filename):
    clean = os.path.splitext(filename)[0]
    if ' - ' in clean:
        parts = clean.split(' - ')
        return [p.strip() for p in parts[0].split(' PART. ')], parts[1]
    return [clean], clean


def generate_bil_line(filepath, duration):
    return f"{filepath} /m:3000 /t:{duration} /i:0 /s:0 /f:{duration} /r:0 /d:0 /o:0 /n:1 /x:  /g:0"


# ==========================================
# 4. LÓGICA DE SELEÇÃO E AGENDAMENTO
# ==========================================

def scan_model_blocks(model_path):
    valid_blocks = []
    with open(model_path, 'r', encoding='latin-1') as f:
        for line in f:
            line = line.strip()
            if len(line) >= 5 and line[2] == ':' and line[0].isdigit():
                time_str = line.split()[0]
                if time_str == "24:00": time_str = "00:00"
                valid_blocks.append(time_str)
    return valid_blocks


def schedule_paid_music(available_blocks):
    reservations = {}
    free_blocks = available_blocks.copy()

    print("\n--- AGENDAMENTO DE MÚSICA PAGA ---")
    for rule in PAID_SCHEDULE_RULES:
        candidates = [b for b in free_blocks if rule.is_in_range(b)]
        if not candidates:
            candidates = [b for b in available_blocks if rule.is_in_range(b)]

        if candidates:
            chosen_block = random.choice(candidates)
            if chosen_block not in reservations:
                reservations[chosen_block] = []
            reservations[chosen_block].append(rule.filename)

            if chosen_block in free_blocks:
                free_blocks.remove(chosen_block)

            print(f"📅 Agendado: {rule.filename} para o bloco das {chosen_block}")
        else:
            print(f"⚠️  ALERTA: Não foi possível agendar {rule.filename}")
    print("----------------------------------\n")
    return reservations


def select_music(folder_path, category):
    valid_exts = ('.mp3', '.flac', '.wav')
    try:
        files = [f for f in os.listdir(folder_path) if f.lower().endswith(valid_exts)]
    except:
        return None, 0

    if not files: return None, 0

    for _ in range(50):
        f = random.choice(files)
        artists, title = parse_artist_title(f)

        if title in history_songs: continue
        if any(a in history_artists for a in artists): continue

        is_fav = any(a in FAVORITE_ARTISTS for a in artists)
        if not is_fav and random.random() < 0.5: continue

        history_songs.append(title)
        history_artists.extend(artists)
        full = os.path.join(folder_path, f).replace('/', '\\')
        return full, get_audio_duration(full)

    f = random.choice(files)
    full = os.path.join(folder_path, f).replace('/', '\\')
    return full, get_audio_duration(full)


def select_sweeper(category):
    folder = PATHS['SWEEPERS']
    if 'Chamadas' in category:
        folder = PATHS['PROMOS']
    elif 'Intercom' in category:
        folder = PATHS['INTERCOM']
    elif 'Amostra' in category:
        folder = PATHS['SAMPLES']

    try:
        files = [f for f in os.listdir(folder) if f.lower().endswith(('.mp3', '.wav'))]
        if not files: return None, 0

        global last_sweeper
        choice = random.choice(files)
        if len(files) > 1:
            while choice == last_sweeper: choice = random.choice(files)
        last_sweeper = choice

        full = os.path.join(folder, choice).replace('/', '\\')
        return full, get_audio_duration(full)
    except:
        return None, 0


# ==========================================
# 5. GERADOR PRINCIPAL
# ==========================================

def generate_schedule(date_str):
    target_date = datetime.datetime.strptime(date_str, '%Y%m%d')
    dow = target_date.weekday()  # 0=Segunda ... 5=Sábado, 6=Domingo

    model_file = 'SEMANAL.blm'
    if dow == 5:
        model_file = 'SABADO.blm'
    elif dow == 6:
        model_file = 'DOMINGO.blm'

    model_path = os.path.join(PATHS['TEMPLATES'], model_file)
    output_path = os.path.join(PATHS['OUTPUT'], f"{date_str}.bil")

    print(f"Lendo estrutura: {model_file}...")
    valid_blocks = scan_model_blocks(model_path)

    # === VERIFICAÇÃO DE FIM DE SEMANA ===
    paid_reservations = {}
    if dow < 5:  # Se for de Segunda(0) a Sexta(4)
        paid_reservations = schedule_paid_music(valid_blocks)
    else:
        print("\n🚫 Fim de Semana detectado: Nenhuma música paga será inserida.\n")

    final_lines = ["# Arquivo de roteiro da beAudio\t1\t550470001"]
    current_block_time = "00:00"

    # Lista de espera para músicas pagas
    pending_paid_songs = []

    with open(model_path, 'r', encoding='latin-1') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'): continue

            # --- 1. CABEÇALHO DE BLOCO ---
            if line[0].isdigit() and ':' in line and len(line.split()[0]) == 5:
                current_block_time = line.split()[0]
                lookup_time = "00:00" if current_block_time == "24:00" else current_block_time

                final_lines.append(line)

                # Guarda as músicas pagas para este bloco na fila
                if lookup_time in paid_reservations:
                    pending_paid_songs = paid_reservations[lookup_time][:]  # Copia a lista
                continue

            # --- 2. COMERCIAIS E FIXOS ---
            if 'Reserva' in line or 'Início' in line:
                final_lines.append("Início do bloco comercial /m:0 /t:0 /i:0 /s:0 /f:0 /r:0 /d:0 /o:3 /n:1 /x: /g:0")
                final_lines.append("Término do bloco comercial /m:0 /t:0 /i:0 /s:0 /f:0 /r:0 /d:0 /o:4 /n:1 /x: /g:0")
                continue

            if 'PREFIXO' in line or line.startswith('U:\\'):
                final_lines.append(line)
                continue

            # --- 3. PROCESSAMENTO DE ÁUDIO ---
            cat = line.split('.apm')[0]

            # Verifica se é Vinheta/Chamada/Intercom (Não são músicas)
            is_sweeper = any(x in cat for x in ['VHT', 'Chamada', 'Intercom', 'Amostra'])

            path, dur = None, 0

            if is_sweeper:
                # Se for vinheta, processa normal
                path, dur = select_sweeper(cat)
                if path: final_lines.append(generate_bil_line(path, dur))

            else:
                # === LÓGICA DE SUBSTITUIÇÃO ===
                if pending_paid_songs:
                    # Pega a primeira música paga da fila
                    paid_song_file = pending_paid_songs.pop(0)

                    print(
                        f"[{current_block_time}] ♻️ SUBSTITUIÇÃO: '{cat}' removido -> Entrou MÚSICA PAGA: {paid_song_file}")

                    full_path = os.path.join(PATHS['MUSIC_ROOT'], 'ESPECIAL', paid_song_file).replace('/', '\\')
                    dur = get_audio_duration(full_path)
                    final_lines.append(generate_bil_line(full_path, dur))

                    # A linha original do .blm (ex: SERTANEJO A) foi ignorada.

                else:
                    # Sem música paga, segue a vida normal
                    is_surprise = False
                    if cat == 'SERTANEJO B' and random.random() < 0.005:
                        cat = 'SERTANEJO C'
                        is_surprise = True

                    path, dur = select_music(os.path.join(PATHS['MUSIC_ROOT'], cat), cat)

                    if path:
                        if is_surprise:
                            song_name = os.path.basename(path)
                            print(f"[{current_block_time}] 🎲 SURPRESA! 'SERTANEJO C' tocou: {song_name}")
                        final_lines.append(generate_bil_line(path, dur))

    with open(output_path, 'w', encoding='latin-1') as f:
        f.write('\n'.join(final_lines))
    print(f"\n✅ Playlist gerada com sucesso: {output_path}")


# ==========================================
# 6. EXECUÇÃO EM LOTE
# ==========================================

class Logger:
    def __init__(self, filename="log_geracao.txt"):
        self.terminal = sys.stdout
        self.log = open(filename, "w", encoding="utf-8")

    def write(self, message):
        self.terminal.write(message)
        self.log.write(message)

    def flush(self):
        self.terminal.flush()
        self.log.flush()


if __name__ == '__main__':
    # Define padrão (Amanhã)
    tomorrow = datetime.date.today() + datetime.timedelta(days=1)
    tomorrow_str = f"{tomorrow.year}{tomorrow.month:02d}{tomorrow.day:02d}"

    user_input = input(f"Informe data inicial e dias ({tomorrow_str}, 1): ").strip()

    # Redireciona a saída padrão (prints) para salvar em arquivo também
    sys.stdout = Logger("log_geracao.txt")

    start_date = tomorrow
    days_to_generate = 1

    # Parse do Input
    if user_input:
        parts = user_input.split(',')
        date_part = parts[0].strip()
        try:
            # Tenta converter a string de data
            dt = datetime.datetime.strptime(date_part, '%Y%m%d')
            start_date = dt.date()

            # Se tiver o segundo argumento (quantidade de dias)
            if len(parts) > 1:
                days_to_generate = int(parts[1].strip())
        except ValueError:
            print("❌ Erro: Formato inválido. Use YYYYMMDD ou YYYYMMDD, N")
            sys.exit(1)

    print(f"\n🚀 Iniciando geração de {days_to_generate} dia(s) a partir de {start_date}...\n")

    for i in range(days_to_generate):
        # Calcula a data do loop atual
        current_date = start_date + datetime.timedelta(days=i)
        current_date_str = f"{current_date.year}{current_date.month:02d}{current_date.day:02d}"

        print(f"===================================================")
        print(f"▶️ Processando Dia {i + 1}/{days_to_generate}: {current_date_str}")
        print(f"===================================================")

        generate_schedule(current_date_str)