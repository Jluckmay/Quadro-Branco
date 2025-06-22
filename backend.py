from fastapi import FastAPI, WebSocket, Query
from starlette.websockets import WebSocketState
import threading
from core_client import start_connection, atualizar_estado
from supabase import create_client, Client
from jose import jwt, JWTError
import json

SUPABASE_URL = "https://dayvyzxacovefbjgluaq.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRheXZ5enhhY292ZWZiamdsdWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk0MjE0MDAsImV4cCI6MjA2NDk5NzQwMH0.ofuj_A96OXS1eJ7b_F-f0-9AjJtWNX-sS8cavcdIqNY"
SUPABASE_JWT_SECRET = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRheXZ5enhhY292ZWZiamdsdWFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTQyMTQwMCwiZXhwIjoyMDY0OTk3NDAwfQ.vusfUw2JcrTQ9WJ2b02YWwCw-NNjwmixZAjvMy9Prms"

supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
app = FastAPI()

quadro_dados = {}
locks = {}
frontends = set()
core_ws = None

@app.websocket("/ws/frontend")
async def websocket_frontend(websocket: WebSocket, token: str = Query(None)):
    await websocket.accept()

    try:
        payload = jwt.get_unverified_claims(token)
        usuario_id = payload.get("sub", "Desconhecido")
        usuario_email = payload.get("email", "sem_email")
        print(f"🔌 Frontend conectado (sem verificação): {usuario_email}")
    except JWTError as e:
        print("❌ Erro ao extrair payload do token:", e)
        await websocket.close()
        return

    try:
        response = supabase_client.table("quadro_estado") \
            .select("estado") \
            .eq("sessao_id", "sessao123") \
            .order("atualizado_em", desc=True) \
            .limit(1) \
            .execute()

        # Verifica se estado já existe, senão cria
        if not response.data:
            supabase_client.table("quadro_estado").insert({
                "sessao_id": "sessao123",
                "estado": [],
                "atualizado_em": "now()"
            }).execute()
            print("🆕 Estado inicial criado em 'quadro_estado'")
            estado = []
        else:
            estado = response.data[0]["estado"]

        objetos = []
        if estado:
            objetos_response = supabase_client.table("objetos") \
                .select("*") \
                .in_("id", estado) \
                .execute()
            objetos = objetos_response.data if hasattr(objetos_response, "data") else objetos_response

        await websocket.send_json({"tipo": "estado_inicial", "objetos": objetos})
        print(f"📤 Estado inicial enviado para {websocket.client.host}")

    except Exception as e:
        print("❌ Erro ao buscar estado inicial do quadro:", e)

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

            if tipo == "lock":
                index = conteudo.get("index")
                if acao == "adquirir":
                    if locks.get(index) in [None, usuario_id]:
                        locks[index] = usuario_id
                        print(f"🔒 Lock adquirido por {usuario_email} no objeto {index}")
                    else:
                        print(f"❌ Lock negado para {usuario_email} no objeto {index} (já está com {locks.get(index)})")
                        continue
                elif acao == "liberar":
                    if locks.get(index) == usuario_id:
                        del locks[index]
                        print(f"🔓 Lock liberado por {usuario_email} no objeto {index}")
                continue

            quadro_dados[usuario_id] = conteudo
            print(f"📥 {usuario_email} enviou: {conteudo}")

            try:
                supabase_client.table("objetos").insert({
                    "usuario_id": usuario_id,
                    "sessao_id": "sessao123",
                    "tipo": tipo,
                    "acao": acao,
                    "conteudo": conteudo
                }).execute()
                print("✅ Dados salvos no Supabase.")
            except Exception as e:
                print("❌ Erro ao salvar no Supabase:", e)

            if tipo == "resetar":
                atualizar_estado(supabase_client, "sessao123", [])
            else:
                response = supabase_client.table("quadro_estado") \
                    .select("estado") \
                    .eq("sessao_id", "sessao123") \
                    .order("atualizado_em", desc=True) \
                    .limit(1) \
                    .execute()

                lista_ids = response.data[0]["estado"] if response and response.data else []

                resultado = supabase_client.table("objetos") \
                    .select("id") \
                    .eq("usuario_id", usuario_id) \
                    .eq("sessao_id", "sessao123") \
                    .neq("acao", "remover_objeto") \
                    .order("id", desc=True) \
                    .limit(1) \
                    .execute()

                novo_id = resultado.data[0]["id"] if resultado and resultado.data else None

                if novo_id and novo_id not in lista_ids:
                    lista_ids.append(novo_id)

                atualizar_estado(supabase_client, "sessao123", lista_ids)

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
        for index, dono in list(locks.items()):
            if dono == usuario_id:
                del locks[index]
                print(f"🔓 Lock liberado automaticamente do objeto {index} por desconexão")

# Inicia conexão com o core em thread separada
threading.Thread(
    target=lambda: start_connection(lambda: len(frontends)),
    daemon=True
).start()
