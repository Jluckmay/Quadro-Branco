from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from starlette.websockets import WebSocketState
import threading
import json
from core_client import start_connection
from supabase import create_client, Client
from jose import jwt  # pip install python-jose

SUPABASE_URL = "https://dayvyzxacovefbjgluaq.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRheXZ5enhhY292ZWZiamdsdWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk0MjE0MDAsImV4cCI6MjA2NDk5NzQwMH0.ofuj_A96OXS1eJ7b_F-f0-9AjJtWNX-sS8cavcdIqNY"
SUPABASE_JWT_SECRET = "vusfUw2JcrTQ9WJ2b02YWwCw-NNjwmixZAjvMy9Prms"  # apenas o payload com role=service_role

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
app = FastAPI()

# Banco local em memória
quadro_dados = {}
locks = {}  # index: usuario_id
frontends = set()
core_ws = None


@app.websocket("/ws/frontend")
async def websocket_frontend(websocket: WebSocket, token: str = Query(None)):
    await websocket.accept()

    # Autenticação JWT
    try:
        payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"])
        usuario_id = payload.get("sub", "Desconhecido")
        usuario_email = payload.get("email", "sem_email")
    except Exception as e:
        print("❌ Token JWT inválido:", e)
        await websocket.close()
        return

    frontends.add(websocket)
    print(f"🔌 Frontend conectado: {usuario_email}")

    try:
        while True:
            if websocket.application_state != WebSocketState.CONNECTED:
                break

            data = await websocket.receive_json()
            tipo = data.get("tipo")
            acao = data.get("acao")
            conteudo = data.get("conteudo")

            # 🔒 Lógica de LOCK otimista
            if tipo == "lock":
                index = conteudo.get("index")
                if acao == "adquirir":
                    if locks.get(index) in [None, usuario_id]:
                        locks[index] = usuario_id
                        print(f"🔒 Lock adquirido por {usuario_email} no objeto {index}")
                    else:
                        print(f"❌ Lock negado para {usuario_email} no objeto {index} (já está com {locks.get(index)})")
                        continue  # ignora tentativa
                elif acao == "liberar":
                    if locks.get(index) == usuario_id:
                        del locks[index]
                        print(f"🔓 Lock liberado por {usuario_email} no objeto {index}")
                continue  # não prossegue para salvar/broadcast de locks

            quadro_dados[usuario_id] = conteudo
            print(f"📥 {usuario_email} enviou: {conteudo}")

            # Salvar no Supabase
            try:
                supabase.table("objetos").insert({
                    "usuario_id": usuario_id,
                    "sessao_id": "sessao123",
                    "tipo": tipo,
                    "acao": acao,
                    "conteudo": conteudo
                }).execute()
                print("✅ Dados salvos no Supabase.")
            except Exception as e:
                print("❌ Erro ao salvar no Supabase:", e)

            # Enviar para o core
            if core_ws:
                await core_ws.send_json({
                    "grupo": "G7",
                    "acao": "atualizacao",
                    "dados": {
                        "usuario": usuario_email,
                        "tipo": tipo,
                        "acao": acao,
                        "conteudo": conteudo
                    }
                })

            # Broadcast para todos os frontends
            for ws in frontends:
                await ws.send_json({
                    "usuario": usuario_email,
                    "tipo": tipo,
                    "acao": acao,
                    "conteudo": conteudo
                })

    except Exception as e:
        print(f"⚠️ {usuario_email} desconectado.")
        print("❌ Erro:", e)
    finally:
        frontends.remove(websocket)
        # 🔐 Remove locks pendentes do usuário
        for index, dono in list(locks.items()):
            if dono == usuario_id:
                del locks[index]
                print(f"🔓 Lock liberado automaticamente do objeto {index} por desconexão")


"""
@app.websocket("/ws/core")
async def websocket_core(websocket: WebSocket):
    global core_ws
    await websocket.accept()
    core_ws = websocket
    print("🔗 Conectado ao core.")

    try:
        while True:
            data = await websocket.receive_json()
            print(f"🔁 Recebido do core: {data}")

            for ws in frontends:
                await ws.send_json(data)

    except WebSocketDisconnect:
        core_ws = None
        print("❌ Core desconectado.")

"""
# Inicializa conexão com core em segundo plano
threading.Thread(
    target=lambda: start_connection(lambda: len(frontends)),
    daemon=True
).start()
