import websocket # Importa a biblioteca websocket-client
import threading
import json
import time

WS_URL = "wss://whiteboard-core.onrender.com"  # ou ws://localhost:4000
RETRY_INTERVAL = 30
SEND_INTERVAL = 10

def send_data(ws):
    while True:
        data = {
            "serverId": "main-server-G7",
            "name": "Servidor do G7",
            "roomCount": 1,
            "userCount": 0,  # Atualize aqui se quiser usar valor real
            "status": "online"
        }
        try:
            ws.send(json.dumps(data))
            print("[→] Dados enviados ao core:", data)
        except Exception as e:
            print("❌ Erro ao enviar dados:", e)
            break
        time.sleep(SEND_INTERVAL)

def on_open(ws):
    print("[✓] Conectado ao whiteboard-core")
    thread = threading.Thread(target=send_data, args=(ws,))
    thread.daemon = True
    thread.start()

def on_close(ws, close_status_code, close_msg):
    print("[!] Conexão com core fechada. Reconectando em 30s...")
    time.sleep(RETRY_INTERVAL)
    start_connection()

def on_error(ws, error):
    print("❌ Erro no WebSocket:", error)

def start_connection():
    ws = WebSocket.WebSocketApp(
        WS_URL,
        on_open=on_open,
        on_close=on_close,
        on_error=on_error
    )
    ws.run_forever()
