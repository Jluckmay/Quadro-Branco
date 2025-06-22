import websocket  # Biblioteca websocket-client
import threading
import json
import time

# URL do core WebSocket
WS_URL = "wss://whiteboard-core.onrender.com"

# Intervalos de tempo (em segundos)
RETRY_INTERVAL = 30
SEND_INTERVAL = 10

# Envia periodicamente o estado para o core
def send_data(ws, get_user_count):
    while True:
        data = {
            "serverId": "main-server-G7",
            "name": "Servidor do G7",
            "roomCount": 1,
            "userCount": get_user_count(),
            "status": "online"
        }
        try:
            ws.send(json.dumps(data))
            print("[→] Dados enviados ao core:", data)
        except Exception as e:
            print("❌ Erro ao enviar dados:", e)
            break
        time.sleep(SEND_INTERVAL)

# Ações ao abrir conexão
def on_open(ws, get_user_count):
    print("[✓] Conectado ao whiteboard-core")
    thread = threading.Thread(target=send_data, args=(ws, get_user_count))
    thread.daemon = True
    thread.start()

# Ações ao fechar conexão
def on_close(ws, close_status_code, close_msg, get_user_count):
    print("[!] Conexão com core fechada. Reconectando em 30s...")
    time.sleep(RETRY_INTERVAL)
    try:
        start_connection(get_user_count)
    except Exception as e:
        print("❌ Erro ao tentar reconectar:", e)

# Ações em erro
def on_error(ws, error):
    print("❌ Erro no WebSocket:", error)

# Inicia conexão com o servidor core
def start_connection(get_user_count):
    ws = websocket.WebSocketApp(
        WS_URL,
        on_open=lambda ws: on_open(ws, get_user_count),
        on_close=lambda ws, code, msg: on_close(ws, code, msg, get_user_count),
        on_error=on_error
    )
    ws.run_forever()

# Atualiza o estado da sessão no Supabase
def atualizar_estado(client, sessao_id, lista_ids):
    client.table("quadro_estado").update({
        "estado": lista_ids,
        "atualizado_em": "now()"
    }).eq("sessao_id", sessao_id).execute()
