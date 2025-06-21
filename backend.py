from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import asyncio

app = FastAPI()

# "Banco de dados" do grupo
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

            # Atualiza o "banco de dados"
            quadro_dados[usuario] = conteudo
            print(f"📥 {usuario} enviou: {conteudo}")

            # Envia para o Core, se conectado
            if core_ws:
                await core_ws.send_json({
                    "grupo": "G1",
                    "acao": "atualizacao",
                    "dados": {usuario: conteudo}
                })

            # (Opcional) ecoa para todos os frontends
            for ws in frontends:
                await ws.send_json({
                    "usuario": usuario,
                    "conteudo": conteudo
                })

    except WebSocketDisconnect:
        frontends.remove(websocket)
        print("⚠️ Frontend desconectado.")


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
