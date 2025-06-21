import threading
import time
import json
import websocket
from app_backend import frontends  

WS_URL = "wss://whiteboard-core.onrender.com"  #ws://localhost:4000
RETRY_INTERVAL = 30
SEND_INTERVAL = 10

def start_connection():
    def send_status(ws):
        while True:
            try:
                data = {
                    "serverId": "main-server-G1",
                    "name": "Servidor do G1",
                    "roomCount": 1,  
                    "userCount": len(frontends),  
                    "status": "online"
                }
                ws.send(json.dumps(data))
                print("[→] Dados enviados ao core:", data)
            except Exception as e:
                print("❌ Erro ao enviar dados ao core:", e)
                break
            time.sleep(SEND_INTERVAL)

    def on_open(ws):
        print("[✓] Conectado ao whiteboard-core")
        threading.Thread(target=send_status, args=(ws,), daemon=True).start()

    def on_close(ws, *_):
        print("[!] Conexão com core encerrada. Reconectando em 30s...")
        time.sleep(RETRY_INTERVAL)
        start_connection()

    def on_error(ws, error):
        print("[x] Erro no core:", error)

    ws = websocket.WebSocketApp(
        WS_URL,
        on_open=on_open,
        on_close=on_close,
        on_error=on_error
    )
    ws.run_forever()
