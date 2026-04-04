# Sobre os Arquivos de Roteiro (.BIL)

Este documento descreve a finalidade, a estrutura e a importância dos arquivos `.bil` no ecossistema da rádio e do sistema **Massa Sync**.

## 🧐 O que é um arquivo .BIL?
O arquivo com extensão `.bil` é um **Roteiro Musical (Musical Script)** utilizado predominantemente pelo software de automação de rádio **BeAudio**. Ele funciona como um "mapa" que diz ao computador da rádio exatamente o que tocar, em qual ordem e em qual horário.

## 🏗️ Estrutura Técnica
Embora pareça um arquivo de texto comum, ele possui regras rígidas:

1.  **Codificação (ANSI/Windows-1252)**: Diferente de arquivos modernos que usam UTF-8, o BeAudio exige a codificação Windows-1252. Se for salvo em outro formato, acentos como "Sábado" ou "Terça-Feira" aparecerão corrompidos no ar.
2.  **Linhas de Comando**: Cada linha representa um evento. Exemplo:
    - `C:\Musicas\Artista - Titulo.mp3 /m:3950 /t:210000`
    - `/m:3950`: Identificador de mídia.
    - `/t:XXXX`: Duração em milissegundos.
3.  **Blocos Comerciais**: São delimitados pelos comandos `/o:3` (Início de Bloco) e `/o:4` (Fim de Bloco).

## 🔄 O Papel do Massa Sync
No projeto **Massa Sync**, o arquivo `.bil` é a peça central da programação:
- O **Servidor (Nuvem)** processa o roteiro mestre, aplicando regras de cada cidade (removendo ou inserindo comerciais/jabás específicos).
- O **Massa Sync (Local)** baixa esse arquivo processado e o entrega na pasta de leitura do software da rádio.
- **Substituição**: O app sempre sobrescreve o arquivo com a versão mais recente enviada pelo servidor, garantindo que a rádio nunca fique com um roteiro desatualizado.

## ⚠️ Observações de Segurança
- Nunca abra e salve um arquivo `.bil` manualmente no Bloco de Notas sem garantir que a codificação está em **ANSI**, pois isso pode interromper a leitura automática do sistema da rádio.
- O Massa Sync garante essa integridade automaticamente em cada download.
