from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import threading
from core_client import start_connection
import json
import asyncio
from supabase import create_client, Client

SUPABASE_URL = "https://dayvyzxacovefbjgluaq.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRheXZ5enhhY292ZWZiamdsdWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk0MjE0MDAsImV4cCI6MjA2NDk5NzQwMH0.ofuj_A96OXS1eJ7b_F-f0-9AjJtWNX-sS8cavcdIqNY"  # ← SUBSTITUA AQUI

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI()

# "Banco de dados" local em memória
quadro_dados = {}

# Conexões ativas com frontends
frontends = set()

# Conexão com o Core
core_ws = None

@app.websocket("/ws/frontend")
async def websocket_frontend(websocket: WebSocket):
    await websocket.accept()
    frontends.add(websocket)
    print("🔌 Frontend conectado.")

    try:
        while True:
            data = await websocket.receive_json()

            usuario = data.get("usuario", "Desconhecido")
            conteudo = data.get("conteudo")
            tipo = data.get("tipo")
            acao = data.get("acao")

            # Atualiza o banco local (temporário)
            quadro_dados[usuario] = conteudo
            print(f"📥 {usuario} enviou: {conteudo}")

            # Salva no Supabase
            try:
                supabase.table("objetos").insert({
                    "usuario_id": usuario,
                    "sessao_id": "sessao123",  # Substitua com ID real se quiser
                    "tipo": tipo,
                    "acao": acao,
                    "conteudo": conteudo
                }).execute()
                print("✅ Dados salvos no Supabase.")
            except Exception as e:
                print("❌ Erro ao salvar no Supabase:", e)

            # Envia para o Core, se conectado
            if core_ws:
                await core_ws.send_json({
                    "grupo": "G1",
                    "acao": "atualizacao",
                    "dados": {
                        "usuario": usuario,
                        "tipo": tipo,
                        "acao": acao,
                        "conteudo": conteudo
                    }
                })

            # Envia para todos os frontends (inclusive quem enviou)
            for ws in frontends:
                await ws.send_json({
                    "usuario": usuario,
                    "tipo": tipo,
                    "acao": acao,
                    "conteudo": conteudo
                })

    except Exception as e:
        frontends.remove(websocket)
        print("⚠️ Frontend desconectado.")
        print("❌ Erro ao decodificar JSON:", e)

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

            # Repassa a todos os frontends
            for ws in frontends:
                await ws.send_json(data)

    except WebSocketDisconnect:
        core_ws = None
        print("❌ Core desconectado.")

# Iniciar cliente WebSocket do core em segundo plano
threading.Thread(target=start_connection, daemon=True).start()